// i18n-ignore-file: 给模型的工具说明（跟随工具目录现有的写法，整批改英文前保持一致）
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { EditResult, VideoOpenResult } from '@baocut/protocol';
import { EditorWasmError, audioAnalysis, audioSheet, sfxRender, type AudioAnalysis } from '@baocut/editor-wasm';
import { audioWindow } from '@baocut/process-host';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
import { videoChangeOf } from '../compositions/composition-service.ts';
import { inside } from './artifact-save.ts';
import { digestReceipt, resolveUserPath } from './video-digest.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import {
  DEFAULT_AUDIO_THRESHOLD,
  DEFAULT_MARGIN,
  DEFAULT_MIN_CUT,
  DEFAULT_MIN_KEEP,
  DEAD_AIR_TICK,
  DEFAULT_MOTION_THRESHOLD,
  audioActivity,
  combineActivity,
  deadRanges,
  motionActivity,
  motionRatio,
} from './dead-air.ts';
import { framesDirectory } from './video-frames.ts';
import { commandIdArg, revisionArg, videoArg } from './video-tools.ts';

/**
 * 音频的两件事（Agent 面设计 §4.3）：`assets_sfx` 用内置配方合成一段音效（`crates/audio-dsp` 的 `sfx`，经 editor-wasm），作为 managed
 * 素材导入（可以同时放上时间线）；`assets_analyze` 把一段音频解码成单声道 PCM，算逐帧特征、起音、重音与节拍（`waveform::beats`、
 * `waveform::cues`），可选地核对一串时刻对不对得上起音、画一张听音表（`waveform::sheet`，ffmpeg 编成 PNG），整份写成 JSON 给代码画面读，
 * 结果里只回摘要。
 */

export interface AudioToolsDeps {
  videos: VideoService;
  scope: ToolScope;
  ffmpeg: () => string | Promise<string>;
}

/** 配方（与 `crates/audio-dsp/src/sfx.rs` 的 `RECIPES` 一致，测试核对）。 */
export const SFX_RECIPES = [
  'kick',
  'boom',
  'crash',
  'riser',
  'tick',
  'blip',
  'ping',
  'whoosh',
  'stamp',
  'glitch',
  'static',
  'click',
  'keypress',
  'pop',
  'impact',
] as const;
const SFX_SPACES = ['room', 'hall'] as const;

/** 分析写在写文件目录下的这里：`<videoId>/<名字>.json`。 */
export const ANALYSIS_DIR = path.join('.baocut-out', 'analysis');
/** 解码的采样率：节拍与频带只看到 8 kHz，22.05 kHz 够用，PCM 是 48 kHz 的一半不到。 */
const ANALYSIS_RATE = 22_050;
/** 一次最多分析的时长（秒）。 */
export const MAX_ANALYSIS_SECONDS = 20 * 60;
/** 结果里直接列出的起音条数；整份在文件里。 */
const INLINE_ONSETS = 120;
/** 结果里直接列出的重音、没对上的时刻条数。 */
const INLINE_EVENTS = 60;
/** 一次最多核对的时刻数。 */
const MAX_CUES = 500;
/** 听音表最长覆盖的时长（秒）：再长，1600 像素宽里 80 ms 间隔的起音就分不开了。 */
export const MAX_SHEET_SECONDS = 120;
const SHEET_WIDTH = 1600;
const SFX_REF = 'sfx';

const placeArg = z
  .strictObject({
    track: z.string().min(1).max(200).optional().describe('main（默认，第一条未锁定的音频轨道）或轨道 ID'),
    at: z
      .string()
      .regex(/^(\d+(\.\d+)?|end)$/)
      .optional()
      .describe('开始时间：时间线上的秒数（十进制字符串），或 end（默认，接在轨道末尾）'),
  })
  .optional()
  .describe('可选。导入后放到时间线上，写法同 assets_import；不给时只登记为素材');

const schemas = {
  assets_sfx: z.strictObject({
    video: videoArg,
    recipe: z
      .enum(SFX_RECIPES)
      .describe(
        '配方。拟真（物理建模，像近距离录下来的）：click（鼠标 / 触控板点一下，按下与松开，0.15 秒）、keypress（机械键盘按一个键，0.32 秒）、pop（啵，元素弹出，0.25 秒）、impact（重物落地的低沉一击，2.2 秒）。风格化：kick（底鼓，0.5 秒）、boom（低频轰鸣，2 秒）、crash（镲，2.5 秒）、riser（上扬，3 秒，末尾到顶，让末尾对准切点）、tick（滴答，0.08 秒）、blip（提示音，0.15 秒）、ping（叮，0.8 秒）、whoosh（呼的一下，0.9 秒）、stamp（盖章，0.35 秒）、glitch（故障，0.4 秒）、static（电流噪声，1 秒）',
      ),
    seconds: z
      .number()
      .gt(0)
      .max(10)
      .optional()
      .describe('可选。长度（秒，最长 10）；不给用配方的长度。衰减类按比例拉长尾巴，riser 拉长爬升'),
    pitch: z.number().min(-12).max(12).optional().describe('可选。音高（半音，−12..12），默认 0；正的更亮更小，负的更沉更大'),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .optional()
      .describe('可选。随机种子，默认 0；同样的参数与种子出逐位相同的声音，换种子换一个变体'),
    space: z.enum(SFX_SPACES).optional().describe('可选。加空间混响：room（小房间）或 hall（大厅）；默认干声'),
    name: z.string().min(1).max(200).optional().describe('可选。素材名；不给时是「SFX <recipe>」'),
    place: placeArg,
    revision: revisionArg.optional().describe('可选。视频当前的版本，不一致时不导入；不给时用最新的版本'),
    commandId: commandIdArg.optional().describe('可选。同一次导入重试时带上同一个值，引擎不会重复提交'),
  }),
  assets_analyze: z.strictObject({
    video: videoArg,
    asset: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('要分析的素材 ID（videos_inspect 的 assets 里有；音频或带音轨的视频）。与 path 二选一'),
    path: z.string().min(1).max(1000).optional().describe('或者工作目录里的一个音频 / 视频文件（例如还没导入的配乐）。与 asset 二选一'),
    range: z
      .string()
      .regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/)
      .optional()
      .describe(`可选。只分析源文件里的 "起:止"（秒）；不给时整段，最长 ${MAX_ANALYSIS_SECONDS / 60} 分钟`),
    fps: z.number().min(1).max(120).optional().describe('可选。逐帧特征的帧率，默认视频的帧率（代码画面按帧取值）'),
    beats: z.boolean().optional().describe('可选。false 时不找节拍（讲话、环境声）；默认 true'),
    beatsPerBar: z.number().int().min(2).max(12).optional().describe('可选。每小节几拍，默认 4'),
    cues: z
      .array(z.number().min(0))
      .min(1)
      .max(MAX_CUES)
      .optional()
      .describe(
        `可选。要核对的时刻（源文件里的秒，与 range 同一个时钟，最多 ${MAX_CUES} 个）：切点、动画落点、放音效的地方。每个时刻对到最近的起音，回 ok / near / none / outside 与碰巧命中的基线`,
      ),
    tolerance: z
      .number()
      .min(0.005)
      .max(0.5)
      .optional()
      .describe('可选。核对时刻时算「对上了」的容差（秒），默认 0.05；「差一点」是它的 3 倍'),
    sheet: z
      .boolean()
      .optional()
      .describe(`可选。true 时另画一张听音表 PNG（频谱、波形、起音与节拍、时刻），用看图的工具看；最长 ${MAX_SHEET_SECONDS} 秒`),
  }),
  assets_dead_air: z.strictObject({
    video: videoArg,
    asset: z.string().min(1).max(200).optional().describe('素材 ID（videos_inspect 的 assets 里有）。与 path 二选一；给素材时结果带上能直接提交的 addCuts'),
    path: z.string().min(1).max(1000).optional().describe('或者工作目录里的一个音频 / 视频文件。与 asset 二选一'),
    range: z
      .string()
      .regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/)
      .optional()
      .describe(`可选。只看源文件里的 "起:止"（秒）；不给时整段，最长 ${MAX_ANALYSIS_SECONDS / 60} 分钟`),
    method: z.enum(['audio', 'motion', 'both']).optional().describe('可选。audio（默认）看声音；motion 看画面变化（没有收音的录屏、空镜）；both 声音与画面都没动静才算（屏幕录制讲解用它）'),
    threshold: z.number().gt(0).max(1).optional().describe(`可选。声音低于整段峰值的这个比例算没声音；默认 ${DEFAULT_AUDIO_THRESHOLD}。有底噪时调高到 0.08–0.15`),
    motionThreshold: z.number().gt(0).max(1).optional().describe(`可选。画面变化的像素比例低于它算没动静；默认 ${DEFAULT_MOTION_THRESHOLD}`),
    margin: z.number().min(0).max(5).optional().describe(`可选。有内容的段向两边留的余量（秒），不切掉字头字尾；默认 ${DEFAULT_MARGIN}`),
    minCut: z.number().min(0).max(60).optional().describe(`可选。短于它的空档留下（秒，正常的气口）；默认 ${DEFAULT_MIN_CUT}`),
    minKeep: z.number().min(0).max(60).optional().describe(`可选。短于它的响动算噪声（秒，一声咳嗽）；默认 ${DEFAULT_MIN_KEEP}`),
  }),
};

type ToolName = keyof typeof schemas;
type SfxArgs = z.infer<(typeof schemas)['assets_sfx']>;
type AnalyzeArgs = z.infer<(typeof schemas)['assets_analyze']>;
type DeadAirArgs = z.infer<(typeof schemas)['assets_dead_air']>;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  assets_sfx: {
    title: '合成音效',
    description: [
      '用内置配方合成一段音效，导入为素材。',
      '配方是确定性的程序化合成，不联网、不用模型，同样的参数与 seed 出逐位相同的声音；峰值归一到约 −1 dBFS，48 kHz 立体声 WAV，没有版权问题。拟真配方（click、keypress、pop、impact）用接触激励一组模态、再过小房间与话筒（带一点底噪），听着像实录；其余是风格化的（振荡、噪声与滤波按包络拼出来），听得出是合成的。',
      '音效标的是画面上的事件：屏幕录制里的点击、打字、元素弹出用拟真的 click、keypress、pop，重物落地、大标题砸下来用 impact；标题落版用 stamp 或 kick，转场与快速移动用 whoosh，切点前用 riser（放在切点前它的长度处，末尾对准切点），数字跳动用 tick、blip，揭晓用 ping，故障风用 glitch、static，大场面用 boom、crash。一段视频里同一种事件用同一个配方，少而准，别每个动作都配。',
      'bytes 收进视频（managed），编译成 importAsset（给了 place 时再加 addItem，放到音频轨上），一笔修改、可以撤销，会向用户确认。素材的 provenance 记下配方与参数（origin: procedural-sfx）。',
      '返回与 edits_apply 相同的回执，另有 assetId、itemId（没有放到时间线上时为 null）、recipe 与 durationSeconds。音量在时间线上调（edits_apply 的 setVolume），通常比旁白低 6–12 dB。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      { title: '在 4.5 秒放一下 whoosh', args: { video: 'demo', recipe: 'whoosh', place: { at: '4.5' } } },
      { title: '一段 2 秒的上扬，带点空间', args: { video: 'demo', recipe: 'riser', seconds: 2, space: 'room' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  assets_analyze: {
    title: '分析音频',
    description: [
      '分析一段音频的逐帧特征、起音与节拍，写成 JSON 文件给代码画面读。',
      `源是视频里的素材（asset）或工作目录里的文件（path），range 是源文件里的秒数；解码成 ${ANALYSIS_RATE / 1000} kHz 单声道再分析，最长 ${MAX_ANALYSIS_SECONDS / 60} 分钟（AUDIO_TOO_LONG 时分段给 range）。只读，不改视频。`,
      `整份写在写文件目录（会话与终端是工作目录）下的 ${ANALYSIS_DIR}/<videoId>/<素材或文件名>[-<起>-<止>].json：frames（fps 一帧一个 0..1 的值：level 是绝对响度，−60..0 dBFS；bass、mid、treble 是 150 Hz 以下、150 Hz–2 kHz、2–8 kHz 的能量，按这段音频归一；onset 是起音强度）、onsets（t、strength）、beats（tempo、confidence、residual、downbeat、beatsPerBar、times、bars、sections）。时间与第 0 帧都从 source.offset 算起（源文件里的秒）：源文件时间 = 结果里的时间 + source.offset。`,
      `结果回 file、fps、frameCount、duration、source、onsets（前 ${INLINE_ONSETS} 条）与 onsetCount、accents（重音：比前面的底子高至少 6 dB、在全部起音里排前 20% 的起音，t 与 prominenceDb，前 ${INLINE_EVENTS} 条）与 accentCount、beats 的摘要（tempo、confidence、downbeat、beatsPerBar、beatCount、barCount、sections），找不到稳定节拍时 beats 为 null、beatsError 说原因（讲话通常没有拍）。`,
      `给了 cues 时另回 sync：tolerance、nearTolerance、inside（落在分析范围里的时刻数）、ok、near、none、outside、hitRate（ok ÷ inside）、chance（随便放一个时刻也能落进某个起音 ±tolerance 里的概率），以及没对上的时刻 misses（t 是你给的时刻原样，delta 是最近的起音减去它，正的是声音晚到；前 ${INLINE_EVENTS} 条，全部在文件的 sync.cues 里）。hitRate 要跟 chance 比：起音很密时 chance 本身就高，hitRate 只比它高一点说明并没有对上。`,
      `给了 sheet 时另回 sheet（PNG 路径，与 JSON 同目录同名），${SHEET_WIDTH} 像素宽，横轴与时间成正比，图上不写字。自上而下：频谱（40 Hz–11 kHz 按对数，越亮越响）；波形（淡色是峰值、亮色是均方根，按满刻度画，小就是轻）；事件条（灰色竖线是拍、更亮的是小节第一拍，白色刻度是起音、越高越强，橙色整条是重音）。前两条上下沿的短刻度是时间网格：30 秒以内每秒一个、每 5 秒一个长的，更长时每 5 秒一个、每 30 秒一个长的。时刻是贯穿全图的竖线：绿 ok、琥珀 near、红 none。`,
      '用法：配乐导入之后分析它，把文件拷进代码包，在代码画面里按这一刻对应的源文件时间取值（源文件时间 = 时间线时间 − 片段在时间线上的开始 + 片段的源起点），让画面跟着节拍与能量动；剪辑点对到 beats.times、bars 的开始或 accents；音效对到 onsets。',
      '核对成片的声画对位：export 导出时间线的音频（kind audio，format wav；不给 range 时文件里的秒就是时间线的秒），按 path 分析它，cues 填 videos_shots 的 cuts[].at、动画落点或放音效的时间线时刻，sheet: true 再看一眼图。',
      `错误码：ASSET_NOT_FOUND、AUDIO_NO_STREAM（没有音轨）、AUDIO_TOO_LONG、AUDIO_EMPTY、AUDIO_DECODE_FAILED、AUDIO_SHEET_TOO_LONG（听音表超过 ${MAX_SHEET_SECONDS} 秒，给 range 分段画）、AUDIO_SHEET_FAILED、PATH_OUTSIDE_WORKSPACE。`,
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '分析导入的配乐', args: { video: 'demo', asset: 'asset_01J…' } },
      { title: '分析工作目录里一首歌的前 30 秒，按 30 fps', args: { video: 'demo', path: 'music/theme.wav', range: '0:30', fps: 30 } },
      {
        title: '核对导出音频里三个切点对不对得上声音，并画听音表',
        args: { video: 'demo', path: 'exports/mix.wav', cues: [2.4, 5.1, 8.75], sheet: true },
      },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  assets_dead_air: {
    title: '找空档',
    description: [
      '找一段素材里没声音、没动静的部分，给出可以剪掉的区间。',
      '不靠转写：按声音的电平（或画面的变化）判断，所以没人说话的素材（录屏、游戏、空镜、现场）也能用；有转写的口播优先用 edits_apply 的 proposeCuts，它分得清口癖与停顿。只读，不改视频。',
      '判断的顺序：逐片（1/30 秒）看有没有内容；短于 minKeep 的响动算噪声；短于 minCut 的空档算气口、留下（素材开头与结尾的空档例外，多短都给）；有内容的段向两边留 margin。结果是源文件里的秒。',
      '返回 cuts [{from, to}]、deadSeconds、keptSeconds、duration 与 source；给的是 asset 时另回 operation（一个 addCuts，可以直接放进 edits_apply 的 operations，先按用户的要求删减）。不要不经用户同意就把 cuts 全部提交：背景音乐、环境声盖住的空档找不到，安静的讲话可能被当成空档，先用 videos_frames 或听一段核对。',
      `错误码：ASSET_NOT_FOUND、AUDIO_NO_STREAM（没有音轨，换 method motion）、AUDIO_TOO_LONG（超过 ${MAX_ANALYSIS_SECONDS / 60} 分钟，分段给 range）、AUDIO_DECODE_FAILED、PATH_OUTSIDE_WORKSPACE。`,
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '找一段录音里的空档', args: { video: 'demo', asset: 'asset_01J…' } },
      { title: '屏幕录制：声音和画面都没动静才算', args: { video: 'demo', asset: 'asset_01J…', method: 'both', minCut: 1 } },
      { title: '有底噪的工作目录文件', args: { video: 'demo', path: 'raw/take1.mp4', threshold: 0.1 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
};

export class AudioTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: AudioToolsDeps;

  constructor(deps: AudioToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'assets_sfx':
        return this.#sfx(args as SfxArgs, principal);
      case 'assets_analyze':
        return this.#analyze(args as AnalyzeArgs, principal);
      case 'assets_dead_air':
        return this.#deadAir(args as DeadAirArgs, principal);
    }
    throw new ToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
  }

  async #sfx(args: SfxArgs, principal: ToolPrincipal) {
    const { scope, videos } = this.#deps;
    const access = scope.authorize(principal, true);
    const spec = {
      recipe: args.recipe,
      ...(args.seconds !== undefined ? { seconds: args.seconds } : {}),
      pitch: args.pitch ?? 0,
      seed: args.seed ?? 0,
      ...(args.space ? { space: args.space } : {}),
    };
    let wav: Uint8Array;
    try {
      wav = sfxRender(spec);
    } catch (error) {
      throw wasmError(error, 'SFX_RENDER_FAILED');
    }
    const durationSeconds = Math.round(((wav.length - 44) / 4 / 48_000) * 1000) / 1000;
    const name = args.name ?? `SFX ${args.recipe}`;
    const approval = await scope.confirm(access, {
      tool: 'assets_sfx',
      video: args.video,
      ...confirmSummary(RcAgentTools.sfxSummary({ recipe: args.recipe, place: Boolean(args.place) })),
    });
    const opened = await scope.open(args.video, access);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-sfx-'));
    try {
      const file = path.join(work, `sfx-${args.recipe}-${spec.seed}.wav`);
      await fs.writeFile(file, wav);
      const operations: Record<string, unknown>[] = [
        {
          type: 'importAsset',
          path: file,
          name,
          storage: 'managed',
          provenance: { origin: 'procedural-sfx', source: spec },
          ref: SFX_REF,
        },
      ];
      if (args.place) {
        const { track, at } = args.place;
        operations.push({
          type: 'addItem',
          asset: { ref: SFX_REF },
          ...(track !== undefined && track !== 'main' ? { trackId: track } : {}),
          ...(at !== undefined && at !== 'end' ? { at: Number(at) } : {}),
          name,
        });
      }
      const video = videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
      const result = await this.#apply(access, opened, principal, {
        expectedRevision: args.revision ?? video.revision,
        label: RcAgentTools.importAssetLabel({ name, place: Boolean(args.place) }).text,
        operations,
        commandId: args.commandId,
      });
      const after = videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
      const created = new Set(result.receipt.createdIds);
      const item = args.place ? (after.sequences[after.rootSequenceId]?.items.find((it) => created.has(it.id)) ?? null) : null;
      return {
        ...digestReceipt(result.receipt, after.sequences[after.rootSequenceId]!.fps, result.replayed),
        assetId: result.receipt.refs?.[SFX_REF] ?? null,
        itemId: item?.id ?? null,
        recipe: args.recipe,
        durationSeconds,
        ...approvalField(approval),
      };
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  async #analyze(args: AnalyzeArgs, principal: ToolPrincipal) {
    const { scope, videos } = this.#deps;
    const access = scope.authorize(principal, false);
    const opened = await scope.open(args.video, access);
    const videoId = opened.ref.videoId;
    const video = videos.mirror(videoId)?.video ?? opened.snapshot.video;
    const { file, label } = await this.#source(args, access, opened, video);
    const [start, end] = args.range ? args.range.split(':').map(Number) : [0, null];
    if (end !== null && end! <= start!) {
      throw new ToolError('INVALID_ARGUMENTS', `range end ${end} must be after its start ${start}`);
    }
    if (end !== null && end! - start! > MAX_ANALYSIS_SECONDS) throw tooLong();
    if (args.sheet && end !== null && end! - start! > MAX_SHEET_SECONDS) throw sheetTooLong();
    const ffmpeg = await this.#deps.ffmpeg();
    const pcm = await decodeMono(ffmpeg, file, start!, end);
    if (args.sheet && pcm.length > MAX_SHEET_SECONDS * ANALYSIS_RATE) throw sheetTooLong();
    const sequence = video.sequences[video.rootSequenceId]!;
    const fps = args.fps ?? sequence.fps.num / sequence.fps.den;
    // 时刻是源文件里的秒；分析的时钟从 range 的起点算起。
    const cues = args.cues?.map((t) => t - start!);
    const shared = {
      sampleRate: ANALYSIS_RATE,
      beats: args.beats ?? true,
      ...(args.beatsPerBar !== undefined ? { beatsPerBar: args.beatsPerBar } : {}),
      ...(cues ? { cues } : {}),
      ...(args.tolerance !== undefined ? { tolerance: args.tolerance } : {}),
    };
    let analysis: AudioAnalysis;
    try {
      analysis = audioAnalysis(pcm, { ...shared, fps });
    } catch (error) {
      throw wasmError(error, 'AUDIO_ANALYSIS_FAILED');
    }
    if (analysis.sync && args.cues) {
      const given = args.cues;
      analysis.sync.cues = analysis.sync.cues.map((cue, index) => ({ ...cue, t: given[index]! }));
    }
    const source = {
      ...(args.asset !== undefined ? { asset: args.asset } : { path: file }),
      offset: start!,
      ...(end !== null ? { end } : {}),
    };
    const dir = await framesDirectory(scope.saveRoot(access, opened), videoId, null, ANALYSIS_DIR);
    const base = path.join(dir, `${safeName(label)}${args.range ? `-${ms(start!)}-${ms(end!)}ms` : ''}`);
    const out = `${base}.json`;
    await fs.writeFile(out, `${JSON.stringify({ schema: 'baocut.audio-analysis/1', source, sampleRate: ANALYSIS_RATE, ...analysis })}\n`);
    let sheet: string | null = null;
    if (args.sheet) {
      let image: ReturnType<typeof audioSheet>;
      try {
        image = audioSheet(pcm, { ...shared, width: SHEET_WIDTH });
      } catch (error) {
        throw wasmError(error, 'AUDIO_SHEET_FAILED');
      }
      sheet = `${base}.png`;
      await encodePng(ffmpeg, image, sheet);
    }
    const beats = analysis.beats;
    const sync = analysis.sync;
    return {
      file: out,
      ...(sheet ? { sheet } : {}),
      source,
      fps: analysis.fps,
      frameCount: analysis.frameCount,
      duration: analysis.duration,
      onsetCount: analysis.onsets.length,
      onsets: analysis.onsets.slice(0, INLINE_ONSETS),
      beats: beats
        ? {
            tempo: beats.tempo,
            confidence: beats.confidence,
            downbeat: beats.downbeat,
            beatsPerBar: beats.beatsPerBar,
            beatCount: beats.times.length,
            barCount: beats.bars.length,
            sections: beats.sections,
          }
        : null,
      ...(analysis.beatsError ? { beatsError: analysis.beatsError } : {}),
      accentCount: analysis.accents.length,
      accents: analysis.accents.slice(0, INLINE_EVENTS),
      ...(sync
        ? {
            sync: {
              tolerance: sync.tolerance,
              nearTolerance: sync.nearTolerance,
              inside: sync.inside,
              ok: sync.ok,
              near: sync.near,
              none: sync.none,
              outside: sync.outside,
              hitRate: sync.hitRate,
              chance: sync.chance,
              misses: sync.cues.filter((cue) => cue.status !== 'ok').slice(0, INLINE_EVENTS),
            },
          }
        : {}),
      next: 'Times and frame 0 start at source.offset seconds into the source file. Copy the file into the code bundle; at source time s read frames.*[Math.floor((s - source.offset) * fps)].',
    };
  }

  /** 按素材或文件定位要分析的文件。 */
  async #source(args: { asset?: string | undefined; path?: string | undefined }, access: ToolAccess, opened: VideoOpenResult, video: { assets: Record<string, unknown> }) {
    const { scope, videos } = this.#deps;
    if ((args.asset === undefined) === (args.path === undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'Give exactly one of asset or path');
    }
    if (args.asset !== undefined) {
      if (!video.assets[args.asset]) {
        throw new ToolError('ASSET_NOT_FOUND', `No asset ${args.asset} in this video`, {
          next: 'Read asset IDs from videos_inspect',
        });
      }
      // `file` 是相对 `root` 的路径。
      const located = await videos.assetFile(opened.ref.videoId, args.asset);
      return { file: path.resolve(located.root, located.file), label: args.asset };
    }
    // 与 assets_import 同一个基准：对外服务只能读项目目录里的文件。
    const base = scope.importBase(access, opened);
    const file = resolveUserPath(args.path!, base.cwd);
    if (base.confine !== null) {
      const real = await fs.realpath(file).catch(() => file);
      if (!inside(real, await fs.realpath(base.confine))) {
        throw new ToolError('PATH_OUTSIDE_WORKSPACE', `${args.path} is outside the project directory`, {
          next: 'Import the file into the video first and analyze it by asset',
        });
      }
    }
    return { file, label: path.parse(file).name };
  }

  async #deadAir(args: DeadAirArgs, principal: ToolPrincipal) {
    const { scope, videos } = this.#deps;
    const access = scope.authorize(principal, false);
    const opened = await scope.open(args.video, access);
    const video = videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
    const { file } = await this.#source(args, access, opened, video);
    const [start, end] = args.range ? (args.range.split(':').map(Number) as [number, number]) : [0, null];
    if (end !== null && end <= start) throw new ToolError('INVALID_ARGUMENTS', `range end ${end} must be after its start ${start}`);
    if (end !== null && end - start > MAX_ANALYSIS_SECONDS) throw tooLong();
    const method = args.method ?? 'audio';
    const ffmpeg = await this.#deps.ffmpeg();
    let activity: Uint8Array | null = null;
    let duration = 0;
    if (method !== 'motion') {
      const pcm = await decodeMono(ffmpeg, file, start, end);
      if (pcm.length === 0) throw new ToolError('AUDIO_EMPTY', 'The audio is empty');
      duration = pcm.length / ANALYSIS_RATE;
      activity = audioActivity(pcm, ANALYSIS_RATE, args.threshold ?? DEFAULT_AUDIO_THRESHOLD);
    }
    if (method !== 'audio') {
      const ratios = await decodeMotion(ffmpeg, file, start, end);
      duration = Math.max(duration, ratios.length / MOTION_FPS);
      const ticks = activity?.length ?? Math.ceil(duration / DEAD_AIR_TICK);
      const moving = motionActivity(ratios, MOTION_FPS, args.motionThreshold ?? DEFAULT_MOTION_THRESHOLD, ticks);
      activity = activity ? combineActivity(activity, moving) : moving;
    }
    const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
    const cuts = deadRanges(activity!, {
      margin: args.margin ?? DEFAULT_MARGIN,
      minCut: args.minCut ?? DEFAULT_MIN_CUT,
      minKeep: args.minKeep ?? DEFAULT_MIN_KEEP,
    }).map((range) => ({ from: round(start + range.from), to: round(Math.min(start + range.to, start + duration)) }));
    const deadSeconds = round(cuts.reduce((sum, cut) => sum + (cut.to - cut.from), 0));
    return {
      source: { ...(args.asset !== undefined ? { asset: args.asset } : { path: file }), offset: start, ...(end !== null ? { end } : {}) },
      method,
      duration: round(duration),
      deadSeconds,
      keptSeconds: round(duration - deadSeconds),
      cuts,
      ...(args.asset !== undefined && cuts.length > 0 ? { operation: { type: 'addCuts', assetId: args.asset, cuts } } : {}),
      next:
        cuts.length === 0
          ? 'Nothing to cut at these settings. If there is background noise, raise threshold.'
          : 'Check a few of these against the picture or the sound before cutting. Then put operation into edits_apply (drop any range you want to keep); each cut can be undone and restored.',
    };
  }

  async #apply(
    access: ToolAccess,
    opened: VideoOpenResult,
    principal: ToolPrincipal,
    edit: { expectedRevision: string; label: string; operations: Record<string, unknown>[]; commandId?: string | undefined },
  ): Promise<EditResult> {
    const { videos, scope } = this.#deps;
    const videoId = opened.ref.videoId;
    const taskId = (access as { taskId?: unknown }).taskId;
    const result = await videos.apply(
      {
        videoId,
        commandId: scope.commandId(access, edit.commandId),
        expectedRevision: edit.expectedRevision,
        operations: edit.operations as never,
        label: edit.label,
      },
      principal,
      { ...(typeof taskId === 'string' ? { taskId } : {}), protections: scope.protections?.(access, videoId) ?? [] },
    );
    scope.recordChange(access, videoChangeOf(videos, opened, result));
    return result;
  }
}

/** 量画面变化时的帧率与缩小后的宽度：足够看出有没有动静，20 分钟也只有约 200 MB 要过一遍。 */
const MOTION_FPS = 10;
const MOTION_WIDTH = 160;

/** 逐帧的画面变化比例（灰度、缩小）；边读边算，不把画面留在内存里。 */
async function decodeMotion(ffmpeg: string, file: string, start: number, end: number | null): Promise<number[]> {
  // 宽度固定，高度由 ffmpeg 按比例定：取偶数的高度要先问一次第一帧。这里固定成 90，比例不重要，只比较相邻两帧。
  const height = 90;
  const frameBytes = MOTION_WIDTH * height;
  const limit = MAX_ANALYSIS_SECONDS * MOTION_FPS * frameBytes;
  const args = [
    '-nostdin',
    '-v',
    'error',
    ...(start > 0 ? ['-ss', String(start)] : []),
    ...(end !== null ? ['-t', String(end - start)] : []),
    '-i',
    file,
    '-map',
    '0:v:0',
    '-an',
    '-vf',
    `fps=${MOTION_FPS},scale=${MOTION_WIDTH}:${height},format=gray`,
    '-f',
    'rawvideo',
    'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const ratios: number[] = [];
    let previous: Uint8Array | null = null;
    let pending: Buffer = Buffer.alloc(0);
    let size = 0;
    let stderr = '';
    let over = false;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        over = true;
        child.kill();
        return;
      }
      pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      while (pending.length - offset >= frameBytes) {
        const frame = pending.subarray(offset, offset + frameBytes);
        ratios.push(previous ? motionRatio(previous, frame) : 0);
        previous = Uint8Array.from(frame);
        offset += frameBytes;
      }
      pending = pending.subarray(offset);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.on('error', (error) => reject(new ToolError('AUDIO_DECODE_FAILED', `ffmpeg could not start: ${error.message}`)));
    child.on('close', (code) => {
      if (over) return reject(tooLong());
      if (code !== 0) {
        return reject(new ToolError('AUDIO_DECODE_FAILED', `ffmpeg could not read the picture (exit code ${code}): ${stderr.trim().slice(-400)}`));
      }
      resolve(ratios);
    });
  });
}

function sheetTooLong(): ToolError {
  return new ToolError('AUDIO_SHEET_TOO_LONG', `A listening sheet covers at most ${MAX_SHEET_SECONDS} seconds`, {
    next: `Pass range as "start:end" seconds of at most ${MAX_SHEET_SECONDS} seconds, or drop sheet to analyze the whole file`,
  });
}

/** RGBA 像素经一个临时文件交给 ffmpeg 编成 PNG。 */
async function encodePng(ffmpeg: string, image: { width: number; height: number; rgba: Uint8Array }, output: string): Promise<void> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-sheet-'));
  try {
    const raw = path.join(work, 'sheet.rgba');
    await fs.writeFile(raw, image.rgba);
    const args = [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${image.width}x${image.height}`,
      '-i',
      raw,
      '-frames:v',
      '1',
      '-c:v',
      'png',
      '-y',
      output,
    ];
    const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let text = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        text = (text + chunk).slice(-4000);
      });
      child.on('error', reject);
      child.on('close', (exit) => resolve({ code: exit, stderr: text }));
    }).catch((error: Error) => {
      throw new ToolError('AUDIO_SHEET_FAILED', `ffmpeg could not start: ${error.message}`);
    });
    if (code !== 0) {
      throw new ToolError(
        'AUDIO_SHEET_FAILED',
        `ffmpeg failed to encode the listening sheet (exit code ${code}): ${stderr.trim().slice(-400)}`,
        {
          next: 'The analysis JSON was written; check that ffmpeg is available (BAOCUT_FFMPEG or ffmpeg on PATH)',
        },
      );
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function tooLong(): ToolError {
  return new ToolError('AUDIO_TOO_LONG', `Analysis covers at most ${MAX_ANALYSIS_SECONDS / 60} minutes at a time`, {
    next: 'Pass range as "start:end" seconds and analyze the audio in pieces',
  });
}

/** ffmpeg 解码成 22.05 kHz 单声道 f32；超过上限就停下报 AUDIO_TOO_LONG。 */
export async function decodeMono(ffmpeg: string, file: string, start: number, end: number | null): Promise<Float32Array> {
  const limit = MAX_ANALYSIS_SECONDS * ANALYSIS_RATE * 4;
  // 节拍、起音与提示点都按 range 的起点算回源文件的秒：起点差一点，这些时刻就都差一点。
  const window = audioWindow(start, end !== null ? end - start : null);
  const args = [
    '-nostdin',
    '-v',
    'error',
    ...window.inputArgs,
    '-i',
    file,
    '-map',
    '0:a:0',
    ...(window.filters.length > 0 ? ['-af', window.filters.join(',')] : []),
    '-ac',
    '1',
    '-ar',
    String(ANALYSIS_RATE),
    '-f',
    'f32le',
    'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let over = false;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        over = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on('error', (error) => reject(new ToolError('AUDIO_DECODE_FAILED', `ffmpeg could not start: ${error.message}`)));
    child.on('close', (code) => {
      if (over) return reject(tooLong());
      if (code !== 0) {
        if (/matches no streams|does not contain any stream|Output file .* does not contain/i.test(stderr)) {
          return reject(new ToolError('AUDIO_NO_STREAM', `${path.basename(file)} has no audio stream`));
        }
        return reject(
          new ToolError('AUDIO_DECODE_FAILED', `ffmpeg failed to decode ${path.basename(file)}: ${stderr.trim().slice(0, 500)}`),
        );
      }
      const bytes = Buffer.concat(chunks);
      const aligned = new Uint8Array(bytes.length - (bytes.length % 4));
      aligned.set(bytes.subarray(0, aligned.length));
      resolve(new Float32Array(aligned.buffer));
    });
  });
}

function wasmError(error: unknown, fallback: string): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof EditorWasmError) return new ToolError(error.code, error.message);
  const code = (error as { code?: unknown } | null)?.code;
  return new ToolError(typeof code === 'string' ? code : fallback, error instanceof Error ? error.message : String(error));
}

function ms(seconds: number): number {
  return Math.round(seconds * 1000);
}

function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'audio';
}
