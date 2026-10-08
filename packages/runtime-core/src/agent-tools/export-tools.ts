import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_LOUDNESS_TARGET, RpcError, type ExportDestination, type ExportSettings, type Localized } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ExportService } from '../exports/export-service.ts';
import { inside, outside, refuseVideoDirectory } from './artifact-save.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ExportBase, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { commandIdArg, videoArg } from './video-tools.ts';

/**
 * 导出工具（架构设计 §3.5、§9.11）：智能体导出字幕、文稿、音频、成片、便携包与工程。和网关的 `exports.create` 走同一个 `ExportService`：
 * 冻结、预检与排队都在服务里，工具层只做权限（写操作：规划模式下拒绝，对外服务 `ask` 等级逐次确认）、视频范围（`ToolScope`）
 * 与目标目录的约束（`ToolScope.exportBase`）：会话里目录相对来源目录，对外服务只能是视频所属项目的 `exports/` 及其子目录；
 * 按真实路径不能出去，也不能是视频目录或 `.bcut`。立即返回 jobId，用 `jobs_wait` 等它结束（`jobs_inspect` 查看详情）。
 */

export interface ExportToolsDeps {
  exports: ExportService;
  scope: ToolScope;
}

const rangeArg = z.strictObject({ start: z.number().min(0), end: z.number().positive() });

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  export: z.strictObject({
    video: videoArg,
    kind: z
      .enum(['subtitles', 'transcript', 'audio', 'video', 'portable', 'project'])
      .describe(
        'subtitles（字幕）、transcript（文稿）、audio（音频）、video（成片）、portable（便携包：整个视频连同素材的一个 .baocut 文件）、project（工程：给 Premiere / Resolve 的 XML）',
      ),
    format: z
      .enum(['srt', 'vtt', 'ass', 'json', 'md', 'txt', 'wav', 'mp3', 'm4a', 'mp4', 'webm', 'baocut', 'xmeml'])
      .describe('字幕：srt、vtt、ass、json；文稿：md、txt、json；音频：wav、mp3、m4a；成片：mp4、webm；便携包：baocut；工程：xmeml'),
    purpose: z
      .enum(['deliverable', 'preview'])
      .optional()
      .describe('可选。deliverable（默认）是交付文件；preview 是智能体内部检查字幕排版、画面或声音的临时预览，不进入会话视频卡与产物列表。用户要求的预览或短片仍是 deliverable'),
    sequenceId: z.string().min(1).max(200).optional().describe('可选。序列 ID；不给时是主序列'),
    range: rangeArg.optional().describe('可选。只导出时间线上的 [start, end)（秒，剪辑后的时间）；不给时是整条序列'),
    ranges: z.array(rangeArg).min(1).max(64).optional().describe('可选。几段范围，每段一个文件；与 range 只给一个'),
    documentId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。字幕与文稿的主文档（speech 或 caption）；不给时按规则挑，挑不出时拒绝并列出候选'),
    language: z.string().min(1).max(35).optional().describe('可选。不给 documentId 时按语言挑文档（BCP 47）'),
    bilingual: z
      .union([
        z.boolean(),
        z.strictObject({ documentId: z.string().min(1).max(200).optional(), language: z.string().min(1).max(35).optional() }),
      ])
      .optional()
      .describe('可选。双语合并：true 取主文档的译文；也可以给另一份文档的 documentId 或语言'),
    maxCharsPerLine: z.number().int().min(8).max(200).optional().describe('可选。一行的最大宽度（全角字算 2），默认 42'),
    timestamps: z.boolean().optional().describe('可选。文稿（md、txt）在每段末尾写这一段开始的时间 [mm:ss]，默认不写'),
    frontmatter: z
      .boolean()
      .optional()
      .describe('可选。md 文稿开头写 YAML 元信息（标题、出处、作者、时长、语言、说话人、章节等），默认不写；txt 与 json 不写'),
    chapters: z.boolean().optional().describe('可选。文稿按序列上的章节标记写章节小标题，默认不写'),
    speakers: z.boolean().optional().describe('可选。文稿每段写说话人，默认 true；false 不写'),
    skipCut: z
      .boolean()
      .optional()
      .describe('可选。文稿跳过剪掉的部分，默认 true（时间是剪辑后的时间线时间）；false 时导出剪之前的原文，时间是素材时间'),
    sampleRate: z
      .union([z.literal(22050), z.literal(32000), z.literal(44100), z.literal(48000)])
      .optional()
      .describe('可选。音频（成片的声音）采样率，默认 48000'),
    channels: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe('可选。声道数，默认 2'),
    bitrateKbps: z
      .number()
      .int()
      .min(32)
      .max(320)
      .optional()
      .describe('可选。mp3、m4a 的码率，默认 192；wav 不接受。成片里是声音的码率（mp4 默认 192，webm 128）'),
    loudness: z
      .union([
        z.literal(true),
        z.strictObject({
          integratedLufs: z.number().min(-70).max(0),
          truePeakDb: z.number().min(-20).max(0),
        }),
      ])
      .optional()
      .describe('可选。响度标准化（R128 母带）：true 用 -16 LUFS / -1.2 dBTP，或给出目标；默认不做（音频与成片的声音）'),
    codec: z.enum(['h264', 'hevc', 'vp9']).optional().describe('可选。成片的视频编码：mp4 默认 h264（可选 hevc），webm 是 vp9'),
    width: z
      .number()
      .int()
      .min(16)
      .max(7680)
      .optional()
      .describe('可选。成片的输出宽度；只给 width 或 height 时另一边按画布比例（都取偶数）；默认画布尺寸'),
    height: z
      .number()
      .int()
      .min(16)
      .max(4320)
      .optional()
      .describe(
        '可选。成片的输出高度。width 与 height 都给且比例与画布不同时（例如横屏视频出 9:16 的 1080×1920），画面按画布比例放到最大、居中，其余是黑边，不裁切、不重排',
      ),
    fps: z
      .strictObject({ num: z.number().int().min(1).max(240000), den: z.number().int().min(1).max(100000) })
      .optional()
      .describe('可选。成片帧率（分数，例如 {num:30000,den:1001}）；默认序列帧率'),
    crf: z
      .number()
      .int()
      .min(0)
      .max(63)
      .optional()
      .describe('可选。成片的恒定质量（h264 默认 20、hevc 23、vp9 32）；与 videoBitrateKbps 只给一个'),
    videoBitrateKbps: z.number().int().min(100).max(200000).optional().describe('可选。成片的视频目标码率（kbps）'),
    burnCaptions: z.boolean().optional().describe('可选。把时间线上的字幕画进成片，默认 true'),
    onUnsupported: z
      .enum(['fail', 'skip'])
      .optional()
      .describe(
        '可选。成片里有画不出来的内容时：fail（默认）拒绝并在 items 里逐项列出；skip 跳过它们（整层不画、效果不施加、转场按硬切），每项一条任务警告。只在用户同意后用 skip',
      ),
    missingAssets: z
      .enum(['fail', 'skip'])
      .optional()
      .describe(
        '可选。便携包里有读不到的素材时：fail（默认）拒绝并在 items 里逐项列出；skip 不收进包、清单里标缺失。只在用户同意后用 skip',
      ),
    source: z
      .union([z.enum(['mix', 'original']), z.strictObject({ dubGroupId: z.string().min(1).max(128) })])
      .optional()
      .describe(
        '可选。音频与成片的声音来源：mix（默认，时间线的混音）、original（只要原声：去掉配音、恢复配音静音掉的原声）、{dubGroupId}（只要这一组配音，groupId 见配音轨实例的 extensions["baocut.dub"]）。只影响这一次导出，不改视频',
      ),
    dir: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        '可选。输出目录，已经存在；会话里相对工作目录（不给时是工作目录下的 exports/），对外服务相对项目的 exports/。不能写进视频目录或 .bcut',
      ),
    fileName: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。文件名（只在出一个文件时）；不给时是「视频名.种类.扩展名」，重名自动加序号'),
    overwrite: z.boolean().optional().describe('可选。fileName 指定的文件已经存在时替换，默认 false（存在就拒绝）'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type Args = z.infer<(typeof schemas)['export']>;

const DEFINITIONS: Record<'export', ToolInfo> = {
  export: {
    title: '导出',
    description: [
      '把视频导出成字幕、文稿、音频、成片、便携包或工程文件。',
      '字幕（srt、vtt、ass、json 带词时间）、文稿（md、txt、json）、音频（wav、mp3、m4a，按时间线混音，变速与增益同预览）或成片（mp4、webm：画面按与预览同一份帧计划在本机逐帧合成，声音同音频导出）。',
      '时间是剪辑后时间线上的时间，剪掉的词不会出现。提交时冻结视频的当前版本：之后的修改不影响这次导出。',
      '提交前做预检：没有可导出的文档、文档不止一份（EXPORT_SOURCE_AMBIGUOUS，candidates 列出候选，用 documentId 指定）、素材缺失或被改动（ASSET_MISSING / ASSET_CHANGED）、目标已存在、缺 ffmpeg 或编码器（EXPORT_TOOL_MISSING）、成片里有画不出来的内容（EXPORT_UNSUPPORTED_CONTENT，items 逐项列出）时直接拒绝，不建任务。',
      '立即返回 jobId：之后用 jobs_wait 等它结束（看进度用 jobs_inspect），state 为 completed 才算完成，outputs 里有每个文件的 path 与校验结果。不要重复提交同一件事。',
      '成片的进度按帧（progress.unit 为 frames）。',
      '仅为内部取帧、检查字幕排版或试听而导出时，必须给 purpose: preview；用户要求的文件（含预览与短片）用 deliverable。',
      '便携包（kind portable，format baocut）：整个视频（全部文档版本与素材，链接的素材也收进来）打成一个文件，别处的 BaoCut 能打开；不带本机路径。工程（kind project，format xmeml）：一条序列写成 Premiere / Resolve 能导入的 XML，素材按本机路径引用，文字、字幕、转场与效果等表达不了的逐项记成任务警告。',
    ].join('\n'),
    effect: 'job',
    examples: [
      { title: '导出 SRT 字幕', args: { video: 'demo', kind: 'subtitles', format: 'srt' } },
      { title: '导出双语字幕', args: { video: 'demo', kind: 'subtitles', format: 'srt', bilingual: true } },
      { title: '导出竖屏成片', args: { video: 'demo', kind: 'video', format: 'mp4', width: 1080, height: 1920 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
};
// i18n-ignore-end

export class ExportTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #exports: ExportService;
  readonly #scope: ToolScope;

  constructor(deps: ExportToolsDeps) {
    this.#exports = deps.exports;
    this.#scope = deps.scope;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (name !== 'export') return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    return this.#create(args as Args, principal);
  }

  async #create(args: Args, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (args.range && args.ranges) throw new ToolError('INVALID_ARGUMENTS', 'range 与 ranges 只给一个');
    const settings = settingsOf(args);
    // 允许覆盖已有文件是不可撤销的覆盖：`high`，`auto` 模式下也要问（架构设计 §3.12）。
    const approval = await this.#scope.confirm(access, {
      tool: 'export',
      video: args.video,
      ...confirmSummary(summaryOf(args)),
      risk: args.overwrite ? 'high' : 'edit',
    });
    const opened = await this.#scope.open(args.video, access);
    const base = this.#scope.exportBase(access, opened);
    const dir = args.dir !== undefined || base.ownDefault ? await confinedDirectory(base, args.dir ?? '.') : undefined;
    const destination: ExportDestination = {
      ...(dir !== undefined ? { dir } : {}),
      ...(args.fileName !== undefined ? { fileName: plainFileName(args.fileName) } : {}),
      ...(args.overwrite ? { overwrite: true } : {}),
    };
    let jobId: string;
    try {
      ({ jobId } = await this.#exports.create(
        {
          videoId: opened.ref.videoId,
          settings,
          destination,
          ...(args.commandId ? { commandId: this.#scope.commandId(access, args.commandId) } : {}),
        },
        access.submitter,
      ));
    } catch (error) {
      throw toolErrorOf(error);
    }
    const record = this.#exports.get(jobId);
    return {
      jobId,
      kind: record.kind,
      state: record.state,
      videoId: record.videoId,
      videoRevision: record.export?.videoRevision ?? null,
      dir: record.export?.destination.dir ?? null,
      files: record.export?.destination.files ?? [],
      purpose: record.export?.settings.purpose ?? 'deliverable',
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '导出已提交。用 jobs_wait 等它结束（看进度用 jobs_inspect），state 为 completed 才算完成；不要重复提交同一件事。',
    };
  }
}

function settingsOf(args: Args): ExportSettings {
  const purpose = args.purpose ? { purpose: args.purpose } : {};
  const scope = {
    ...purpose,
    ...(args.sequenceId ? { sequenceId: args.sequenceId } : {}),
    ...(args.range ? { range: args.range } : {}),
    ...(args.ranges ? { ranges: args.ranges } : {}),
  };
  if (args.source !== undefined && args.kind !== 'audio' && args.kind !== 'video') {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    throw new ToolError('INVALID_ARGUMENTS', 'source 只用于音频与成片');
  }
  const source = args.source !== undefined ? { source: args.source } : {};
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  if (args.kind === 'portable') {
    if (args.format !== 'baocut') throw new ToolError('INVALID_ARGUMENTS', '便携包的格式是 baocut');
    if (args.range || args.ranges || args.sequenceId)
      throw new ToolError('INVALID_ARGUMENTS', '便携包是整个视频：不接受 range、ranges 与 sequenceId');
    return { kind: 'portable', format: 'baocut', ...purpose, ...(args.missingAssets ? { missingAssets: args.missingAssets } : {}) };
  }
  if (args.kind === 'project') {
    if (args.format !== 'xmeml') throw new ToolError('INVALID_ARGUMENTS', '工程的格式是 xmeml');
    if (args.range || args.ranges) throw new ToolError('INVALID_ARGUMENTS', '工程是整条序列：不接受 range 与 ranges');
    return { kind: 'project', format: 'xmeml', ...purpose, ...(args.sequenceId ? { sequenceId: args.sequenceId } : {}) };
  }
  if (args.kind === 'video') {
    if (args.format !== 'mp4' && args.format !== 'webm') throw new ToolError('INVALID_ARGUMENTS', '成片的格式是 mp4 或 webm');
    if (args.crf !== undefined && args.videoBitrateKbps !== undefined)
      throw new ToolError('INVALID_ARGUMENTS', 'crf 与 videoBitrateKbps 只给一个');
    const audio = {
  // i18n-ignore-end
      ...(args.sampleRate ? { sampleRate: args.sampleRate } : {}),
      ...(args.channels ? { channels: args.channels } : {}),
      ...(args.bitrateKbps ? { bitrateKbps: args.bitrateKbps } : {}),
      ...(args.loudness ? { loudness: args.loudness === true ? { ...DEFAULT_LOUDNESS_TARGET } : args.loudness } : {}),
    };
    return {
      kind: 'video',
      format: args.format,
      ...scope,
      ...(args.codec ? { codec: args.codec } : {}),
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
      ...(args.fps ? { fps: args.fps } : {}),
      ...(args.crf !== undefined ? { crf: args.crf } : {}),
      ...(args.videoBitrateKbps !== undefined ? { bitrateKbps: args.videoBitrateKbps } : {}),
      ...(args.burnCaptions !== undefined ? { burnCaptions: args.burnCaptions } : {}),
      ...(args.onUnsupported ? { onUnsupported: args.onUnsupported } : {}),
      ...(Object.keys(audio).length > 0 ? { audio } : {}),
      ...source,
    };
  }
  if (args.kind === 'audio') {
    if (args.format !== 'wav' && args.format !== 'mp3' && args.format !== 'm4a') {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('INVALID_ARGUMENTS', '音频的格式是 wav、mp3 或 m4a');
    }
    return {
      kind: 'audio',
      format: args.format,
      ...scope,
      ...(args.sampleRate ? { sampleRate: args.sampleRate } : {}),
      ...(args.channels ? { channels: args.channels } : {}),
      ...(args.bitrateKbps ? { bitrateKbps: args.bitrateKbps } : {}),
      ...(args.loudness ? { loudness: args.loudness === true ? { ...DEFAULT_LOUDNESS_TARGET } : args.loudness } : {}),
      ...source,
    };
  }
  const allowed = args.kind === 'subtitles' ? ['srt', 'vtt', 'ass', 'json'] : ['md', 'txt', 'json'];
  const onlyTranscript = (['frontmatter', 'chapters', 'speakers', 'skipCut'] as const).filter((key) => args[key] !== undefined);
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  if (args.kind !== 'transcript' && onlyTranscript.length > 0)
    throw new ToolError('INVALID_ARGUMENTS', `${onlyTranscript.join('、')} 只用于文稿（kind transcript）`);
  if (!allowed.includes(args.format)) throw new ToolError('INVALID_ARGUMENTS', `${args.kind} 的格式是 ${allowed.join('、')}`);
  // i18n-ignore-end
  return {
    kind: args.kind,
    format: args.format,
    ...scope,
    ...(args.documentId ? { documentId: args.documentId } : {}),
    ...(args.language ? { language: args.language } : {}),
    ...(args.bilingual !== undefined ? { bilingual: args.bilingual } : {}),
    ...(args.maxCharsPerLine ? { maxCharsPerLine: args.maxCharsPerLine } : {}),
    ...(args.timestamps !== undefined ? { timestamps: args.timestamps } : {}),
    ...(args.kind === 'transcript' ? transcriptOptions(args) : {}),
  } as ExportSettings;
}

/** 文稿独有的选项；字幕给了就拒绝，不悄悄丢掉。 */
function transcriptOptions(args: Args): Record<string, boolean> {
  const options: Record<string, boolean> = {};
  for (const key of ['frontmatter', 'chapters', 'speakers', 'skipCut'] as const) if (args[key] !== undefined) options[key] = args[key];
  return options;
}

/** 服务审批里显示的一句话。 */
function summaryOf(args: Args): Localized {
  return RcAgentTools.exportSummary({
    kind: args.kind,
    format: args.format,
    rangeStart: args.range ? args.range.start : null,
    rangeEnd: args.range ? args.range.end : null,
    rangeCount: !args.range && args.ranges ? args.ranges.length : null,
    width: args.width ?? null,
    height: args.height ?? null,
    originalOnly: args.source === 'original',
    dubGroupId: typeof args.source === 'object' ? args.source.dubGroupId : null,
    fileName: args.fileName ?? null,
    overwrite: args.overwrite ?? false,
  });
}

/**
 * 目录相对 `base`；按真实路径不能出 `base`，不能是视频目录或 `.bcut`。`ownDefault` 的 `base`（对外服务的项目 `exports/`）
 * 不存在时在 `within` 里建出来，建之前先确认它（按真实路径）不出 `within`。`within` 为 null（终端里的用户本人）时没有目录约束：
 * 绝对路径照收，相对的按 `base` 解析，只是不能是视频目录或 `.bcut`。
 */
async function confinedDirectory(base: ExportBase, dir: string): Promise<string> {
  if (base.within === null) {
    const real = await fs.realpath(path.resolve(base.base, dir)).catch(() => null);
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (!real) throw new ToolError('INVALID_PATH', `目录不存在：${dir}（不给 dir 时用视频所属项目的 exports/）`);
    await refuseVideoDirectory(path.parse(real).root, real, []);
    return real;
  }
  const within = base.within;
  // 对外服务没有工作目录：出了项目的 exports/ 就以项目为准回答。
  const refuse = () =>
    base.ownDefault
      // i18n-ignore: 给模型的工具说明、错误与下一步
      ? new ToolError('PATH_OUTSIDE_PROJECT', '只能导出到视频所属项目的 exports/ 里（相对路径，不含 ..，不经过指向别处的符号链接）')
      : outside();
  if (path.isAbsolute(dir)) throw refuse();
  if (base.ownDefault) {
    const withinReal = await fs.realpath(within);
    const target = path.resolve(withinReal, path.relative(within, base.base));
    if (!inside(target, withinReal)) throw refuse();
    await fs.mkdir(target, { recursive: true }).catch(() => {
      throw refuse();
    });
    if (!inside(await fs.realpath(target), withinReal)) throw refuse();
  }
  const rootReal = await fs.realpath(base.base);
  const resolved = path.resolve(rootReal, dir);
  if (!inside(resolved, rootReal)) throw refuse();
  const real = await fs.realpath(resolved).catch(() => null);
  // i18n-ignore: 给模型的工具说明、错误与下一步
  if (!real) throw new ToolError('INVALID_PATH', `目录不存在：${dir}（不给 dir 时用默认的 exports/）`);
  if (!inside(real, rootReal)) throw refuse();
  await refuseVideoDirectory(rootReal, real, []);
  return real;
}

function plainFileName(name: string): string {
  if (name !== path.basename(name) || name.startsWith('.')) {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    throw new ToolError('INVALID_PATH', 'fileName 只是文件名：不含目录，不以 . 开头（目录用 dir）');
  }
  return name;
}

/** 预检的拒绝：错误码在 `details.code`，原样交给智能体，附上下一步。 */
function toolErrorOf(error: unknown): unknown {
  if (!(error instanceof RpcError)) return error;
  const details = (error.details ?? {}) as Record<string, unknown>;
  if (typeof details.code !== 'string') return error;
  const { code, ...rest } = details as { code: string } & Record<string, unknown>;
  // 目标目录与素材文件的绝对路径不交给智能体（它只用相对工作目录的路径）。
  delete rest.path;
  if (Array.isArray(rest.items)) {
    rest.items = rest.items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const { path: _path, ...kept } = item as Record<string, unknown>;
      return kept;
    });
  }
  return new ToolError(code, error.message, { ...rest, ...(EXPORT_NEXT[code] ? { next: EXPORT_NEXT[code] } : {}) });
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const EXPORT_NEXT: Record<string, string> = {
  EXPORT_SOURCE_AMBIGUOUS: '从 candidates 里选一份，用 documentId 指定后重新提交。',
  EXPORT_SOURCE_NOT_FOUND: '视频里没有可导出的字幕或转写：需要时先转写（transcribe），或告诉用户。',
  EXPORT_SOURCE_UNSUPPORTED: '这份文档不能导出为字幕或文稿：换一份 speech 或 caption 文档。',
  EXPORT_NOTHING_TO_EXPORT: '这个范围里没有文字：换一个范围，或检查文档的内容是否都被剪掉了。',
  EXPORT_SOURCE_UNPLACED: '这份文档的来源素材不在这条序列上，投影不到时间线：用 scopeItemIds 或换一份文档。',
  EXPORT_SOURCE_INVALID: '文档的内容不完整（例如缺时间）：告诉用户；不要自己改文档绕过。',
  EXPORT_RANGE_EMPTY: '范围是空的或在序列之外：用 videos_inspect 看序列的时长，换一个范围。',
  EXPORT_TOOL_MISSING: '缺 ffmpeg / ffprobe、编码器或 Render Worker：把 remedy 转告用户，由用户安装；不要自己安装或绕过。',
  EXPORT_UNSUPPORTED_CONTENT:
    "items 列出了成片画不出来的内容：告诉用户是哪些；用户同意跳过时带 onUnsupported: 'skip' 重新提交，或先改掉这些内容。",
  EXPORT_DESTINATION_EXISTS: '目标文件已经存在：换一个 fileName；确实要替换时先问用户，再带 overwrite: true。',
  EXPORT_DESTINATION_UNWRITABLE: '目标目录不可写：换一个工作目录里已有的目录，或告诉用户。',
  ASSET_MISSING:
    "素材文件不在了：告诉用户，请用户重新链接；不要自己找替代文件。便携包在用户同意时可以带 missingAssets: 'skip' 重新提交（清单里标缺失）。",
  EXPORT_PACKAGE_LOCAL_PATH: 'items 列出的文档正文里写着本机路径，便携包不能带出去：告诉用户是哪些文档，由用户决定怎么改。',
  EXPORT_PACKAGE_UNSUPPORTED: 'items 列出的文件写不进 .baocut 归档（路径太长或单个文件 8 GiB 以上）：告诉用户。',
  EXPORT_INSUFFICIENT_SPACE: '导出目录所在的盘空间不够：告诉用户需要的空间（required），由用户腾出空间或换目录。',
  ASSET_CHANGED: '链接的素材文件被改过：告诉用户，请用户确认后重新链接；不要自己绕过。',
  EXPORT_KIND_UNSUPPORTED: '这个版本只能导出 subtitles、transcript、audio、video、portable、project。',
};
// i18n-ignore-end
