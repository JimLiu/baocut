import { intlLocale, localizeToolStatus, pipelineStepLabel, type ExternalToolStatus, type GeneratedOutput, type Id, type JobRecord, type TranscodeParams, type TranscodeStartParams, type TranscodeSummary } from '@baocut/protocol';
import { JOB_PHASE_LABEL } from '../copy.ts';
import { formatClock, formatDuration } from './format.ts';
import { kindOfFileName } from './space.ts';
import { jobLive } from './task-list.ts';
import { M } from './tools-transcode-copy.ts';
import { jobWaitText, remedyText } from './localized-text.ts';

/**
 * 压缩视频与合并视频（设计稿 tool-video.jsx、tool-video-merge.jsx、model-video.js）：两页都提交 Runtime 的固定流程
 * `transcode`（`pipelines.start`，父任务 `kind: 'pipeline'`，四步：读取输入 → 编码 → 校验输出 → 发布），文件到文件，
 * 由这台电脑上的 ffmpeg 执行，不上传。这里是表单、请求、记录与结果的纯函数，组件只管画。
 *
 * 设计稿里做不到的：按体积压（界面读不到源文件的时长）、帧率上限、显卡编码、去掉音轨、提交前的兼容性横幅（界面没有
 * 探测任意文件的方法）、合并时选「快速 / 重新编码」（Runtime 自己判断，参数一致才流复制）。这些都不画，见各处说明。
 */

export const TRANSCODE_PIPELINE = 'transcode';

export type TranscodeAction = TranscodeParams['action'];
export type TranscodeCodec = NonNullable<TranscodeParams['codec']>;
/** 画质档（设计稿 `QUALITIES`）：换成恒定质量 CRF。 */
export type TranscodeQuality = 'smaller' | 'balanced' | 'high';
/** 压到多小：按画质（CRF），或给定视频码率。设计稿的「按体积」要源文件时长，界面读不到，换成码率。 */
export type TranscodeRate = 'quality' | 'bitrate';

/** 工具页的表单草稿。文件路径只留在这次运行里（见 tools-store），其余跟着草稿记住。 */
export interface TranscodeDraft {
  inputs: string[];
  codec: TranscodeCodec;
  /** 画面高度上限；null 是不缩放。 */
  maxHeight: number | null;
  rate: TranscodeRate;
  quality: TranscodeQuality;
  videoKbps: number;
  audioKbps: number;
  /** 输出目录；null 是写在（第一个）源文件旁边。 */
  outDir: string | null;
}

export const BLANK_COMPRESS: TranscodeDraft = {
  inputs: [],
  codec: 'h264',
  maxHeight: null,
  rate: 'quality',
  quality: 'balanced',
  videoKbps: 4000,
  audioKbps: 128,
  outDir: null,
};

/** 合并默认用高画质：接起来之后往往还要再剪（设计稿 tool-video-merge.jsx）。 */
export const BLANK_MERGE: TranscodeDraft = { ...BLANK_COMPRESS, quality: 'high' };

/** 提取音频：只用文件与输出目录（重新编码时的音频码率沿用）；画面的设置不生效。 */
export const BLANK_EXTRACT: TranscodeDraft = { ...BLANK_COMPRESS };

export const QUALITIES: ReadonlyArray<{ key: TranscodeQuality; name: string; sub: string }> = (['smaller', 'balanced', 'high'] as const).map((key) => ({
  key,
  get name() {
    return M.quality[key].name;
  },
  get sub() {
    return M.quality[key].sub;
  },
}));

const CRF: Record<TranscodeQuality, number> = { smaller: 30, balanced: 26, high: 22 };

/** 这一档在这种编码下的 CRF（H.265 的标度整体高 5，设计稿 `crfOf`）。 */
export function crfOf(quality: TranscodeQuality, codec: TranscodeCodec): number {
  return CRF[quality] + (codec === 'hevc' ? 5 : 0);
}

/** 画面高度的上限（Runtime 的 `maxHeight` 按高度封顶，只往下缩）。 */
export const HEIGHT_CAPS: ReadonlyArray<{ key: string; name: string; height: number | null }> = [
  {
    key: 'original',
    get name() {
      return M.heightOriginal;
    },
    height: null,
  },
  { key: '1080', name: '1080p', height: 1080 },
  { key: '720', name: '720p', height: 720 },
  { key: '480', name: '480p', height: 480 },
];

export const CODECS: ReadonlyArray<{ key: TranscodeCodec; name: string; sub: string }> = [
  {
    key: 'h264',
    name: 'H.264',
    get sub() {
      return M.codecSub.h264;
    },
  },
  {
    key: 'hevc',
    name: 'H.265',
    get sub() {
      return M.codecSub.hevc;
    },
  },
];

export const AUDIO_RATES: readonly number[] = [96, 128, 192, 256];

/** Runtime 的参数范围（packages/jobs 的 `parseTranscodeParams`）。 */
export const LIMITS = { inputs: 100, videoKbps: [100, 200_000], audioKbps: [32, 1024] } as const;

export function heightKey(maxHeight: number | null): string {
  return maxHeight === null ? 'original' : String(maxHeight);
}

export function codecName(codec: string): string {
  return CODECS.find((c) => c.key === codec)?.name ?? codec.toUpperCase();
}

// ---- 选文件 ----

/**
 * 列表里的一项是本机文件的绝对路径，或 Space 条目（架构设计 §7.9「Space 条目作输入」）。条目在表单里记成 `space:<entryId>`，
 * 这样排序、去重、拖动都按同一种字符串处理；提交时换成 `{ entryId }`，由 Runtime 换成文件路径。草稿里的列表不落盘。
 */
const SPACE_INPUT = 'space:';

export function spaceInput(entryId: Id): string {
  return `${SPACE_INPUT}${entryId}`;
}

/** 列表项是 Space 条目时给条目 ID，否则 null。 */
export function entryIdOfInput(input: string): Id | null {
  return input.startsWith(SPACE_INPUT) ? input.slice(SPACE_INPUT.length) : null;
}

/** 把 Space 条目加到列表末尾：已经在列表里的不重复加，最多 100 个。 */
export function addEntryInput(current: readonly string[], entryId: Id): string[] {
  const input = spaceInput(entryId);
  if (current.includes(input) || current.length >= LIMITS.inputs) return [...current];
  return [...current, input];
}

/** 路径的最后一段。 */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** 绝对路径：macOS / Linux 的 `/…`，Windows 的 `C:\…` 或 `\\server\…`。 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/**
 * 手动输入的一条路径：去掉首尾空白与成对的引号，`file://` 网址换成路径，终端里拖进来的 `\ ` 还原成空格。
 * 空的返回 null。
 */
export function parsePathInput(text: string): string | null {
  let value = text.trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1).trim();
  if (value.startsWith('file://')) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return null;
    }
  } else if (value.startsWith('/')) {
    value = value.replace(/\\(.)/g, '$1');
  }
  return value || null;
}

/**
 * 认不认这份文件：Space 分类里的视频认；音频、图片、字幕、文稿这类认得出不是视频的不认；扩展名认不出的放行，
 * 交给 Runtime 的 ffprobe 判断（读不出视频轨时那一条失败，写明原因）。提取音频另收音频文件（`withAudio`）。
 */
export function isVideoCandidate(path: string, withAudio = false): boolean {
  const kind = kindOfFileName(fileName(path));
  return kind === null || kind === 'video-file' || (withAudio && kind === 'audio');
}

export interface AddResult {
  inputs: string[];
  /** 认得出不是视频的。 */
  rejected: string[];
  /** 已经在列表里的。 */
  duplicates: string[];
  /** 不是绝对路径的。 */
  relative: string[];
  /** 超出上限没加进去的。 */
  overflow: number;
}

/** 把一批路径加到列表末尾：去重（同一个文件不进两次）、不是视频的（提取音频另收音频）与相对路径不收、最多 100 个。 */
export function addInputs(current: readonly string[], paths: readonly string[], withAudio = false): AddResult {
  const inputs = [...current];
  const result: AddResult = { inputs, rejected: [], duplicates: [], relative: [], overflow: 0 };
  for (const path of paths) {
    if (!isAbsolutePath(path)) result.relative.push(path);
    else if (!isVideoCandidate(path, withAudio)) result.rejected.push(path);
    else if (inputs.includes(path)) result.duplicates.push(path);
    else if (inputs.length >= LIMITS.inputs) result.overflow += 1;
    else inputs.push(path);
  }
  return result;
}

/** 加文件之后要提示的一句；全都收下时 null。 */
export function addNotice(result: AddResult): string | null {
  const bits: string[] = [];
  if (result.rejected.length) bits.push(M.notVideoFiles(result.rejected.map(fileName)));
  if (result.relative.length) bits.push(M.notAbsolute(result.relative));
  if (result.duplicates.length) bits.push(M.alreadyListed(result.duplicates.map(fileName)));
  if (result.overflow) bits.push(M.overflow(LIMITS.inputs, result.overflow));
  return bits.length ? M.joinNotices(bits) : null;
}

/** 上移 / 下移一位（设计稿 `reorder`）；越界时原样返回。 */
export function moveInput(inputs: readonly string[], index: number, delta: number): string[] {
  const to = index + delta;
  if (index < 0 || index >= inputs.length || to < 0 || to >= inputs.length) return [...inputs];
  const next = [...inputs];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

/** 把一组文件挪到某个文件之前或之后（拖着排序）。目标在被挪的那组里时原样返回。 */
export function moveInputs(inputs: readonly string[], moving: readonly string[], target: string, position: 'before' | 'after'): string[] {
  if (moving.includes(target)) return [...inputs];
  const set = new Set(moving);
  const kept = inputs.filter((p) => !set.has(p));
  const block = inputs.filter((p) => set.has(p));
  const at = kept.indexOf(target);
  if (at < 0) return [...inputs];
  kept.splice(position === 'before' ? at : at + 1, 0, ...block);
  return kept;
}

export function removeInput(inputs: readonly string[], index: number): string[] {
  return inputs.filter((_, i) => i !== index);
}

/** 按文件名排（数字按大小：clip2 在 clip10 之前）。Space 条目按 `nameOf` 给的名字排（没给时按条目 ID）。 */
export function sortByName(inputs: readonly string[], nameOf: (input: string) => string = fileName): string[] {
  const collator = new Intl.Collator(intlLocale(), { numeric: true, sensitivity: 'base' });
  return [...inputs].sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
}

// ---- 提交 ----

/** 提交前的问题（设计稿 `compressProblems` / `mergeProblems` 里 Runtime 也会拒的那几条）；没有时空数组。 */
export function transcodeProblems(draft: TranscodeDraft, action: TranscodeAction): string[] {
  const problems: string[] = [];
  if (!draft.inputs.length) problems.push(action === 'merge' ? M.needTwoVideos : action === 'extract-audio' ? M.needMediaFile : M.needVideoFile);
  else if (action === 'merge' && draft.inputs.length < 2) problems.push(M.needOneMore);
  if (draft.inputs.length > LIMITS.inputs) problems.push(M.tooManyFiles(LIMITS.inputs));
  const relative = draft.inputs.filter((p) => !entryIdOfInput(p) && !isAbsolutePath(p));
  if (relative.length) problems.push(M.notAbsolute(relative));
  if (draft.rate === 'bitrate') {
    const [min, max] = LIMITS.videoKbps;
    if (!Number.isInteger(draft.videoKbps) || draft.videoKbps < min || draft.videoKbps > max) {
      problems.push(M.videoKbpsRange(min, max));
    }
  }
  const [amin, amax] = LIMITS.audioKbps;
  if (!Number.isInteger(draft.audioKbps) || draft.audioKbps < amin || draft.audioKbps > amax) problems.push(M.audioKbpsRange(amin, amax));
  if (draft.outDir !== null && draft.outDir.trim() && !isAbsolutePath(draft.outDir.trim())) problems.push(M.outDirAbsolute);
  return problems;
}

/**
 * 表单 → `transcode` 的参数：CRF 与视频码率只给一个；提取音频不给画面的设置。`dir` 是这次的保存位置（「更改…」选的，
 * 或 `tools.list` 给的）；都没有时不给 `outDir`（Runtime 写到它的保存位置）。
 */
export function transcodeRequest(draft: TranscodeDraft, action: TranscodeAction, dir?: string): TranscodeStartParams {
  const outDir = (dir ?? draft.outDir)?.trim();
  const inputs = draft.inputs.map((input) => {
    const entryId = entryIdOfInput(input);
    return entryId ? { entryId } : input;
  });
  if (action === 'extract-audio') return { inputs, action, audioBitrateKbps: draft.audioKbps, ...(outDir ? { outDir } : {}) };
  return {
    inputs,
    action,
    codec: draft.codec,
    ...(draft.maxHeight !== null ? { maxHeight: draft.maxHeight } : {}),
    ...(draft.rate === 'bitrate' ? { videoBitrateKbps: draft.videoKbps } : { crf: crfOf(draft.quality, draft.codec) }),
    audioBitrateKbps: draft.audioKbps,
    ...(outDir ? { outDir } : {}),
  };
}

/** 提交被拒时的一句：ffmpeg 不可用（`MEDIA_TOOL_UNAVAILABLE`）时点名；找不到文件、目录照 Runtime 的原话。 */
export function rejectionText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { details?: { code?: unknown } } | null)?.details?.code;
  if (code === 'MEDIA_TOOL_UNAVAILABLE') return M.ffmpegUnusable(message);
  return message;
}

/** 设置的一行摘要：「原始 · H.264 · 均衡 · 音频 128 kbps」。 */
export function settingsLine(draft: TranscodeDraft): string {
  const cap = HEIGHT_CAPS.find((h) => h.height === draft.maxHeight);
  const height = cap?.key === 'original' ? M.heightOriginalLong : (cap?.name ?? `${draft.maxHeight}p`);
  const rate = draft.rate === 'bitrate' ? `${draft.videoKbps} kbps` : (QUALITIES.find((q) => q.key === draft.quality)?.name ?? '');
  return [height, codecName(draft.codec), rate, M.audioKbps(draft.audioKbps)].join(' · ');
}

// ---- ffmpeg ----

export interface FfmpegLine {
  /** 能不能提交：没装、不能运行、太旧时 false。 */
  ready: boolean;
  text: string;
  /** 不能用时的修法（Runtime 给的那句）。 */
  remedy: string | null;
}

/** ffmpeg 的现状（`externalTools.detect` 的 ffmpeg 一项，设计稿 `ffmpegStatus`）。 */
export function ffmpegLine(probed: ExternalToolStatus | null): FfmpegLine {
  const status = probed && localizeToolStatus(probed);
  // 没有探测结果时给不出按平台的命令（Runtime 可能在另一台机器上），只说装什么。
  if (!status) return { ready: false, text: M.ffmpegNeeded, remedy: M.ffmpegInstallHint };
  const version = status.version ? ` ${status.version}` : '';
  switch (status.state) {
    case 'installed':
      return { ready: true, text: M.ffmpegReady(version), remedy: null };
    case 'outdated':
      return { ready: false, text: M.ffmpegOutdated(version), remedy: status.remedy ?? status.reason };
    case 'unavailable':
      return { ready: false, text: M.ffmpegCannotRun, remedy: status.remedy ?? status.reason };
    case 'missing':
      return { ready: false, text: M.ffmpegNeeded, remedy: status.remedy ?? status.reason };
  }
}

// ---- 记录 ----

/** 冻结的参数（父任务的 `pipeline.params`）。 */
export function transcodeParams(job: Pick<JobRecord, 'pipeline'>): TranscodeParams | null {
  const params = job.pipeline?.name === TRANSCODE_PIPELINE ? job.pipeline.params : null;
  if (!params || !Array.isArray(params.inputs) || !['compress', 'merge', 'extract-audio'].includes(params.action as string)) return null;
  return params as unknown as TranscodeParams;
}

/**
 * 右栏的记录：这台电脑的界面提交的 `transcode` 父任务，新的在前；本机藏起来的不列。压缩与合并列在一起
 * （设计稿：两页共用一条队列，看到的是同一份）。
 */
export function transcodeJobs(jobs: readonly JobRecord[], hidden: readonly Id[]): JobRecord[] {
  const skip = new Set(hidden);
  return jobs
    .filter(
      (job) =>
        job.kind === 'pipeline' &&
        job.pipeline?.name === TRANSCODE_PIPELINE &&
        job.videoId === null &&
        job.submitter.kind === 'connection' &&
        !skip.has(job.jobId),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function transcodeAction(job: Pick<JobRecord, 'pipeline'>): TranscodeAction {
  return transcodeParams(job)?.action ?? 'compress';
}

/** 记录卡的标题：做完了是输出文件名；之前是输入（「a.mp4」「a.mp4 等 3 个文件」「a.mp4 + 2 段」）。 */
export function transcodeTitle(job: Pick<JobRecord, 'pipeline' | 'result'>): string {
  const outputs = transcodeOutputs(job);
  if (outputs.length === 1) return fileName(outputs[0]!.path!);
  if (outputs.length > 1) return M.filesTitle(fileName(outputs[0]!.path!), outputs.length);
  const params = transcodeParams(job);
  const inputs = params?.inputs ?? [];
  if (!inputs.length) return M.defaultTitle;
  const first = fileName(inputs[0]!);
  if (inputs.length === 1) return first;
  return params?.action === 'merge' ? M.mergeTitle(first, inputs.length - 1) : M.filesTitle(first, inputs.length);
}

function qualityName(crf: number, codec: TranscodeCodec): string {
  const preset = QUALITIES.find((q) => crfOf(q.key, codec) === crf);
  return preset ? M.qualityWithCrf(preset.name, crf) : `CRF ${crf}`;
}

/**
 * 记录卡标题下那行设置（设计稿 `jobMeta`）：「压缩 · ≤720p · H.264 · 均衡（CRF 26）」「合并 3 段 · H.264 · 高画质（CRF 22）」。
 * 合并已判定流复制时，分辨率、编码、画质都没有生效，只写「合并 3 段 · 流复制」。
 */
export function transcodeMeta(job: Pick<JobRecord, 'pipeline'>): string {
  const params = transcodeParams(job);
  if (!params) return '';
  if (params.action === 'merge' && mergeMode(job)?.mode === 'stream-copy') return M.mergeStreamCopy(params.inputs.length);
  if (params.action === 'extract-audio') return params.inputs.length > 1 ? M.extractAudioMany(params.inputs.length) : M.extractAudio;
  const codec = params.codec ?? 'h264';
  const bits = [params.action === 'merge' ? M.mergeClips(params.inputs.length) : params.inputs.length > 1 ? M.compressMany(params.inputs.length) : M.compress];
  if (params.maxHeight !== undefined) bits.push(`≤${params.maxHeight}p`);
  bits.push(codecName(codec));
  if (params.videoBitrateKbps !== undefined) bits.push(`${params.videoBitrateKbps} kbps`);
  else if (params.crf !== undefined) bits.push(qualityName(params.crf, codec));
  return bits.join(' · ');
}

/** 步骤的子任务（`pipeline.steps[].jobId`）：在 `jobs` 主题里与父任务一起送达。 */
function stepJob(job: Pick<JobRecord, 'pipeline'>, all: readonly JobRecord[], name: string): JobRecord | null {
  const id = job.pipeline?.steps.find((s) => s.name === name)?.jobId;
  return id ? (all.find((j) => j.jobId === id) ?? null) : null;
}

export interface TranscodeProgress {
  text: string;
  /** 编码那一步的百分比；别的步骤与总量未知时 null（进度条不定）。 */
  percent: number | null;
}

/**
 * 在跑那一行（设计稿 `progressLine`）：编码时读子任务按秒的进度「编码中 0:12 / 0:42 · 28%」；别的步骤写步骤名与第几步
 * 「读取输入 · 第 1/4 步」。父任务的进度只数完成了几步，不伪造百分比。
 */
export function transcodeProgress(job: Pick<JobRecord, 'pipeline' | 'phase' | 'progress'>, all: readonly JobRecord[]): TranscodeProgress {
  const steps = job.pipeline?.steps ?? [];
  const index = job.pipeline?.current ?? null;
  const step = index !== null ? steps[index] : undefined;
  const child = step ? stepJob(job, all, step.name) : null;
  // 这一步的子任务还在排队（例如 ffmpeg 的并发名额被别的任务占着）：照 Runtime 记着的原因写在等什么。
  if (step && child?.state === 'queued') return { text: M.stepQueued(pipelineStepLabel(step), jobWaitText(child.wait)), percent: null };
  if (step?.name === 'encode') {
    const p = child?.progress;
    if (p && p.unit === 'seconds' && p.total && p.total > 0) {
      const percent = Math.max(0, Math.min(100, Math.floor((p.done / p.total) * 100)));
      return { text: `${JOB_PHASE_LABEL.encoding} ${formatClock(p.done)} / ${formatClock(p.total)} · ${percent}%`, percent };
    }
    return { text: JOB_PHASE_LABEL.encoding, percent: null };
  }
  if (step && index !== null) return { text: M.stepOf(pipelineStepLabel(step), index + 1, steps.length), percent: null };
  return { text: JOB_PHASE_LABEL[job.phase], percent: null };
}

/** 发布到用户目录的输出（`result.outputs` 里带 `path` 的视频）。 */
export function transcodeOutputs(job: Pick<JobRecord, 'result'>): GeneratedOutput[] {
  return (job.result?.outputs ?? []).filter((o) => typeof o.path === 'string' && o.path.length > 0);
}

/** 完成时的摘要（`pipeline.summary`）。 */
export function transcodeSummary(job: Pick<JobRecord, 'pipeline'>): TranscodeSummary | null {
  const summary = job.pipeline?.name === TRANSCODE_PIPELINE ? job.pipeline.summary : null;
  if (!summary || (summary.mode !== 'stream-copy' && summary.mode !== 're-encode')) return null;
  return summary as unknown as TranscodeSummary;
}

/**
 * 读取输入那一步记下的源文件大小（步骤产出 `stats[].size`）。这是步骤自己的形状，不是公开合同：读不到时 null，
 * 结果行就只写输出的大小。
 */
export function inputSizes(job: Pick<JobRecord, 'pipeline'>): number[] | null {
  const output = job.pipeline?.steps.find((s) => s.name === 'probe')?.output;
  const stats = output?.stats;
  if (!Array.isArray(stats)) return null;
  const sizes = stats.map((s) => (s && typeof (s as { size?: unknown }).size === 'number' ? (s as { size: number }).size : NaN));
  return sizes.every((n) => Number.isFinite(n)) ? sizes : null;
}

/** 字节数（设计稿 `humanBytes`，1024 进制）：「68.4 MB」「512 KB」。 */
export function humanBytes(bytes: number): string {
  const v = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${Math.round(v)} B`;
}

/** 省了多少；源本来就更小时 null（设计稿 `savedPercent`）。 */
export function savedPercent(before: number, after: number): number | null {
  return before > 0 && after < before ? Math.round(((before - after) / before) * 100) : null;
}

export interface TranscodeResultRow {
  path: string;
  name: string;
  /** 「1920×1080 · 0:42 · H.264 / AAC」 */
  meta: string;
  /** 「68.4 MB → 21.8 MB（小 68%）」；读不到源文件大小时只写输出大小。 */
  size: string;
}

/** 做完的每个输出文件一行。压缩时第 i 个输出对应第 i 个输入；合并时对比的是源文件的总和。 */
export function transcodeResults(job: Pick<JobRecord, 'pipeline' | 'result'>): TranscodeResultRow[] {
  const outputs = transcodeOutputs(job);
  const sizes = inputSizes(job);
  const action = transcodeAction(job);
  const merge = action === 'merge';
  return outputs.map((output, i) => {
    const media = output.media;
    // 提取音频：输出是音轨，不和源文件比大小。
    if (action === 'extract-audio') {
      const meta = media.kind === 'audio' ? `${formatClock(media.durationSec)} · ${media.sampleRate / 1000} kHz` : '';
      return { path: output.path!, name: fileName(output.path!), meta, size: humanBytes(output.byteLength) };
    }
    const meta =
      media.kind === 'video'
        ? [
            `${media.width}×${media.height}`,
            formatClock(media.durationSec),
            [codecName(media.videoCodec), media.audioCodec ? media.audioCodec.toUpperCase() : M.noAudioTrack].join(' / '),
          ].join(' · ')
        : '';
    const before = sizes ? (merge ? sizes.reduce((sum, n) => sum + n, 0) : (sizes[i] ?? null)) : null;
    const after = humanBytes(output.byteLength);
    let size = after;
    // 合并不是为了变小：写源文件一共多大，不算省了多少。
    if (before !== null && merge) size = M.mergedSize(after, humanBytes(before));
    else if (before !== null) {
      const saved = savedPercent(before, output.byteLength);
      size = M.savedSize(humanBytes(before), after, saved);
    }
    return { path: output.path!, name: fileName(output.path!), meta, size };
  });
}

/** 合并判定的接法：完成后读摘要，完成前读取输入那一步的产出（步骤自己的形状）；压缩与还没判定时 null。 */
function mergeMode(job: Pick<JobRecord, 'pipeline'>): { mode: TranscodeSummary['mode']; reason: string | null } | null {
  if (transcodeAction(job) !== 'merge') return null;
  const summary = transcodeSummary(job);
  if (summary) return { mode: summary.mode, reason: summary.reason };
  const probe = job.pipeline?.steps.find((s) => s.name === 'probe')?.output;
  if (probe?.mode !== 'stream-copy' && probe?.mode !== 're-encode') return null;
  return { mode: probe.mode, reason: typeof probe.reason === 'string' ? probe.reason : null };
}

/**
 * 合并怎么接的一句：流复制（没有重新编码）或重新编码与原因（Runtime 的 `reason`，例如「分辨率不一致（1920x1080 /
 * 1280x720）」）。压缩不写。完成前读取输入那一步已经判定了的，也先写出来。
 */
export function mergeModeLine(job: Pick<JobRecord, 'pipeline'>): { mode: TranscodeSummary['mode']; text: string } | null {
  const decided = mergeMode(job);
  if (!decided) return null;
  const { mode, reason } = decided;
  if (mode === 'stream-copy') return { mode, text: M.streamCopyLine };
  return { mode, text: M.reencodeLine(reason) };
}

/** 用了多久（开始到结束）。 */
export function elapsedText(job: Pick<JobRecord, 'startedAt' | 'endedAt'>): string | null {
  if (!job.startedAt || !job.endedAt) return null;
  const ms = Date.parse(job.endedAt) - Date.parse(job.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? M.underASecond : M.took(formatDuration(ms));
}

/** 一个参数在 shell 里的写法：只含安全字符的原样，其余用单引号包起来。 */
function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** 「复制这条 ffmpeg 命令」：Runtime 记下的命令摘要（路径只留了文件名），多条时一行一条。 */
export function commandText(job: Pick<JobRecord, 'pipeline'>): string | null {
  const commands = transcodeSummary(job)?.executor.commands;
  if (!commands?.length) return null;
  return commands.map((args) => ['ffmpeg', ...args].map(shellQuote).join(' ')).join('\n');
}

/** 状态词：在跑写「处理中」（不是「生成中」），其余同别的工具。 */
export function transcodeStateWord(job: Pick<JobRecord, 'state' | 'endedAt'>): string | null {
  if (jobLive(job)) return job.state === 'queued' ? M.stateQueued : M.stateProcessing;
  return null;
}

// ---- 没做成 ----

/** 失败的修法（设计稿 `CAUSES` / `FIXES` 里 Runtime 给得出原因码的那几条）。 */
export function failureRemedy(job: Pick<JobRecord, 'state' | 'error'>): string | null {
  if (job.state !== 'failed') return null;
  switch (job.error?.code) {
    case 'MEDIA_TOOL_UNAVAILABLE': {
      // Runtime 按它所在的平台给安装命令；旧任务没有时只说装什么。
      return M.remedyThenRetry(remedyText(job.error.details) ?? M.ffmpegInstallHint);
    }
    case 'INPUT_UNREADABLE':
      return M.inputUnreadable;
    case 'TRANSCODE_FAILED':
      return M.transcodeFailed;
    case 'EXPORT_VALIDATION_FAILED':
      return M.validationFailed;
    default:
      return null;
  }
}

/** 失败的原文：ffmpeg 的 stderr 结尾，或校验没过的几条。没有时 null。 */
export function failureDetail(job: Pick<JobRecord, 'error'>): string | null {
  const details = job.error?.details as { stderr?: unknown; problems?: unknown } | undefined;
  if (!details) return null;
  if (Array.isArray(details.problems) && details.problems.length) return details.problems.map(String).join('\n');
  if (typeof details.stderr === 'string' && details.stderr.trim()) return details.stderr.trim();
  return null;
}

// ---- 再来一版 ----

/** 最接近这个 CRF 的画质档。 */
function nearestQuality(crf: number, codec: TranscodeCodec): TranscodeQuality {
  let best: TranscodeQuality = 'balanced';
  for (const q of QUALITIES) if (Math.abs(crfOf(q.key, codec) - crf) < Math.abs(crfOf(best, codec) - crf)) best = q.key;
  return best;
}

/** 「带回左边再来一版」：冻结的参数 → 表单。CRF 不是预设档时取最接近的一档。 */
export function againTranscodeDraft(job: Pick<JobRecord, 'pipeline'>, blank: TranscodeDraft): TranscodeDraft | null {
  const params = transcodeParams(job);
  if (!params) return null;
  const codec: TranscodeCodec = params.codec === 'hevc' ? 'hevc' : 'h264';
  return {
    ...blank,
    inputs: params.inputs.filter((p): p is string => typeof p === 'string'),
    codec,
    maxHeight: typeof params.maxHeight === 'number' ? params.maxHeight : null,
    rate: typeof params.videoBitrateKbps === 'number' ? 'bitrate' : 'quality',
    quality: typeof params.crf === 'number' ? nearestQuality(params.crf, codec) : blank.quality,
    videoKbps: typeof params.videoBitrateKbps === 'number' ? params.videoBitrateKbps : blank.videoKbps,
    audioKbps: typeof params.audioBitrateKbps === 'number' ? params.audioBitrateKbps : blank.audioKbps,
    outDir: typeof params.outDir === 'string' ? params.outDir : null,
  };
}

/** 照冻结的参数原样再提交（重试、重新排队）。参数读不出来时 null。 */
export function retryParams(job: Pick<JobRecord, 'pipeline'>): TranscodeParams | null {
  const params = transcodeParams(job);
  return params ? { ...params, inputs: [...params.inputs] } : null;
}
