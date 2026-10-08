import { spawn } from 'node:child_process';
import path from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import {
  refOf,
  type AudioExportFormat,
  type ExportValidation,
  type JobWarning,
  type Localized,
  type LoudnessTarget,
  type MessageRef,
} from '@baocut/protocol';
import { RcCommon, RcExport } from '@baocut/protocol/messages/runtime-core';
import type { AudioPlan, AudioSegment, PlannedAsset } from './export-plan.ts';

/**
 * 音频导出（架构设计 §9.13）：引擎给出声音的区间计划（哪些实例发声、取素材的哪一段、放在哪里、增益与淡变，
 * `render-graph` 的 `audio_plan`，与预览同一套发声规则），这里只把它翻成 ffmpeg 的滤镜图：
 *
 * 1. 混音：一路精确长度的静音打底，每段 `-ss/-t` 取源 → 统一采样率与声道 → `atempo`（速度与预览一样保持音高）
 *    → 按样本数裁齐 → 增益（dB）→ 逐样本的振幅系数（淡变线性、淡入淡出重叠时取较小的；转场的声音交叉淡化等功率；
 *    闪避压低量按折点线性插值；三者相乘，与计划的 `gain_db_at` 一致）→ 按样本数延迟到位置，
 *    `amix normalize=0` 直接相加，写成 staging 里的 32 位浮点 WAV；
 * 2. 响度标准化（开了时）：Render Worker 的 `master` 子命令把混音做成目标响度（v2 的母带链：BS.1770 积分响度归一与
 *    真峰值限幅交替三轮，再按真峰值静态兜底，逐位确定），写成 staging 里的 32 位浮点裸 PCM，实测写进校验结果；
 * 3. 编码：WAV（16 位）、MP3（libmp3lame）或 M4A（AAC）；
 * 4. 校验：ffprobe 解码整个文件，时长在容差内、采样率与声道数符合设置。
 */

export interface ToolCommand {
  command: string;
  env?: NodeJS.ProcessEnv;
}

export interface AudioOutputSettings {
  format: AudioExportFormat;
  sampleRate: number;
  channels: 1 | 2;
  bitrateKbps: number;
  loudness: Required<LoudnessTarget> | null;
}

export const DEFAULT_SAMPLE_RATE = 48_000;
export const DEFAULT_CHANNELS = 2;
export const DEFAULT_BITRATE_KBPS = 192;

const ENCODERS: Record<AudioExportFormat, { encoder: string; muxer: string; extra: string[] }> = {
  wav: { encoder: 'pcm_s16le', muxer: 'wav', extra: [] },
  mp3: { encoder: 'libmp3lame', muxer: 'mp3', extra: [] },
  m4a: { encoder: 'aac', muxer: 'ipod', extra: ['-movflags', '+faststart'] },
};

/** 时长的容差：WAV 是采样精确的，有损格式有编码器的前后填充。 */
const TOLERANCE_SEC: Record<AudioExportFormat, number> = { wav: 0.01, mp3: 0.1, m4a: 0.1 };

export class ToolFailure extends Error {
  readonly kind: 'missing' | 'failed' | 'aborted';
  /** 出事的是哪个工具（可执行文件名，如 `ffmpeg`、`export-worker`）；取消时没有。 */
  readonly tool: string | null;
  readonly messageRef: MessageRef | undefined;
  constructor(kind: 'missing' | 'failed' | 'aborted', message: string | Localized, tool: string | null = null) {
    super(String(message));
    this.kind = kind;
    this.tool = tool;
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }
}

/** 跑一个外部工具：取消信号到时杀掉进程。stderr 只留最后 64 KB。 */
export function runTool(
  tool: ToolCommand,
  args: string[],
  signal?: AbortSignal,
  onStdout?: (chunk: string) => void,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ToolFailure('aborted', RcCommon.cancelled()));
    const child = spawn(tool.command, args, { env: tool.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (onStdout) onStdout(chunk);
      else if (stdout.length < 4_000_000) stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-65_536);
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener('abort', abort);
      const name = path.basename(tool.command);
      reject(new ToolFailure(error.code === 'ENOENT' ? 'missing' : 'failed', RcExport.toolStartFailed({ tool: name, error: error.message }), name));
    });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new ToolFailure('aborted', RcCommon.cancelled()));
      if (code === 0) return resolve({ stdout, stderr });
      const tail = stderr.trim().split('\n').slice(-3).join(' / ');
      const name = path.basename(tool.command);
      reject(new ToolFailure('failed', RcExport.toolExited({ tool: name, code: String(code), output: tail }), name));
    });
  });
}

/**
 * 预检：ffmpeg 与 ffprobe 在不在，ffmpeg 有没有要用的编码器与滤镜（`amix` 的 `normalize` 要 ffmpeg 4.4 以上）。
 * 返回缺的东西（可执行文件名，或说明缺哪个编码器、滤镜的文字）；都在时 null。
 */
export async function missingAudioTools(
  ffmpeg: ToolCommand,
  ffprobe: ToolCommand,
  settings: Pick<AudioOutputSettings, 'format'>,
): Promise<string | Localized | null> {
  try {
    await runTool(ffprobe, ['-hide_banner', '-version']);
  } catch {
    return 'ffprobe';
  }
  let encoders: string;
  let amix: string;
  try {
    encoders = (await runTool(ffmpeg, ['-hide_banner', '-encoders'])).stdout;
    amix = (await runTool(ffmpeg, ['-hide_banner', '-h', 'filter=amix'])).stdout;
  } catch {
    return 'ffmpeg';
  }
  const encoder = ENCODERS[settings.format].encoder;
  if (!new RegExp(`^\\s*A\\S*\\s+${encoder}\\s`, 'm').test(encoders)) return RcExport.ffmpegEncoder({ encoder });
  if (!/\bnormalize\b/.test(amix)) return RcExport.ffmpegAmixNormalize();
  for (const filter of ['atempo', 'aeval', 'adelay', 'anullsrc']) {
    try {
      const help = await runTool(ffmpeg, ['-hide_banner', '-h', `filter=${filter}`]);
      if (/Unknown filter/i.test(help.stdout + help.stderr)) return RcExport.ffmpegFilter({ filter });
    } catch {
      return RcExport.ffmpegFilter({ filter });
    }
  }
  return null;
}

function fixed(value: number): string {
  return Number(value.toFixed(6)).toString();
}

/** `atempo` 链：老版本每级只接受 0.5–2，超出的拆成几级。 */
function tempoChain(rate: number): string[] {
  if (Math.abs(rate - 1) < 1e-9) return [];
  const chain: string[] = [];
  let rest = rate;
  while (rest > 2) {
    chain.push('atempo=2');
    rest /= 2;
  }
  while (rest < 0.5) {
    chain.push('atempo=0.5');
    rest /= 0.5;
  }
  if (Math.abs(rest - 1) > 1e-9) chain.push(`atempo=${fixed(rest)}`);
  return chain;
}

/** 淡变的逐样本增益：`t` 是这一段里的秒（从 0 开始）。 */
function fadeExpression(segment: AudioSegment): string | null {
  const terms: string[] = [];
  if (segment.fadeIn) {
    const a = segment.fadeIn.start - segment.start;
    const b = segment.fadeIn.end - segment.start;
    if (b > a) terms.push(`clip((t-(${fixed(a)}))/${fixed(b - a)},0,1)`);
  }
  if (segment.fadeOut) {
    const c = segment.fadeOut.start - segment.start;
    const d = segment.fadeOut.end - segment.start;
    if (d > c) terms.push(`clip((${fixed(d)}-t)/${fixed(d - c)},0,1)`);
  }
  if (terms.length === 0) return null;
  return terms.length === 1 ? terms[0]! : `min(${terms[0]},${terms[1]})`;
}

/** 转场交叉淡化的逐样本振幅（等功率，与帧计划同一条曲线）。 */
function crossfadeExpression(segment: AudioSegment): string[] {
  return (segment.crossfades ?? [])
    .filter((fade) => fade.end > fade.start)
    .map((fade) => {
      const a = fade.start - segment.start;
      const p = `clip((t-(${fixed(a)}))/${fixed(fade.end - fade.start)},0,1)`;
      return `${fade.role === 'outgoing' ? 'cos' : 'sin'}(PI/2*${p})`;
    });
}

/**
 * 折点 `[秒, 值]` 连成的分段线性函数，写成 ffmpeg 表达式：按折点切成区间，用二分嵌套的 `if(lt(t,…))` 选区间，
 * 每个样本只比较 log₂(区间数) 次。第一个折点之前取 `before`，最后一个之后保持最后的值；同一时刻两个折点时，到了那一刻
 * 取后一个；值相同的区间不带插值项。`t` 是这一段里的秒，折点已换到这个时钟。
 */
function piecewiseExpression(knots: ReadonlyArray<readonly [number, number]>, before: number): string {
  // pieces[j] 管 [bounds[j-1], bounds[j])。
  const bounds: number[] = [knots[0]![0]];
  const pieces: string[] = [fixed(before)];
  for (let i = 0; i + 1 < knots.length; i++) {
    const [t0, v0] = knots[i]!;
    const [t1, v1] = knots[i + 1]!;
    if (!(t1 > t0)) continue;
    pieces.push(v0 === v1 ? fixed(v0) : `(${fixed(v0)}+(${fixed(v1 - v0)})*(t-(${fixed(t0)}))/${fixed(t1 - t0)})`);
    bounds.push(t1);
  }
  pieces.push(fixed(knots[knots.length - 1]![1]));
  const pick = (lo: number, hi: number): string => {
    if (lo === hi) return pieces[lo]!;
    const mid = (lo + hi + 1) >> 1;
    return `if(lt(t,${fixed(bounds[mid - 1]!)}),${pick(lo, mid - 1)},${pick(mid, hi)})`;
  };
  return pick(0, pieces.length - 1);
}

/**
 * 闪避压低量（dB）随 `t` 的表达式：第一个折点之前是 0。语义与 `render-graph` 的 `knots_at` 相同。没有压低时 null。
 */
export function duckingExpression(segment: Pick<AudioSegment, 'start' | 'ducking'>): string | null {
  const knots = (segment.ducking ?? []).map(([at, db]) => [at - segment.start, db] as const);
  if (knots.length === 0 || knots.every(([, db]) => db === 0)) return null;
  return piecewiseExpression(knots, 0);
}

/**
 * 音量包络（线性倍数）随 `t` 的表达式：两端保持第一个与最后一个折点的值，语义与 `render-graph` 的 `envelope_at`
 * （预览用的 `GainEnvelope::at`）相同。只有一个值时是常数；没有包络或处处是 1 时 null。
 */
export function envelopeExpression(segment: Pick<AudioSegment, 'start' | 'envelope'>): string | null {
  const knots = (segment.envelope ?? []).map(([at, gain]) => [at - segment.start, gain] as const);
  if (knots.length === 0 || knots.every(([, gain]) => gain === 1)) return null;
  if (knots.every(([, gain]) => gain === knots[0]![1])) return fixed(knots[0]![1]);
  return piecewiseExpression(knots, knots[0]![1]);
}

/** 这一段逐样本的振幅系数：包络 × 淡变 × 交叉淡化 × 闪避；都没有时 null。实例的固定增益另用 `volume`。 */
export function gainExpression(segment: AudioSegment): string | null {
  const factors: string[] = [];
  const envelope = envelopeExpression(segment);
  if (envelope) factors.push(envelope);
  const fade = fadeExpression(segment);
  if (fade) factors.push(fade);
  factors.push(...crossfadeExpression(segment));
  const ducking = duckingExpression(segment);
  if (ducking) factors.push(`pow(10,-(${ducking})/20)`);
  return factors.length === 0 ? null : factors.join('*');
}

/**
 * ffmpeg 从文件读滤镜图的选项：7.0 起是 `-/filter_complex <文件>`（`-filter_complex_script` 弃用），更早的版本只认
 * `-filter_complex_script <文件>`。
 */
export type FilterScriptOption = '-/filter_complex' | '-filter_complex_script';

/** 按 `ffmpeg -h long` 的说明挑：说明里提到 `-/filter_complex`（旧选项的弃用说明）的认新写法，否则用旧选项。 */
export function filterScriptOption(help: string): FilterScriptOption {
  return /-\/filter_complex\b/.test(help) ? '-/filter_complex' : '-filter_complex_script';
}

const scriptOptions = new Map<string, Promise<FilterScriptOption>>();

/** 这个 ffmpeg 认哪种写法（按命令缓存；问不出来时用旧选项，不缓存）。 */
export function detectFilterScriptOption(ffmpeg: ToolCommand): Promise<FilterScriptOption> {
  const known = scriptOptions.get(ffmpeg.command);
  if (known) return known;
  const asked = runTool(ffmpeg, ['-hide_banner', '-h', 'long']).then(
    ({ stdout }) => filterScriptOption(stdout),
    () => {
      scriptOptions.delete(ffmpeg.command);
      return '-filter_complex_script' as const;
    },
  );
  scriptOptions.set(ffmpeg.command, asked);
  return asked;
}

/**
 * 混音的 ffmpeg 参数（纯函数，便于测试）：输出是 `outFile`（32 位浮点 WAV），长度是范围的样本数。
 * `assets` 以 `<assetId>@<revision>` 为键。
 *
 * 滤镜图不放在命令行上：烘焙得很密的音量包络与闪避能让它长到几百 KB 以上，超过单个参数（Linux 128 KiB）或整条命令行
 * （macOS 1 MiB、Windows 32K 字符）的上限。调用方把 `graph` 写进 `script.file`，参数里只有读它的选项与文件名。
 */
export function mixArgs(
  plan: AudioPlan,
  assets: Map<string, PlannedAsset>,
  sampleRate: number,
  channels: 1 | 2,
  outFile: string,
  script: { option: FilterScriptOption; file: string },
): { args: string[]; graph: string } {
  const layout = channels === 2 ? 'stereo' : 'mono';
  const total = Math.round(plan.range.durationSeconds * sampleRate);
  const args = ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats'];
  args.push('-f', 'lavfi', '-t', fixed(plan.range.durationSeconds + 0.1), '-i', `anullsrc=r=${sampleRate}:cl=${layout}`);
  const filters: string[] = [];
  const labels: string[] = ['[0:a]'];
  plan.segments.forEach((segment, i) => {
    const asset = assets.get(`${segment.asset.id}@${segment.asset.revision}`);
    if (!asset) throw new Error(RcExport.planAssetNotFrozen({ assetId: segment.asset.id }).text);
    const length = segment.end - segment.start;
    // 多取一点源，裁齐由 atrim 按样本数做。
    args.push('-ss', fixed(segment.sourceStart), '-t', fixed(length * segment.sourceRate + 0.1), '-i', `file:${asset.path}`);
    const chain: string[] = [];
    const sourceChannels = asset.audio?.channels ?? 2;
    // 浏览器把单声道放到两个声道上（不衰减），立体声缩混成单声道取平均；ffmpeg 默认的上下混不同，显式写出来。
    if (channels === 2 && sourceChannels === 1) chain.push('pan=stereo|c0=c0|c1=c0');
    else if (channels === 1 && sourceChannels === 2) chain.push('pan=mono|c0=0.5*c0+0.5*c1');
    chain.push(`aresample=${sampleRate}`, `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}`);
    chain.push(...tempoChain(segment.sourceRate));
    chain.push(`atrim=end_sample=${Math.max(1, Math.round(length * sampleRate))}`, 'asetpts=PTS-STARTPTS');
    if (segment.gainDb !== 0) chain.push(`volume=${fixed(segment.gainDb)}dB`);
    const gain = gainExpression(segment);
    if (gain) chain.push(`aeval='val(ch)*${gain}':c=same`);
    const delay = Math.round(segment.start * sampleRate);
    if (delay > 0) chain.push(`adelay=delays=${delay}S:all=1`);
    filters.push(`[${i + 1}:a:0]${chain.join(',')}[s${i}]`);
    labels.push(`[s${i}]`);
  });
  if (plan.segments.length === 0) filters.push(`[0:a]atrim=end_sample=${total}[out]`);
  else {
    filters.push(
      `${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0,atrim=end_sample=${total},asetpts=PTS-STARTPTS[out]`,
    );
  }
  args.push(script.option, script.file, '-map', '[out]', '-c:a', 'pcm_f32le', '-f', 'wav', `file:${outFile}`);
  return { args, graph: filters.join(';') };
}

/** 编码的 ffmpeg 参数：输入是混音的 WAV，或母带写出的裸 PCM（`f32le`，交错，采样率与声道同输出）。 */
function encodeArgs(input: string, output: string, settings: AudioOutputSettings, raw: boolean): string[] {
  const { encoder, muxer, extra } = ENCODERS[settings.format];
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-v',
    'error',
    ...(raw ? ['-f', 'f32le', '-ar', String(settings.sampleRate), '-ac', String(settings.channels)] : []),
    '-i',
    `file:${input}`,
    '-ar',
    String(settings.sampleRate),
    '-ac',
    String(settings.channels),
    '-c:a',
    encoder,
    ...(settings.format === 'wav' ? [] : ['-b:a', `${settings.bitrateKbps}k`]),
    ...extra,
    '-f',
    muxer,
    `file:${output}`,
  ];
}

/** 母带的请求（Render Worker `master` 的输入，`baocut` 内部格式，不认识的字段 Worker 拒绝）。 */
export interface MasterRequest {
  /** 混音：32 位浮点的 WAV。 */
  input: string;
  /** 写出的裸 PCM（`f32le`，交错）。 */
  output: string;
  /** 中间文件放在这里。 */
  staging: string;
  sampleRate: number;
  channels: 1 | 2;
  lufs: number;
  truePeak: number;
}

/** 母带实测（Worker 的 `mastered` 一行）：响度测不出时 `inputLufs` 是 −200，这时不做响度归一，只做真峰值限幅与兜底。 */
export interface MasterMeasure {
  inputLufs: number;
  lufs: number;
  truePeak: number;
  staticGainDb: number;
}

/** 跑一次母带：写好输入文件之后调用 Worker（`runWorker(worker, 'master', …)`）。`onProgress` 是 Worker 报的已处理量与总量。 */
export type MasterRunner = (
  inputFile: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
) => Promise<MasterMeasure>;

/**
 * 开了响度标准化时，一段输出的进度条里混音占的份额，其余归母带。是进度条上的分配，不是实测的耗时比例：
 * 两步都按各自的完成比例往前走，母带跑的时候进度条不再停在混音结束处。
 */
export const MIX_PROGRESS_SHARE = 0.5;

/** 低于它的积分响度算测不出（`audio-dsp` 的 `SILENCE_LUFS` 是 −200）。 */
const UNMEASURABLE_LUFS = -199;

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export interface AudioRenderResult {
  file: string;
  media: { kind: 'audio'; durationSec: number; sampleRate: number; channels: number };
  validation: ExportValidation;
  warnings: JobWarning[];
}

/** 混音 → （测量响度）→ 编码 → ffprobe 校验。不通过时抛 `AudioValidationError`。 */
export async function renderAudio(options: {
  plan: AudioPlan;
  assets: Map<string, PlannedAsset>;
  settings: AudioOutputSettings;
  staging: string;
  /** staging 里的输出文件名（带扩展名）。 */
  outName: string;
  ffmpeg: ToolCommand;
  ffprobe: ToolCommand;
  /** 开了响度标准化时必须给。 */
  master?: MasterRunner;
  signal: AbortSignal;
  /**
   * 这段输出做到哪儿，按输出的秒数计（0 到时长）。开了响度标准化时混音走到 `MIX_PROGRESS_SHARE` 处，母带按它报的完成比例
   * 走完其余的部分。
   */
  progress?: (doneSeconds: number) => void;
}): Promise<AudioRenderResult> {
  const { plan, settings, staging, ffmpeg, signal } = options;
  const duration = plan.range.durationSeconds;
  const mixShare = settings.loudness ? MIX_PROGRESS_SHARE : 1;
  const warnings: JobWarning[] = [];
  const mixFile = path.join(staging, `${path.parse(options.outName).name}.mix.wav`);
  const graphFile = path.join(staging, `${path.parse(options.outName).name}.mix.graph`);
  const outFile = path.join(staging, options.outName);
  const script = { option: await detectFilterScriptOption(ffmpeg), file: graphFile };
  const mix = mixArgs(plan, options.assets, settings.sampleRate, settings.channels, mixFile, script);
  await writeFile(graphFile, mix.graph);
  await runTool(ffmpeg, mix.args, signal, (chunk) => {
    const match = /out_time_us=(\d+)/g;
    let last: RegExpExecArray | null = null;
    for (let m = match.exec(chunk); m; m = match.exec(chunk)) last = m;
    if (last) options.progress?.(Math.min(duration, Number(last[1]) / 1e6) * mixShare);
  });

  let loudness: ExportValidation['loudness'];
  let encodeInput = mixFile;
  if (settings.loudness) {
    if (!options.master) throw new ToolFailure('missing', RcExport.masterNeedsWorker(), 'export-worker');
    const target = settings.loudness;
    const stem = path.parse(options.outName).name;
    const request: MasterRequest = {
      input: mixFile,
      output: path.join(staging, `${stem}.master.f32`),
      staging,
      sampleRate: settings.sampleRate,
      channels: settings.channels,
      lufs: target.integratedLufs,
      truePeak: target.truePeakDb,
    };
    const requestFile = path.join(staging, `${stem}.master.json`);
    await writeFile(requestFile, JSON.stringify(request));
    const masterProgress = (fraction: number) =>
      options.progress?.(duration * (mixShare + (1 - mixShare) * Math.min(1, Math.max(0, fraction))));
    masterProgress(0);
    const measure = await options.master(requestFile, signal, (done, total) => masterProgress(total > 0 ? done / total : 0));
    masterProgress(1);
    encodeInput = request.output;
    if (!(measure.inputLufs > UNMEASURABLE_LUFS)) {
      const detail = RcExport.loudnessNotMeasurable();
      warnings.push({ code: 'LOUDNESS_NOT_MEASURABLE', detail: detail.text, detailRef: refOf(detail) });
    } else {
      loudness = {
        target,
        measured: { inputLufs: round2(measure.inputLufs), integratedLufs: round2(measure.lufs), truePeakDb: round2(measure.truePeak) },
        gainDb: round2(measure.staticGainDb),
      };
    }
  }
  await runTool(ffmpeg, encodeArgs(encodeInput, outFile, settings, encodeInput !== mixFile), signal);
  // 中间文件用完就删：几段范围依次导出时 staging 只留编码好的输出。
  await Promise.all([graphFile, mixFile, encodeInput].map((file) => rm(file, { force: true })));

  const probed = await probeAudio(options.ffprobe, outFile, settings.format, signal);
  const expected = plan.range.durationSeconds;
  const tolerance = TOLERANCE_SEC[settings.format];
  const problems = [...probed.problems];
  if (probed.ok) {
    if (Math.abs(probed.durationSec - expected) > tolerance)
      problems.push(RcExport.durationMismatch({ actual: probed.durationSec, expected, tolerance }).text);
    if (probed.sampleRate !== settings.sampleRate) problems.push(RcExport.sampleRateMismatch({ actual: probed.sampleRate, expected: settings.sampleRate }).text);
    if (probed.channels !== settings.channels) problems.push(RcExport.channelsMismatch({ actual: probed.channels, expected: settings.channels }).text);
  }
  if (problems.length > 0) throw new AudioValidationError(problems);
  return {
    file: outFile,
    media: { kind: 'audio', durationSec: probed.durationSec, sampleRate: probed.sampleRate, channels: probed.channels },
    validation: {
      checks: ['decoded', 'duration', 'sample-rate', 'channels', ...(loudness ? ['loudness-measured'] : [])],
      expectedDurationSec: expected,
      durationSec: probed.durationSec,
      toleranceSec: tolerance,
      ...(loudness ? { loudness } : {}),
    },
    warnings,
  };
}

export class AudioValidationError extends Error {
  readonly problems: string[];
  readonly messageRef: MessageRef;
  constructor(problems: string[]) {
    const message = RcExport.validationFailed({ problems: problems.join(RcExport.clauseSeparator().text) });
    super(message.text);
    this.problems = problems;
    this.messageRef = refOf(message);
  }
}

const DEMUXERS: Record<AudioExportFormat, string> = { wav: 'wav', mp3: 'mp3', m4a: 'mov,mp4,m4a,3gp,3g2,mj2' };

/** ffprobe 解码整个文件：有音频帧、时长、采样率与声道。 */
async function probeAudio(
  ffprobe: ToolCommand,
  file: string,
  format: AudioExportFormat,
  signal: AbortSignal,
): Promise<{ ok: boolean; problems: string[]; durationSec: number; sampleRate: number; channels: number }> {
  const failed = (problem: string) => ({ ok: false, problems: [problem], durationSec: 0, sampleRate: 0, channels: 0 });
  let stdout: string;
  try {
    ({ stdout } = await runTool(
      ffprobe,
      [
        '-v',
        'error',
        '-f',
        DEMUXERS[format].split(',')[0]!,
        '-count_frames',
        '-show_entries',
        'stream=codec_type,sample_rate,channels,nb_read_frames:format=duration',
        '-of',
        'json',
        `file:${file}`,
      ],
      signal,
    ));
  } catch (error) {
    if (error instanceof ToolFailure && error.kind === 'aborted') throw error;
    return failed(RcExport.probeFailed({ error: error instanceof Error ? error.message : String(error) }).text);
  }
  let parsed: { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return failed(RcExport.probeNotJson().text);
  }
  const stream = (parsed.streams ?? []).find((s) => s.codec_type === 'audio');
  if (!stream) return failed(RcExport.noAudioStream().text);
  if (!(Number(stream.nb_read_frames) > 0)) return failed(RcExport.noDecodableFrame().text);
  return {
    ok: true,
    problems: [],
    durationSec: Number(parsed.format?.duration),
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
  };
}
