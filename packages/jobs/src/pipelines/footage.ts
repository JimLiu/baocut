import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonLineWorker, type SpawnProcess } from '@baocut/process-host';
import {
  FOOTAGE_COLOR_METHODS,
  FOOTAGE_INTERPOLATE_FACTORS,
  FOOTAGE_INTERPOLATE_MODES,
  FOOTAGE_MATTE_MODELS,
  FOOTAGE_MATTE_SPECS,
  FOOTAGE_PIPELINE_NAMES,
  FOOTAGE_STRENGTHS,
  FOOTAGE_UPSCALE_MODELS,
  FOOTAGE_UPSCALE_SPECS,
  RpcError,
  refOf,
  type FootageMatteModel,
  type FootageOp,
  type FootageParams,
  type FootageSummary,
  type GeneratedOutput,
  type Localized,
  type ToolInputFacts,
} from '@baocut/protocol';
import { JobsFootage as J } from '@baocut/protocol/messages/jobs/footage.ts';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { footageDemand } from '../resource-profiles.ts';
import { colorTransfer, formatCube, pixelsFromRgb24 } from './color-transfer.ts';
import { fileInputSchema, rejectUnresolvedEntry } from './entry-input.ts';
import { ffmpegFilters, ffmpegVersion, probeMedia, probeVideoDetails, runFfmpeg, type MediaToolResolver, type ProbedMedia } from './ffmpeg.ts';
import { upright } from './edit-image.ts';
import { FrameEncoder, captureOutput, chooseFrameRate, decodeFrames, filterPath } from './footage-frames.ts';
import { readImageHeader } from './image-header.ts';
import { ParamReader, invalid } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep } from './save-location.ts';
import { digestFile, durationTolerance, publishFile } from './transcode.ts';
import { lastToolLine, runImageTool, type UpscaleTool } from './upscale-image.ts';

/**
 * 素材处理（架构设计 §7.9）：去抖、视频超分、插帧、对齐颜色与抠像是同一套步骤的五条流程（`FOOTAGE_PIPELINE_NAMES`），文件到文件，
 * 不建视频、不动原文件。
 *
 * 步骤：读取（ffprobe 每个输入、定输出的尺寸与帧数；HDR 拒绝：这里的处理都按 SDR 的 RGB 算，不做色调映射）→ 处理 → 校验（读得出、
 * 尺寸与时长对得上）→ 发布（不覆盖已有的文件）。
 *
 * 超分、插帧与抠像按帧过外部工具，帧经管道进出（`footage-frames.ts`），staging 里任何时候只有一批帧：
 * - `upscale`：Real-ESRGAN（受管外部工具）按目录处理一批，模型没有原生的这个倍数时放大后由编码端缩到目标尺寸。
 * - `interpolate`：RIFE（受管外部工具）。`-n` 给 `帧数 × 倍数`，第 `倍数 × i` 张输出就是第 i 张输入、最后一张输入之后的几张是它的
 *   重复，所以每批留最后一张接到下一批开头、丢掉这批尾巴上的重复，整段输出 `(帧数 − 1) × 倍数 + 1` 张。跨硬切的两帧会被插出重影：
 *   摘要里提醒，先按镜头切开再插帧。
 * - `remove-background`：`matte` Worker（`crates/matte`）逐帧写带 alpha 的 PNG，编码成 ProRes 4444。权重是受管的权重包（选哪个包看 `matteModel`）。
 *
 * `stabilize` 与 `match-color` 只用 ffmpeg 的滤镜链：前者优先 vid.stab（要 ffmpeg 带 libvidstab，它是 GPL，BaoCut 不分发；没有时退回
 * 自带的 `deshake`，只修小幅的平移抖动，摘要里写明并给补救），后者把颜色映射烘成 3D LUT（`color-transfer.ts`）交给 `lut3d`。
 */

export const REALESRGAN_TOOL = 'realesrgan-ncnn-vulkan';
export const RIFE_TOOL = 'rife-ncnn-vulkan';
/** 插帧用的模型目录（可执行文件旁边）：v4.6 是这个发布里最新的通用模型，能插任意倍数。 */
const RIFE_MODEL = 'rife-v4.6';

/** 输出每边的上限：H.264 能编、常见播放器能放。 */
export const MAX_OUTPUT_SIDE = 7680;
/** 按帧处理的一次任务最多这么多输入帧（30 fps 两小时）。 */
export const MAX_INPUT_FRAMES = 216_000;
/** 一批帧数：超分。 */
const UPSCALE_BATCH = 48;
/** 一批帧数：插帧（输出是它乘倍数，再大 staging 就撑不住 4K）。 */
const INTERPOLATE_BATCH = 24;
/** 对齐颜色时从输入里均匀取几帧算分布。 */
const COLOR_SAMPLES = 8;
const COLOR_SAMPLE_WIDTH = 256;
/** alpha 覆盖率低于它提醒「没认出主体」。 */
const MIN_SUBJECT_COVERAGE = 0.005;
const MATTE_FRAME_TIMEOUT_MS = 120_000;
/** 没有标色彩空间、高度不小于它的素材按 BT.709 读（ffmpeg 否则按 BT.601，转 RGB 时偏色）。 */
const HD_HEIGHT = 720;
const COPYABLE_AUDIO = new Set(['aac', 'mp3', 'alac']);
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

const STABILIZE_PRESETS = {
  low: { shakiness: 4, smoothing: 10, radius: 16 },
  medium: { shakiness: 6, smoothing: 20, radius: 32 },
  high: { shakiness: 8, smoothing: 40, radius: 64 },
} as const;

const OP_KEYS: Readonly<Record<FootageOp, readonly string[]>> = {
  stabilize: ['strength'],
  upscale: ['scale', 'model'],
  interpolate: ['factor', 'mode'],
  'match-color': ['reference', 'referenceAt', 'method', 'amount'],
  'remove-background': ['matteModel', 'temporal'],
};

export interface FootageDeps {
  ffmpeg: MediaToolResolver;
  ffprobe: MediaToolResolver;
  /** 解析受管外部工具（按工具名）：没装、不能运行时抛 `RpcError('conflict')`（`TOOL_NOT_INSTALLED` 等，带补救）。权重包的 `command` 是它的目录。 */
  tool: (name: string) => Promise<UpscaleTool>;
  /** `matte` Worker 的可执行文件；找不到时 null（`remove-background` 拒绝）。 */
  matteWorker?: () => string | null;
  saveDirectory?: () => string;
  hardLink?: boolean;
  spawn?: SpawnProcess;
  platform?: NodeJS.Platform;
}

/** 冻结的参数：这种处理的默认值已经补上。 */
export type FrozenFootageParams = FootageParams;

interface InputPlan {
  kind: 'video' | 'image';
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
  /** 处理的这一段；图片是 0 与 null。 */
  start: number;
  duration: number | null;
  fps: { num: number; den: number } | null;
  /** 这一段的帧数（按时长与帧率估计）。 */
  frames: number;
  audioCodec: string | null;
  /** 读画面时要强制的矩阵；null 时交给 ffmpeg 按素材的标记。 */
  matrix: 'bt709' | null;
}

type Refusal = { code: string; message: Localized };

interface ProbeOutput extends Record<string, unknown> {
  plans: InputPlan[];
  stats: Array<{ size: number; mtimeMs: number }>;
}

interface ProcessedItem {
  file: string;
  source: string;
  /** 实际写出的帧数；图片与只走滤镜链的是估计值或 null。 */
  frames: number | null;
  fps: { num: number; den: number } | null;
  coverage?: number;
}

interface ProcessOutput extends Record<string, unknown> {
  items: ProcessedItem[];
  executor: FootageSummary['executor'];
}

interface VerifyOutput extends Record<string, unknown> {
  media: Array<GeneratedOutput['media']>;
}

interface PublishOutput extends Record<string, unknown> {
  outputs: GeneratedOutput[];
}

const label: Readonly<Record<FootageOp, () => Localized>> = {
  stabilize: () => J.stabilizeLabel(),
  upscale: () => J.upscaleLabel(),
  interpolate: () => J.interpolateLabel(),
  'match-color': () => J.matchColorLabel(),
  'remove-background': () => J.removeBackgroundLabel(),
};
const description: Readonly<Record<FootageOp, () => Localized>> = {
  stabilize: () => J.stabilizeDescription(),
  upscale: () => J.upscaleDescription(),
  interpolate: () => J.interpolateDescription(),
  'match-color': () => J.matchColorDescription(),
  'remove-background': () => J.removeBackgroundDescription(),
};

function paramsSchema(op: FootageOp): Record<string, unknown> {
  // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
  const properties: Record<string, unknown> = {
    inputs: { type: 'array', items: fileInputSchema('输入文件的绝对路径', 'Space 里的视频文件或成片'), minItems: 1, maxItems: 20 },
    start: { type: 'number', minimum: 0, description: '只处理源文件里从这一秒开始的一段' },
    end: { type: 'number', minimum: 0, description: '只处理到这一秒' },
    outDir: { type: 'string', description: '输出目录的绝对路径（不存在时创建）；不给时是保存位置（设置 downloads.directory，默认主机的下载文件夹）' },
  };
  if (op === 'stabilize') properties.strength = { type: 'string', enum: [...FOOTAGE_STRENGTHS], default: 'medium', description: '去抖强度；越强裁得越多' };
  if (op === 'upscale') {
    properties.scale = { type: 'integer', enum: [2, 3, 4], default: 2, description: '放大倍数' };
    properties.model = { type: 'string', enum: [...FOOTAGE_UPSCALE_MODELS], default: 'video', description: 'video 快、给视频做的；photo 实拍；anime 动画；后两个慢得多' };
  }
  if (op === 'interpolate') {
    properties.factor = { type: 'integer', enum: [...FOOTAGE_INTERPOLATE_FACTORS], default: 2, description: '倍数' };
    properties.mode = { type: 'string', enum: [...FOOTAGE_INTERPOLATE_MODES], default: 'slowmo', description: 'slowmo 慢放、不带声音；smooth 提高帧率、时长不变' };
  }
  if (op === 'match-color') {
    properties.reference = fileInputSchema('参考的绝对路径（图片或视频）', 'Space 里的图片、视频文件或成片');
    properties.referenceAt = { type: 'number', minimum: 0, description: '参考是视频时取哪一秒，默认中点' };
    properties.method = { type: 'string', enum: [...FOOTAGE_COLOR_METHODS], default: 'hm-mkl-hm' };
    properties.amount = { type: 'number', minimum: 0, maximum: 1, default: 1, description: '和原色的混合比例' };
  }
  if (op === 'remove-background') {
    properties.matteModel = { type: 'string', enum: [...FOOTAGE_MATTE_MODELS], default: 'fast', description: 'fast 快、Apache-2.0；general 通常更干净、慢约 4 倍，权重的训练集只许可非商业用途' };
    properties.temporal = { type: 'number', minimum: 0, maximum: 0.95, default: 0.3, description: '和上一帧混合的比例，压住闪烁' };
  }
  // i18n-ignore-end
  return { type: 'object', properties, required: op === 'match-color' ? ['inputs', 'reference'] : ['inputs'], additionalProperties: false };
}

function numberParam(raw: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid(key, JobsParams.mustBeNumberBetween({ min, max }));
  return value;
}

export function parseFootageParams(op: FootageOp, raw: Record<string, unknown>): FrozenFootageParams {
  for (const [other, keys] of Object.entries(OP_KEYS)) {
    if (other === op) continue;
    for (const key of keys) if (raw[key] !== undefined && !OP_KEYS[op].includes(key)) throw invalid(key, J.paramNotForOp({ op }));
  }
  const reader = new ParamReader(raw, ['inputs', 'start', 'end', 'outDir', ...OP_KEYS[op]]);
  const inputs = reader.array('inputs', { min: 1, max: 20 })!;
  for (const input of inputs) {
    rejectUnresolvedEntry('inputs', input);
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw invalid('inputs', JobsParams.itemsMustBeAbsolutePaths());
  }
  const start = numberParam(raw, 'start', 0, Number.MAX_SAFE_INTEGER);
  const end = numberParam(raw, 'end', 0, Number.MAX_SAFE_INTEGER);
  if (end !== undefined && end <= (start ?? 0)) throw invalid('end', J.endBeforeStart());
  const outDir = reader.string('outDir', { optional: true, max: 4096 });
  if (outDir !== undefined && !path.isAbsolute(outDir)) throw invalid('outDir', JobsParams.mustBeAbsolutePath());
  const base: FrozenFootageParams = {
    inputs: inputs as string[],
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(outDir !== undefined ? { outDir } : {}),
  };
  switch (op) {
    case 'stabilize':
      return { ...base, strength: reader.oneOf('strength', FOOTAGE_STRENGTHS) ?? 'medium' };
    case 'upscale':
      return { ...base, scale: (reader.int('scale', 2, 4) ?? 2) as 2 | 3 | 4, model: reader.oneOf('model', FOOTAGE_UPSCALE_MODELS) ?? 'video' };
    case 'interpolate': {
      const factor = (reader.int('factor', 2, 8) ?? 2) as FrozenFootageParams['factor'];
      if (!FOOTAGE_INTERPOLATE_FACTORS.includes(factor!)) throw invalid('factor', JobsParams.mustBeOneOf({ values: FOOTAGE_INTERPOLATE_FACTORS.join(', ') }));
      return { ...base, factor, mode: reader.oneOf('mode', FOOTAGE_INTERPOLATE_MODES) ?? 'slowmo' };
    }
    case 'match-color': {
      const reference = reader.string('reference', { max: 4096 });
      if (!path.isAbsolute(reference)) throw invalid('reference', JobsParams.mustBeAbsolutePath());
      const referenceAt = numberParam(raw, 'referenceAt', 0, Number.MAX_SAFE_INTEGER);
      return {
        ...base,
        reference,
        ...(referenceAt !== undefined ? { referenceAt } : {}),
        method: reader.oneOf('method', FOOTAGE_COLOR_METHODS) ?? 'hm-mkl-hm',
        amount: numberParam(raw, 'amount', 0, 1) ?? 1,
      };
    }
    case 'remove-background':
      return { ...base, matteModel: reader.oneOf('matteModel', FOOTAGE_MATTE_MODELS) ?? 'fast', temporal: numberParam(raw, 'temporal', 0, 0.95) ?? 0.3 };
  }
}

const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);

/** 这台电脑的 ffmpeg 去抖用哪个滤镜（同 `stabilize` 的判断）；ffmpeg 不能用时 null。工具页开始之前就要说退回 deshake。 */
export async function footageStabilizer(ffmpeg: MediaToolResolver): Promise<'vidstab' | 'deshake' | null> {
  try {
    const filters = await ffmpegFilters(ffmpeg);
    return filters.has('vidstabdetect') && filters.has('vidstabtransform') ? 'vidstab' : 'deshake';
  } catch {
    return null;
  }
}

/** 音频文件里嵌的封面：ffprobe 把它算一条视频流，时间上只有一张图。 */
const COVER_ART_CODECS = new Set(['mjpeg', 'png', 'bmp', 'gif', 'tiff', 'webp']);

/**
 * 工具页选好文件时读它的事实（`tools.inspectInputs`）：与 `planInput` 同样的读法与转正规则，只是不看这次的参数、读不出时不抛错。
 * 帧数由界面按时长与帧率算（选了一段时要重算），算法同 `planInput`。
 */
export async function inspectFootageInput(ffprobe: MediaToolResolver, file: string): Promise<Omit<ToolInputFacts, 'name'>> {
  const unreadable = { kind: 'unreadable', bytes: null, durationSec: null, width: null, height: null, frameRate: null, hdr: false, hasAudio: false } as const;
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return unreadable;
  const header = await readImageHeader(file).catch(() => null);
  if (header) {
    const { width, height } = upright(header);
    return { ...unreadable, kind: 'image', bytes: stat.size, width, height };
  }
  const media = await probeMedia(ffprobe, file).catch(() => null);
  if (!media || media.durationSec <= 0) return { ...unreadable, bytes: stat.size };
  const hasAudio = media.audio !== null;
  if (!media.video || (hasAudio && COVER_ART_CODECS.has(media.video.codec))) {
    return hasAudio ? { ...unreadable, kind: 'audio', bytes: stat.size, durationSec: media.durationSec, hasAudio } : { ...unreadable, bytes: stat.size };
  }
  const details = await probeVideoDetails(ffprobe, file).catch(() => null);
  const fps = chooseFrameRate(media.video.frameRate, details?.avgFrameRate ?? null);
  const sideways = Math.abs(details?.rotation ?? 0) % 180 === 90;
  return {
    kind: 'video',
    bytes: stat.size,
    durationSec: media.durationSec,
    width: sideways ? media.video.height : media.video.width,
    height: sideways ? media.video.width : media.video.height,
    frameRate: fps.num / fps.den,
    hdr: details?.transfer !== null && details?.transfer !== undefined && HDR_TRANSFERS.has(details.transfer),
    hasAudio,
  };
}

/** 读一个输入、定它的计划；不能处理时给出错误码与说明。 */
async function planInput(deps: FootageDeps, op: FootageOp, file: string, params: FrozenFootageParams, signal?: AbortSignal): Promise<InputPlan | Refusal> {
  const name = path.basename(file);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return { code: 'INPUT_UNREADABLE', message: J.inputNotFound({ file }) };
  const header = await readImageHeader(file).catch(() => null);
  if (header) {
    if (op !== 'match-color' && op !== 'remove-background') return { code: 'INPUT_UNREADABLE', message: J.inputNotVideo({ name }) };
    if (params.start !== undefined || params.end !== undefined) return { code: 'INPUT_UNREADABLE', message: J.rangeOnImage({ name }) };
    // 带 EXIF 方向的图：ffmpeg 解码时已经转正，尺寸按转正的算。
    const { width, height } = upright(header);
    return { kind: 'image', width, height, outWidth: width, outHeight: height, start: 0, duration: null, fps: null, frames: 1, audioCodec: null, matrix: null };
  }
  let media: ProbedMedia;
  try {
    media = await probeMedia(deps.ffprobe, file, signal);
  } catch (error) {
    if (error instanceof PipelineStepError && error.code === 'INPUT_UNREADABLE') return { code: 'INPUT_UNREADABLE', message: J.inputNotVideo({ name }) };
    throw error;
  }
  if (!media.video || media.durationSec <= 0) return { code: 'INPUT_UNREADABLE', message: J.inputNotVideo({ name }) };
  const details = await probeVideoDetails(deps.ffprobe, file, signal);
  if (details.transfer !== null && HDR_TRANSFERS.has(details.transfer)) return { code: 'FOOTAGE_HDR_UNSUPPORTED', message: J.inputHdr({ name }) };
  const start = params.start ?? 0;
  const end = Math.min(params.end ?? media.durationSec, media.durationSec);
  if (start >= end) return { code: 'FOOTAGE_RANGE_EMPTY', message: J.rangeEmpty({ name, duration: media.durationSec.toFixed(3) }) };
  const fps = chooseFrameRate(media.video.frameRate, details.avgFrameRate);
  const duration = end - start;
  const frames = Math.max(1, Math.round((duration * fps.num) / fps.den));
  const scale = op === 'upscale' ? params.scale! : 1;
  // 手机竖拍：存的是横的、带旋转标记，ffmpeg 解码时已经转正，尺寸要按转正的算。
  const sideways = Math.abs(details.rotation) % 180 === 90;
  const width = sideways ? media.video.height : media.video.width;
  const height = sideways ? media.video.width : media.video.height;
  const outWidth = even(width * scale);
  const outHeight = even(height * scale);
  if (outWidth > MAX_OUTPUT_SIDE || outHeight > MAX_OUTPUT_SIDE) {
    return { code: 'FOOTAGE_OUTPUT_TOO_LARGE', message: J.outputTooLarge({ name, width: outWidth, height: outHeight, max: MAX_OUTPUT_SIDE }) };
  }
  if (op === 'interpolate' && frames < 2) return { code: 'FOOTAGE_RANGE_EMPTY', message: J.tooFewFrames({ name }) };
  if (frames > MAX_INPUT_FRAMES && (op === 'upscale' || op === 'interpolate' || op === 'remove-background')) {
    return { code: 'FOOTAGE_TOO_LONG', message: J.tooManyFrames({ name, frames, max: MAX_INPUT_FRAMES }) };
  }
  return {
    kind: 'video',
    width,
    height,
    outWidth,
    outHeight,
    start,
    duration,
    fps,
    frames,
    audioCodec: media.audio?.codec ?? null,
    matrix: details.space === null && Math.min(width, height) >= HD_HEIGHT ? 'bt709' : null,
  };
}

const isPlan = (value: InputPlan | Refusal): value is InputPlan => 'kind' in value;

/** 这种处理要的外部工具的名字（按执行顺序）；抠像按选的权重。 */
export function footageTools(op: FootageOp, matteModel: FootageMatteModel = 'fast'): string[] {
  if (op === 'upscale') return [REALESRGAN_TOOL];
  if (op === 'interpolate') return [RIFE_TOOL];
  if (op === 'remove-background') return [FOOTAGE_MATTE_SPECS[matteModel].tool];
  return [];
}

async function ffmpegOrReject(ffmpeg: MediaToolResolver): Promise<string> {
  try {
    return await ffmpegVersion(ffmpeg);
  } catch (error) {
    if (error instanceof PipelineStepError) {
      const remedy = error.details?.remedy;
      throw new RpcError('conflict', error.message, { code: error.code, ...(typeof remedy === 'string' ? { remedy } : {}) });
    }
    throw error;
  }
}

export function footagePipeline(op: FootageOp, deps: FootageDeps): PipelineDefinition<FrozenFootageParams> {
  return {
    name: FOOTAGE_PIPELINE_NAMES[op],
    label: label[op],
    description: description[op],
    paramsSchema: paramsSchema(op),
    parse: (raw) => parseFootageParams(op, raw),
    async prepare(params) {
      const version = await ffmpegOrReject(deps.ffmpeg);
      for (const file of params.inputs) {
        const planned = await planInput(deps, op, file, params);
        if (!isPlan(planned)) throw new RpcError('invalid-request', planned.message, { code: planned.code, file });
      }
      if (op === 'match-color' && !(await fs.stat(params.reference!).catch(() => null))?.isFile()) {
        throw new RpcError('invalid-request', J.inputNotFound({ file: params.reference! }), { code: 'INPUT_UNREADABLE', file: params.reference });
      }
      let executor = { providerId: 'ffmpeg', modelId: `${op}@${version}` };
      for (const name of footageTools(op, params.matteModel)) {
        const tool = await deps.tool(name);
        executor = { providerId: name, modelId: `${weightsOf(op, params)}@${tool.version}` };
      }
      if (op === 'remove-background' && !deps.matteWorker?.()) throw new RpcError('conflict', J.matteWorkerMissing(), { code: 'TOOL_NOT_INSTALLED', tool: 'matte' });
      const outDir = params.outDir ?? deps.saveDirectory?.();
      if (outDir !== undefined) await ensureSaveDirectory(outDir);
      const stats = await Promise.all(params.inputs.map((file) => fs.stat(file)));
      const identity = {
        op,
        inputs: params.inputs.map((file, i) => ({ file, size: stats[i]!.size, mtimeMs: stats[i]!.mtimeMs })),
        params: { ...params, inputs: undefined, outDir: undefined },
        executor,
      };
      return {
        params: { ...params, ...(outDir !== undefined ? { outDir } : {}) },
        ...executor,
        videoId: null,
        contentHash: `sha256:${sha256Hex(canonicalJson(identity))}`,
      };
    },
    steps: [
      {
        name: 'probe',
        label: () => J.stepProbe(),
        run: async ({ params, progress, signal }) => {
          progress({ done: 0, total: params.inputs.length, unit: 'units' }, 'probing');
          const plans: InputPlan[] = [];
          for (const file of params.inputs) {
            const planned = await planInput(deps, op, file, params, signal);
            if (!isPlan(planned)) throw new PipelineStepError(planned.code, planned.message, { file });
            plans.push(planned);
            progress({ done: plans.length, total: params.inputs.length, unit: 'units' });
          }
          const stats = await Promise.all(params.inputs.map((file) => fs.stat(file)));
          const output: ProbeOutput = { plans, stats: stats.map((s) => ({ size: s.size, mtimeMs: s.mtimeMs })) };
          return { output };
        },
        reusable: async (output, { params }) => {
          const recorded = (output as ProbeOutput).stats;
          for (const [i, file] of params.inputs.entries()) {
            const stat = await fs.stat(file).catch(() => null);
            if (!stat || stat.size !== recorded[i]?.size || stat.mtimeMs !== recorded[i]?.mtimeMs) return false;
          }
          return true;
        },
      },
      {
        name: 'process',
        label: () => J.stepProcess(),
        resources: (_params, outputs) => {
          const probed = outputs.probe as ProbeOutput;
          const largest = Math.max(...probed.plans.map((plan) => plan.outWidth * plan.outHeight));
          const frames = probed.plans.reduce((sum, plan) => sum + plan.frames, 0);
          const bytes = probed.stats.reduce((sum, stat) => sum + stat.size, 0);
          return { demand: footageDemand(op, { outputPixels: largest, frames, inputBytes: bytes }) };
        },
        run: (context) => processInputs(op, deps, context),
        reusable: async (output) => {
          for (const { file } of (output as ProcessOutput).items) if (!(await fs.stat(file).catch(() => null))) return false;
          return true;
        },
      },
      {
        name: 'verify',
        label: () => J.stepVerify(),
        run: async ({ params, outputs, signal, progress }) => {
          progress(null, 'validating');
          const probed = outputs.probe as ProbeOutput;
          const processed = outputs.process as ProcessOutput;
          const media: VerifyOutput['media'] = [];
          for (const [index, item] of processed.items.entries()) {
            media.push(await verifyOutput(op, deps, item, probed.plans[index]!, params, signal));
          }
          return { output: { media } satisfies VerifyOutput };
        },
      },
      {
        name: 'publish',
        label: () => J.stepPublish(),
        run: async ({ params, outputs, signal, progress, jobId }) => {
          progress(null, 'publishing');
          const processed = outputs.process as ProcessOutput;
          const verified = outputs.verify as VerifyOutput;
          if (params.outDir !== undefined) await ensureSaveDirectoryForStep(params.outDir);
          const published: GeneratedOutput[] = [];
          for (const [index, item] of processed.items.entries()) {
            signal.throwIfAborted();
            const media = verified.media[index]!;
            const { suffix, ext, mediaType } = outputName(op, params, media.kind === 'image');
            const dir = params.outDir ?? path.dirname(item.source);
            const file = await publishFile(item.file, dir, `${path.parse(item.source).name}-${suffix}`, ext, jobId, deps.hardLink ?? true);
            const { size, digest } = await digestFile(file);
            published.push({ artifactId: `sha256:${digest}`, mediaType, byteLength: size, assetId: null, media, path: file });
          }
          const output: PublishOutput = { outputs: published };
          return { output, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
        },
      },
    ],
    async complete({ params, outputs }) {
      const probed = outputs.probe as ProbeOutput;
      const processed = outputs.process as ProcessOutput;
      const published = (outputs.publish as PublishOutput).outputs;
      const warnings: Localized[] = [
        ...(op === 'stabilize' && processed.executor.engine === 'deshake' ? [J.stabilizeFallback()] : []),
        ...(op === 'interpolate' ? [J.interpolateCuts()] : []),
        ...(op === 'interpolate' && params.mode === 'slowmo' ? [J.slowmoNoAudio()] : []),
        ...processed.items.flatMap((item) =>
          item.coverage !== undefined && item.coverage < MIN_SUBJECT_COVERAGE ? [J.noSubject({ name: path.basename(item.source) })] : [],
        ),
      ];
      const summary: FootageSummary = {
        op,
        executor: processed.executor,
        items: processed.items.map((item, i) => {
          const plan = probed.plans[i]!;
          const media = published[i]!.media;
          return {
            source: item.source,
            file: published[i]!.path!,
            width: plan.width,
            height: plan.height,
            outWidth: plan.outWidth,
            outHeight: plan.outHeight,
            durationSec: media.kind === 'video' ? media.durationSec : null,
            frames: media.kind === 'video' ? (item.frames ?? null) : null,
            ...(item.coverage !== undefined ? { coverage: item.coverage } : {}),
          };
        }),
        files: published.map((o) => o.path!),
        warnings: warnings.map((w) => w.text),
        warningRefs: warnings.map((w) => refOf(w)),
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
    },
  };
}

function weightsOf(op: FootageOp, params: FrozenFootageParams): string {
  if (op === 'upscale') return FOOTAGE_UPSCALE_SPECS[params.model!].weights;
  if (op === 'interpolate') return RIFE_MODEL;
  if (op === 'remove-background') return FOOTAGE_MATTE_SPECS[params.matteModel!].file;
  return op;
}

/** 输出的名字：`<源文件名>-<suffix><ext>`。 */
export function outputName(op: FootageOp, params: FrozenFootageParams, image: boolean): { suffix: string; ext: string; mediaType: string } {
  const mp4 = { ext: '.mp4', mediaType: 'video/mp4' };
  const png = { ext: '.png', mediaType: 'image/png' };
  switch (op) {
    case 'stabilize':
      return { suffix: 'stabilized', ...mp4 };
    case 'upscale':
      return { suffix: `upscaled-${params.scale}x`, ...mp4 };
    case 'interpolate':
      return { suffix: `${params.mode}-${params.factor}x`, ...mp4 };
    case 'match-color':
      return { suffix: 'color-matched', ...(image ? png : mp4) };
    case 'remove-background':
      return { suffix: 'cutout', ...(image ? png : { ext: '.mov', mediaType: 'video/quicktime' }) };
  }
}

async function verifyOutput(
  op: FootageOp,
  deps: FootageDeps,
  item: ProcessedItem,
  plan: InputPlan,
  params: FrozenFootageParams,
  signal: AbortSignal,
): Promise<GeneratedOutput['media']> {
  const name = path.basename(item.source);
  if (plan.kind === 'image') {
    const header = await readImageHeader(item.file).catch(() => null);
    if (!header || header.width !== plan.outWidth || header.height !== plan.outHeight) {
      throw new PipelineStepError('EXPORT_VALIDATION_FAILED', J.verifyFailed({ name }), { file: item.source });
    }
    return { kind: 'image', width: header.width, height: header.height };
  }
  const probed = await probeMedia(deps.ffprobe, item.file, signal).catch((error: unknown) => {
    if (error instanceof PipelineStepError && error.code === 'INPUT_UNREADABLE') return null;
    throw error;
  });
  const problems: string[] = [];
  if (!probed?.video) problems.push('no video stream');
  else {
    if (probed.video.width !== plan.outWidth || probed.video.height !== plan.outHeight) {
      problems.push(`size ${probed.video.width}x${probed.video.height}, expected ${plan.outWidth}x${plan.outHeight}`);
    }
    if (op === 'remove-background' && !probed.video.pixFmt.startsWith('yuva')) problems.push(`no alpha (${probed.video.pixFmt})`);
    const expected = expectedDurations(item, plan, probed.audio !== null);
    if (!expected.some((seconds) => Math.abs(probed.durationSec - seconds) <= durationTolerance(seconds))) {
      problems.push(`duration ${probed.durationSec}, expected ${expected.join(' or ')}`);
    }
  }
  if (problems.length > 0) throw new PipelineStepError('EXPORT_VALIDATION_FAILED', J.verifyFailed({ name }), { file: item.source, problems });
  return {
    kind: 'video',
    durationSec: probed!.durationSec,
    width: probed!.video!.width,
    height: probed!.video!.height,
    videoCodec: probed!.video!.codec,
    audioCodec: probed!.audio?.codec ?? null,
    ...(item.frames !== null ? { frames: item.frames } : {}),
    ...(item.fps ? { fps: `${item.fps.num}/${item.fps.den}` } : {}),
  };
}

/**
 * 输出应有的时长（容器时长，取画面与声音里长的那个）：按帧处理的是实际帧数除以输出帧率，带声音时声音也可能比画面长，到处理的这一段为止；
 * 只走滤镜链的是处理的这一段。
 */
function expectedDurations(item: ProcessedItem, plan: InputPlan, hasAudio: boolean): number[] {
  if (item.frames === null || !item.fps) return [plan.duration!];
  const picture = (item.frames * item.fps.den) / item.fps.num;
  return hasAudio ? [picture, plan.duration!] : [picture];
}

async function processInputs(op: FootageOp, deps: FootageDeps, context: PipelineStepContext<FrozenFootageParams>): Promise<{ output: ProcessOutput }> {
  const { params, outputs, staging, progress } = context;
  const probed = outputs.probe as ProbeOutput;
  const total = probed.plans.reduce((sum, plan) => sum + plan.frames, 0);
  let done = 0;
  const advance = (frames: number) => {
    done += frames;
    progress({ done: Math.min(done, total), total, unit: 'frames' });
  };
  progress({ done: 0, total, unit: 'frames' }, 'generating');
  const ffmpeg = await ffmpegVersion(deps.ffmpeg);
  const items: ProcessedItem[] = [];
  let executor: FootageSummary['executor'] = { engine: op, tool: 'ffmpeg', version: ffmpeg, weights: null };
  for (const [index, source] of params.inputs.entries()) {
    const plan = probed.plans[index]!;
    const work = { source, plan, index, staging, signal: context.signal, advance };
    switch (op) {
      case 'stabilize': {
        const result = await stabilize(deps, params, work);
        executor = { engine: result.engine, tool: 'ffmpeg', version: ffmpeg, weights: null };
        items.push(result.item);
        break;
      }
      case 'upscale': {
        const tool = await deps.tool(REALESRGAN_TOOL);
        executor = { engine: 'realesrgan', tool: REALESRGAN_TOOL, version: tool.version, weights: FOOTAGE_UPSCALE_SPECS[params.model!].weights };
        items.push(await upscale(deps, tool, params, work));
        break;
      }
      case 'interpolate': {
        const tool = await deps.tool(RIFE_TOOL);
        executor = { engine: 'rife', tool: RIFE_TOOL, version: tool.version, weights: RIFE_MODEL };
        items.push(await interpolate(deps, tool, params, work));
        break;
      }
      case 'match-color':
        executor = { engine: 'lut3d', tool: 'ffmpeg', version: ffmpeg, weights: params.method! };
        items.push(await matchColor(deps, params, work));
        break;
      case 'remove-background': {
        const spec = FOOTAGE_MATTE_SPECS[params.matteModel!];
        const weights = await deps.tool(spec.tool);
        executor = { engine: 'matte', tool: spec.tool, version: weights.version, weights: spec.file };
        items.push(await removeBackground(deps, weights, params, work));
        break;
      }
    }
  }
  return { output: { items, executor } };
}

interface Work {
  source: string;
  plan: InputPlan;
  index: number;
  staging: string;
  signal: AbortSignal;
  advance: (frames: number) => void;
}

/** 读画面的前缀：要强制矩阵时加一段 `scale`。 */
function readFilters(plan: InputPlan): string[] {
  return plan.matrix ? [`scale=in_color_matrix=${plan.matrix}`] : [];
}

/** 解码成 RGB 帧流的滤镜：先按素材的帧率转成恒定帧率（手机素材常是可变帧率）。 */
function decodeFilter(plan: InputPlan): string {
  return [...readFilters(plan), `fps=${plan.fps!.num}/${plan.fps!.den}`, 'format=rgb24'].join(',');
}

/** 声音照搬这一段：MP4 放得下的流复制，别的转成 AAC。 */
function audioOutputArgs(plan: InputPlan, inputIndex: number): string[] {
  if (plan.audioCodec === null) return [];
  const copy = COPYABLE_AUDIO.has(plan.audioCodec);
  return ['-map', `${inputIndex}:a:0?`, ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k'])];
}

const H264_ARGS = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
/** 写到输出帧上的色彩标记：较新的 ffmpeg 以帧上的为准，只给编码器选项标不全。 */
const BT709_FRAME_TAGS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709';
const PRORES_ALPHA_ARGS = ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', '-qscale:v', '9'];

/** 编码端：从标准输入读 PNG，可选地带上源文件这一段的声音。 */
function frameEncoderArgs(options: {
  plan: InputPlan;
  source: string;
  fps: { num: number; den: number };
  withAudio: boolean;
  alpha: boolean;
  out: string;
}): string[] {
  const { plan, source, fps, withAudio, alpha, out } = options;
  const audio = withAudio && plan.audioCodec !== null;
  const scale = `scale=${plan.outWidth}:${plan.outHeight}:flags=lanczos:out_color_matrix=bt709:out_range=tv`;
  return [
    ...['-hide_banner', '-v', 'error', '-y'],
    ...['-f', 'image2pipe', '-framerate', `${fps.num}/${fps.den}`, '-c:v', 'png', '-i', 'pipe:0'],
    ...(audio
      ? [...(plan.start > 0 ? ['-ss', plan.start.toFixed(6)] : []), '-t', plan.duration!.toFixed(6), '-i', `file:${source}`]
      : []),
    ...['-map', '0:v:0'],
    ...(audio ? audioOutputArgs(plan, 1) : []),
    ...['-vf', `${scale},format=${alpha ? 'yuva444p10le' : 'yuv420p'},${BT709_FRAME_TAGS}`],
    ...(alpha ? PRORES_ALPHA_ARGS : H264_ARGS),
    `file:${out}`,
  ];
}

/** 把帧流按批取出。 */
async function* batches(frames: AsyncIterable<Buffer>, size: number): AsyncGenerator<Buffer[]> {
  let batch: Buffer[] = [];
  for await (const frame of frames) {
    batch.push(frame);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

const frameName = (index: number) => `${String(index).padStart(8, '0')}.png`;

/** 清空并准备一批帧的工作目录。 */
async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function runFrameTool(deps: FootageDeps, name: string, tool: UpscaleTool, args: string[], source: string, signal: AbortSignal): Promise<void> {
  const run = await runImageTool(name, tool, args, signal, deps);
  if (run.code !== 0) {
    throw new PipelineStepError('FOOTAGE_TOOL_FAILED', J.toolFailed({ tool: name, name: path.basename(source), detail: lastToolLine(run.stderr) || `exit ${run.code}` }), {
      file: source,
      exitCode: run.code,
      stderr: run.stderr.trim().slice(-1000),
    });
  }
}

/**
 * 帧工具跑一批时按它写出的文件数报进度，跑完补齐：实拍权重 1080p 一批要跑好几分钟，等一批跑完才报，界面一直是 0 帧，像卡住了。
 * 工具失败时不补齐，错误照抛。
 */
export async function withFrameProgress(dir: string, total: number, advance: (frames: number) => void, run: () => Promise<void>, intervalMs = 1000): Promise<void> {
  let reported = 0;
  let finished = false;
  const report = async () => {
    const written = await fs.readdir(dir).then((names) => names.length, () => 0);
    if (finished) return;
    const next = Math.min(written, total);
    if (next > reported) {
      advance(next - reported);
      reported = next;
    }
  };
  const timer = setInterval(() => void report(), intervalMs);
  try {
    await run();
  } finally {
    finished = true;
    clearInterval(timer);
  }
  if (total > reported) advance(total - reported);
}

async function readOutputFrame(file: string, tool: string, source: string): Promise<Buffer> {
  try {
    return await fs.readFile(file);
  } catch {
    throw new PipelineStepError('FOOTAGE_TOOL_FAILED', J.toolFailed({ tool, name: path.basename(source), detail: `missing ${path.basename(file)}` }), { file: source });
  }
}

/** 编码端跑完（或失败时放弃）：`body` 负责写帧。 */
async function withEncoder(deps: FootageDeps, args: string[], signal: AbortSignal, body: (encoder: FrameEncoder) => Promise<void>): Promise<void> {
  const encoder = new FrameEncoder(await deps.ffmpeg(), args, signal);
  try {
    await body(encoder);
    await encoder.finish();
  } catch (error) {
    await encoder.abort();
    throw error;
  }
}

async function upscale(deps: FootageDeps, tool: UpscaleTool, params: FrozenFootageParams, work: Work): Promise<ProcessedItem> {
  const { source, plan, index, staging, signal, advance } = work;
  const spec = FOOTAGE_UPSCALE_SPECS[params.model!];
  // 模型没有这个倍数时取比它大的最小原生倍数，编码端缩到目标尺寸。
  const native = spec.native.find((value) => value >= params.scale!) ?? spec.native.at(-1)!;
  const models = tool.modelsDir ?? path.join(path.dirname(tool.command), 'models');
  const out = path.join(staging, `output-${index + 1}.mp4`);
  const [inDir, outDir] = [path.join(staging, `in-${index + 1}`), path.join(staging, `out-${index + 1}`)];
  let frames = 0;
  await withEncoder(deps, frameEncoderArgs({ plan, source, fps: plan.fps!, withAudio: true, alpha: false, out }), signal, async (encoder) => {
    const decoded = decodeFrames(deps.ffmpeg, { file: source, start: plan.start, duration: plan.duration, filter: decodeFilter(plan) }, signal);
    for await (const batch of batches(decoded, UPSCALE_BATCH)) {
      await resetDir(inDir);
      await resetDir(outDir);
      await Promise.all(batch.map((frame, i) => fs.writeFile(path.join(inDir, frameName(i + 1)), frame)));
      await withFrameProgress(outDir, batch.length, advance, () =>
        runFrameTool(deps, REALESRGAN_TOOL, tool, ['-i', inDir, '-o', outDir, '-n', spec.weights, '-s', String(native), '-m', models, '-f', 'png'], source, signal),
      );
      for (let i = 1; i <= batch.length; i++) await encoder.write(await readOutputFrame(path.join(outDir, frameName(i)), REALESRGAN_TOOL, source));
      frames += batch.length;
    }
  });
  await fs.rm(inDir, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
  return { file: out, source, frames, fps: plan.fps };
}

async function interpolate(deps: FootageDeps, tool: UpscaleTool, params: FrozenFootageParams, work: Work): Promise<ProcessedItem> {
  const { source, plan, index, staging, signal, advance } = work;
  const factor = params.factor!;
  const smooth = params.mode === 'smooth';
  const fps = smooth ? { num: plan.fps!.num * factor, den: plan.fps!.den } : plan.fps!;
  const model = path.join(tool.modelsDir ?? path.dirname(tool.command), RIFE_MODEL);
  const out = path.join(staging, `output-${index + 1}.mp4`);
  const [inDir, outDir] = [path.join(staging, `in-${index + 1}`), path.join(staging, `out-${index + 1}`)];
  const uhd = Math.max(plan.width, plan.height) >= 2160 ? ['-u'] : [];
  let written = 0;
  await withEncoder(deps, frameEncoderArgs({ plan, source, fps, withAudio: smooth, alpha: false, out }), signal, async (encoder) => {
    const decoded = decodeFrames(deps.ffmpeg, { file: source, start: plan.start, duration: plan.duration, filter: decodeFilter(plan) }, signal);
    let carry: Buffer | null = null;
    for await (const batch of batches(decoded, INTERPOLATE_BATCH)) {
      const group: Buffer[] = carry ? [carry, ...batch] : batch;
      carry = group.at(-1)!;
      if (group.length < 2) continue;
      await resetDir(inDir);
      await resetDir(outDir);
      await Promise.all(group.map((frame, i) => fs.writeFile(path.join(inDir, frameName(i + 1)), frame)));
      await runFrameTool(deps, RIFE_TOOL, tool, ['-i', inDir, '-o', outDir, '-m', model, '-n', String(group.length * factor), '-f', '%08d.png', ...uhd], source, signal);
      // 这批最后一张输入留给下一批开头，它和尾巴上的重复这里不写。
      const keep = (group.length - 1) * factor;
      for (let i = 1; i <= keep; i++) await encoder.write(await readOutputFrame(path.join(outDir, frameName(i)), RIFE_TOOL, source));
      written += keep;
      advance(batch.length);
    }
    if (carry) {
      await encoder.write(carry);
      written += 1;
    }
  });
  await fs.rm(inDir, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
  return { file: out, source, frames: written, fps };
}

async function removeBackground(deps: FootageDeps, weights: UpscaleTool, params: FrozenFootageParams, work: Work): Promise<ProcessedItem> {
  const { source, plan, index, staging, signal, advance } = work;
  const spec = FOOTAGE_MATTE_SPECS[params.matteModel!];
  const command = deps.matteWorker?.();
  if (!command) throw new PipelineStepError('TOOL_NOT_INSTALLED', J.matteWorkerMissing(), { tool: 'matte' });
  const model = path.join(weights.command, spec.file);
  const worker = await JsonLineWorker.start({ command, args: [model, String(spec.side), spec.mean.join(','), spec.std.join(',')], ...(weights.env ? { env: weights.env } : {}) });
  const onAbort = () => void worker.kill();
  signal.addEventListener('abort', onAbort, { once: true });
  const matte = async (input: string, output: string, reset: boolean, temporal: number) => {
    try {
      return await worker.request<{ coverage: number }>('matte', { input, output, temporal, reset }, { timeoutMs: MATTE_FRAME_TIMEOUT_MS });
    } catch (error) {
      signal.throwIfAborted();
      throw new PipelineStepError('FOOTAGE_TOOL_FAILED', J.toolFailed({ tool: 'matte', name: path.basename(source), detail: (error as Error).message.slice(0, 300) }), {
        file: source,
        stderr: worker.stderrTail().slice(-1000),
      });
    }
  };
  try {
    if (plan.kind === 'image') {
      // 先经 ffmpeg 解成 PNG：转正 EXIF 方向，WebP 与扩展名不对的文件也一样读得出（`matte` 只认 PNG 与 JPEG）。
      const upright = path.join(staging, `input-${index + 1}.png`);
      await runFfmpeg(deps.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', `file:${source}`, '-vf', 'format=rgb24', '-frames:v', '1', '-update', '1', `file:${upright}`], { signal });
      const out = path.join(staging, `output-${index + 1}.png`);
      const result = await matte(upright, out, true, 0);
      await fs.rm(upright, { force: true });
      advance(1);
      return { file: out, source, frames: null, fps: null, coverage: result.coverage };
    }
    const out = path.join(staging, `output-${index + 1}.mov`);
    const [input, output] = [path.join(staging, `frame-in-${index + 1}.png`), path.join(staging, `frame-out-${index + 1}.png`)];
    let frames = 0;
    let coverage = 0;
    await withEncoder(deps, frameEncoderArgs({ plan, source, fps: plan.fps!, withAudio: true, alpha: true, out }), signal, async (encoder) => {
      for await (const frame of decodeFrames(deps.ffmpeg, { file: source, start: plan.start, duration: plan.duration, filter: decodeFilter(plan) }, signal)) {
        await fs.writeFile(input, frame);
        const result = await matte(input, output, frames === 0, params.temporal ?? 0);
        coverage += result.coverage;
        await encoder.write(await fs.readFile(output));
        frames += 1;
        advance(1);
      }
    });
    await fs.rm(input, { force: true });
    await fs.rm(output, { force: true });
    return { file: out, source, frames, fps: plan.fps, coverage: frames > 0 ? coverage / frames : 0 };
  } finally {
    signal.removeEventListener('abort', onAbort);
    await worker.close().catch(() => {});
  }
}

/** ffmpeg 带 libvidstab 时走 vid.stab 的两遍，没有时退回 `deshake`。声音流复制（或转 AAC）。 */
async function stabilize(deps: FootageDeps, params: FrozenFootageParams, work: Work): Promise<{ item: ProcessedItem; engine: string }> {
  const { source, plan, index, staging, signal, advance } = work;
  const preset = STABILIZE_PRESETS[params.strength!];
  const filters = await ffmpegFilters(deps.ffmpeg);
  const vidstab = filters.has('vidstabdetect') && filters.has('vidstabtransform');
  const out = path.join(staging, `output-${index + 1}.mp4`);
  const input = [
    ...(plan.start > 0 ? ['-ss', plan.start.toFixed(6)] : []),
    ...['-t', plan.duration!.toFixed(6)],
    ...['-i', `file:${source}`],
  ];
  const secondsToFrames = (seconds: number) => Math.round((seconds * plan.fps!.num) / plan.fps!.den);
  let reported = 0;
  const report = (share: number, offset: number) => (seconds: number) => {
    const target = Math.round(offset + secondsToFrames(seconds) * share);
    if (target > reported) {
      advance(target - reported);
      reported = target;
    }
  };
  let filter: string;
  if (vidstab) {
    const transforms = filterPath(path.join(staging, `transforms-${index + 1}.trf`));
    await runFfmpeg(
      deps.ffmpeg,
      [
        ...['-hide_banner', '-v', 'error', '-y', '-progress', 'pipe:1', '-nostats'],
        ...input,
        ...['-map', '0:v:0', '-an', '-sn', '-dn'],
        ...['-vf', `vidstabdetect=stepsize=6:shakiness=${preset.shakiness}:accuracy=9:result=${transforms}`],
        ...['-f', 'null', '-'],
      ],
      { signal, onTime: report(0.5, 0) },
    );
    filter = `vidstabtransform=input=${transforms}:smoothing=${preset.smoothing}:optzoom=1:zoomspeed=0.25:interpol=bicubic,unsharp=5:5:0.8:3:3:0.4`;
  } else {
    filter = `deshake=rx=${preset.radius}:ry=${preset.radius}:edge=mirror:blocksize=8:contrast=125`;
  }
  await runFfmpeg(
    deps.ffmpeg,
    [
      ...['-hide_banner', '-v', 'error', '-y', '-progress', 'pipe:1', '-nostats'],
      ...input,
      ...['-map', '0:v:0'],
      ...audioOutputArgs(plan, 0),
      ...['-vf', `${filter},scale=${plan.outWidth}:${plan.outHeight}`],
      ...H264_ARGS,
      `file:${out}`,
    ],
    { signal, onTime: report(vidstab ? 0.5 : 1, vidstab ? plan.frames / 2 : 0) },
  );
  if (reported < plan.frames) advance(plan.frames - reported);
  return { item: { file: out, source, frames: null, fps: plan.fps }, engine: vidstab ? 'vidstab' : 'deshake' };
}

/** 一帧 `rgb24` 的字节，缩到给定的宽（高按比例，取偶数）。 */
async function sampleFrame(deps: FootageDeps, file: string, at: number | null, matrix: 'bt709' | null, signal: AbortSignal): Promise<Uint8Array> {
  return captureOutput(
    deps.ffmpeg,
    [
      ...['-hide_banner', '-v', 'error', '-nostdin'],
      ...(at !== null && at > 0 ? ['-ss', at.toFixed(6)] : []),
      ...['-i', `file:${file}`, '-map', '0:v:0', '-frames:v', '1'],
      ...['-vf', [...(matrix ? [`scale=in_color_matrix=${matrix}`] : []), `scale=${COLOR_SAMPLE_WIDTH}:-2:flags=area`, 'format=rgb24'].join(',')],
      ...['-f', 'rawvideo', 'pipe:1'],
    ],
    signal,
  );
}

/** 取样的结果：一个像素也没有时（画面比声音短，时刻落在画面结束之后）拒绝，不拿空的分布算出一个看着像结果的错误映射。 */
function sampled(bytes: Uint8Array, file: string): Float64Array {
  if (bytes.length < 3) throw new PipelineStepError('INPUT_UNREADABLE', J.inputNotVideo({ name: path.basename(file) }), { file });
  return pixelsFromRgb24(bytes);
}

/** 输入这一段里均匀取几帧的像素。 */
async function samplePixels(deps: FootageDeps, source: string, plan: InputPlan, signal: AbortSignal): Promise<Float64Array> {
  if (plan.kind === 'image') return sampled(await sampleFrame(deps, source, null, null, signal), source);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < COLOR_SAMPLES; i++) {
    const at = plan.start + (plan.duration! * (i + 0.5)) / COLOR_SAMPLES;
    frames.push(await sampleFrame(deps, source, at, plan.matrix, signal));
  }
  return sampled(Buffer.concat(frames), source);
}

async function referencePixels(deps: FootageDeps, params: FrozenFootageParams, signal: AbortSignal): Promise<Float64Array> {
  const file = params.reference!;
  const name = path.basename(file);
  if (await readImageHeader(file).catch(() => null)) return sampled(await sampleFrame(deps, file, null, null, signal), file);
  const media = await probeMedia(deps.ffprobe, file, signal);
  if (!media.video) throw new PipelineStepError('INPUT_UNREADABLE', J.inputNotVideo({ name }), { file });
  const details = await probeVideoDetails(deps.ffprobe, file, signal);
  if (details.transfer !== null && HDR_TRANSFERS.has(details.transfer)) throw new PipelineStepError('FOOTAGE_HDR_UNSUPPORTED', J.inputHdr({ name }), { file });
  const at = Math.min(params.referenceAt ?? media.durationSec / 2, Math.max(0, media.durationSec - 0.05));
  const matrix = details.space === null && Math.min(media.video.width, media.video.height) >= HD_HEIGHT ? 'bt709' : null;
  return sampled(await sampleFrame(deps, file, at, matrix, signal), file);
}

async function matchColor(deps: FootageDeps, params: FrozenFootageParams, work: Work): Promise<ProcessedItem> {
  const { source, plan, index, staging, signal, advance } = work;
  const [from, to] = [await samplePixels(deps, source, plan, signal), await referencePixels(deps, params, signal)];
  const cube = path.join(staging, `match-${index + 1}.cube`);
  await fs.writeFile(cube, formatCube(colorTransfer(params.method!, from, to), params.amount ?? 1));
  const lut = `lut3d=file=${filterPath(cube)}:interp=tetrahedral`;
  if (plan.kind === 'image') {
    const out = path.join(staging, `output-${index + 1}.png`);
    await runFfmpeg(deps.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', `file:${source}`, '-vf', `format=rgb24,${lut}`, '-frames:v', '1', '-update', '1', `file:${out}`], { signal });
    advance(1);
    return { file: out, source, frames: null, fps: null };
  }
  const out = path.join(staging, `output-${index + 1}.mp4`);
  let reported = 0;
  await runFfmpeg(
    deps.ffmpeg,
    [
      ...['-hide_banner', '-v', 'error', '-y', '-progress', 'pipe:1', '-nostats'],
      ...(plan.start > 0 ? ['-ss', plan.start.toFixed(6)] : []),
      ...['-t', plan.duration!.toFixed(6), '-i', `file:${source}`],
      ...['-map', '0:v:0'],
      ...audioOutputArgs(plan, 0),
      ...['-vf', [...readFilters(plan), 'format=rgb24', lut, `scale=${plan.outWidth}:${plan.outHeight}:out_color_matrix=bt709:out_range=tv`, 'format=yuv420p', BT709_FRAME_TAGS].join(',')],
      ...H264_ARGS,
      `file:${out}`,
    ],
    {
      signal,
      onTime: (seconds) => {
        const target = Math.round((seconds * plan.fps!.num) / plan.fps!.den);
        if (target > reported) {
          advance(target - reported);
          reported = target;
        }
      },
    },
  );
  if (reported < plan.frames) advance(plan.frames - reported);
  return { file: out, source, frames: null, fps: plan.fps };
}

/** 确认卡与回复里的执行器（产品名与模型名，不翻译）。 */
export function footageExecutorLabel(op: FootageOp, params: { model?: string | undefined; matteModel?: string | undefined; method?: string | undefined }): string {
  switch (op) {
    case 'stabilize':
      return 'vid.stab / deshake (ffmpeg)';
    case 'upscale':
      return `Real-ESRGAN (${FOOTAGE_UPSCALE_SPECS[(params.model ?? 'video') as keyof typeof FOOTAGE_UPSCALE_SPECS].weights})`;
    case 'interpolate':
      return `RIFE (${RIFE_MODEL})`;
    case 'match-color':
      return `${params.method ?? 'hm-mkl-hm'} (ffmpeg lut3d)`;
    case 'remove-background':
      return `rembg weights (${FOOTAGE_MATTE_SPECS[(params.matteModel ?? 'fast') as FootageMatteModel].file})`;
  }
}



