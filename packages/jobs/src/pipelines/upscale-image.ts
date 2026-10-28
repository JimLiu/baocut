import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { killProcessTree, type SpawnProcess } from '@baocut/process-host';
import {
  RpcError,
  UPSCALE_IMAGE_DENOISE_LEVELS,
  UPSCALE_IMAGE_MODEL_SPECS,
  UPSCALE_IMAGE_MODELS,
  UPSCALE_IMAGE_PROMPT_MAX,
  upscaleNeedsResize,
  upscalePeakScale,
  type GeneratedOutput,
  type Id,
  type Localized,
  type UpscaleImageDenoise,
  type UpscaleImageModel,
  type UpscaleImageParams,
  type UpscaleImageScale,
  type UpscaleImageSummary,
} from '@baocut/protocol';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { JobsUpscaleImage as J } from '@baocut/protocol/messages/jobs/upscale-image.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { upscaleImageDemand } from '../resource-profiles.ts';
import { fileInputSchema, rejectUnresolvedEntry } from './entry-input.ts';
import { ffmpegVersion, runFfmpeg, type MediaToolResolver } from './ffmpeg.ts';
import { readImageHeader, type ImageHeader } from './image-header.ts';
import { ParamReader, invalid } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext, type StepResources } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep } from './save-location.ts';
import { publishFile } from './transcode.ts';

/**
 * 图片超分（架构设计 §7.9；技术方案 §4.1）：文件到文件，不建视频。引擎按模型定（`UPSCALE_IMAGE_MODEL_SPECS`）：受管外部工具
 * Real-ESRGAN（自带权重或 Upscayl 权重包）与 waifu2x 在本机 GPU 上执行（ncnn 版，Vulkan；macOS 经 MoltenVK 跑 Metal）；`lanczos`
 * 是 ffmpeg 的插值；`generative` 由能收参考图的生图模型按高分辨率重画（在进程内调用 Provider，经授权与预算，同图片编辑）。
 *
 * 步骤：读取（文件头里的格式、尺寸与 EXIF 方向；输出每边不超过 `MAX_OUTPUT_SIDE`；`generative` 按模型的尺寸表定每张图出图的
 * 尺寸）→ 放大（每张图起一次工具或调一次模型，写进 staging；没有原生倍数时先放大到原生倍数再由 ffmpeg 用 Lanczos 缩到目标尺寸）
 * → 校验（输出是 PNG，尺寸正好是源尺寸乘倍数）→ 发布（`<源文件名>-upscaled-<倍数>x.png`，不覆盖已有的文件）。
 *
 * - 本机工具按块推理并拼回（ncnn 按显存自选块大小），透明通道由它另行放大；EXIF 方向不转正（像素原样放大），带方向标记的源图在摘要里提醒。
 * - 超分是更高分辨率的估计，不能找回压缩或失焦丢掉的真实细节；文字、界面截图可能被「画」出不存在的笔画。生成式放大改动更大，
 *   摘要里总是提醒。
 * - 生成式放大：选比例最接近的尺寸里像素刚够目标的一档（都不够时最大的一档），出图比源图还小时拒绝（`UPSCALE_MODEL_TOO_SMALL`）。
 *   比例不同时先在四周补黑边到模型的比例，出图后按同样的比例裁掉，再缩放到目标尺寸；出图不够目标尺寸的部分是插值，摘要里提醒。
 */

export const UPSCALE_IMAGE_PIPELINE = 'upscale-image';

/** 输出每边的上限（像素）：再大 PNG 编码与查看都不现实，也超出常见图片软件的上限。 */
export const MAX_OUTPUT_SIDE = 16384;

/** 受管外部工具的名字（§12.9）：执行的工具、Upscayl 权重包。 */
const REALESRGAN = 'realesrgan-ncnn-vulkan';
const WAIFU2X = 'waifu2x-ncnn-vulkan';
const UPSCAYL_MODELS = 'upscayl-models';

/** 生成式放大给模型的提示词（给模型看的，英文）；用户的说明接在后面。 */
const GENERATIVE_PROMPT =
  'Upscale this image to a higher resolution. Reproduce it faithfully: keep the composition, framing, colours, lighting, text and every ' +
  'object exactly where they are, and only add fine detail and sharpness consistent with the original. Do not add, remove, move or restyle anything.';
const GENERATIVE_PADDED = 'The solid black bands along the edges are padding: keep them solid black and do not draw into them.';

const KILL_GRACE_MS = 2000;
const STDERR_TAIL = 4000;

/** 解析好、能用的外部工具：可执行文件与版本（受管副本是发布版本）。Upscayl 权重包的 `command` 是它的目录（含 `models`）。 */
export interface UpscaleTool {
  command: string;
  version: string;
  /** 用解释器运行脚本时的固定参数（测试的假工具）；不经 shell。 */
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** 权重目录：Real-ESRGAN 不给时是可执行文件旁边的 `models/`，waifu2x 不给时是可执行文件所在的目录（放各个 `models-*`）。 */
  modelsDir?: string;
}

/** 生成式放大的执行者（Runtime 里接生图的 Provider）。 */
export interface ImageUpscaler {
  /**
   * 启动（与重试）时：选定 Provider 与模型，给出模型支持的尺寸（`WIDTHxHEIGHT`）。模型不收参考图或不列尺寸时抛
   * `RpcError('invalid-request')`（`UPSCALE_MODEL_UNSUPPORTED`）。
   */
  prepare(target: { provider?: string; model?: string }): Promise<{ providerId: string; modelId: string; sizes: readonly string[] }>;
  /** 放大这一步的峰值需求与执行队列：本机模型包要先占它的 Model Worker；在线与节点的 null。 */
  resources?(target: { providerId: string; modelId: string }): StepResources | null;
  /** 按 `size` 重画一张图（`image` 作参考图），输出写在 `staging` 里。 */
  upscale(request: {
    providerId: string;
    modelId: string;
    image: string;
    prompt: string;
    size: string;
    jobId: Id;
    staging: string;
    signal: AbortSignal;
  }): Promise<{ file: string }>;
}

export interface UpscaleImageDeps {
  /** 解析受管外部工具（按工具名）：没装、不能运行时抛 `RpcError('conflict')`（`TOOL_NOT_INSTALLED` 等，带补救）。 */
  tool: (name: string) => Promise<UpscaleTool>;
  /** 缩放、Lanczos 插值与生成式放大的补边、裁切用。 */
  ffmpeg: MediaToolResolver;
  /** `generative` 的执行者；没有接线时不收 `generative`。 */
  upscaler?: ImageUpscaler;
  /** 不给 `outDir` 时的保存位置（§7.9「保存位置」）；没有接线时写在源文件旁边。 */
  saveDirectory?: () => string;
  /** 同 `TranscodeDeps.hardLink`。 */
  hardLink?: boolean;
  spawn?: SpawnProcess;
  platform?: NodeJS.Platform;
}

/** 冻结的参数：默认值已经补上；能降噪的模型补上 `denoise`，`generative` 补上选定的 Provider 与模型。 */
export interface FrozenUpscaleImageParams extends UpscaleImageParams {
  scale: UpscaleImageScale;
  model: UpscaleImageModel;
}

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    inputs: {
      type: 'array',
      items: fileInputSchema('输入图片的绝对路径（PNG、JPEG、WebP）', 'Space 里的图片条目'),
      minItems: 1,
      maxItems: 50,
    },
    scale: { type: 'integer', enum: [2, 3, 4], default: 4, description: '放大倍数' },
    model: {
      type: 'string',
      enum: [...UPSCALE_IMAGE_MODELS],
      default: 'photo',
      description:
        'Real-ESRGAN：photo 照片与写实、anime 动画与视频截图、illustration 插画与线稿；Upscayl 权重包（要另装）：upscayl-lite 快、' +
        'high-fidelity 保真、remacri 锐利写实（不可商用）、ultramix-balanced 均衡、ultrasharp 最锐利（不可商用）；waifu2x：waifu2x 插画、' +
        'waifu2x-anime 动画、waifu2x-photo 照片（可降噪）；lanczos 插值，不用模型；generative 用生图模型重画（联网，可能改动内容）',
    },
    denoise: { type: 'integer', enum: [...UPSCALE_IMAGE_DENOISE_LEVELS], default: 0, description: '降噪强度，-1 不降噪、3 最强；只有 waifu2x 的模型收' },
    provider: { type: 'string', description: 'generative：生图的 Provider；不给时按默认值选能收参考图的模型' },
    imageModel: { type: 'string', description: 'generative：生图模型的 ID' },
    prompt: { type: 'string', maxLength: UPSCALE_IMAGE_PROMPT_MAX, description: 'generative：附加的说明（例如画面里是什么、要保留的文字）' },
    outDir: { type: 'string', description: '输出目录的绝对路径（不存在时创建）；不给时是保存位置（设置 downloads.directory，默认主机的下载文件夹）' },
    // i18n-ignore-end
  },
  required: ['inputs'],
  additionalProperties: false,
};

/** 一张图的计划。`generative` 时另有出图的尺寸、补边后的尺寸与补边的偏移（不补边时与源图相同、偏移为 0）。 */
interface ImagePlan {
  width: number;
  height: number;
  orientation: number | null;
  model: { size: string; width: number; height: number; padWidth: number; padHeight: number; x: number; y: number } | null;
}

interface ProbeOutput extends Record<string, unknown> {
  images: ImagePlan[];
  stats: Array<{ size: number; mtimeMs: number }>;
}

interface UpscaleOutput extends Record<string, unknown> {
  files: Array<{ file: string; source: string; width: number; height: number }>;
  executor: UpscaleImageSummary['executor'];
}

interface PublishOutput extends Record<string, unknown> {
  outputs: GeneratedOutput[];
}

/**
 * 生成式放大的出图尺寸：`sizes` 里比例与源图最接近的几档（相差不到 0.5%）中，像素刚够目标（源尺寸乘倍数）的最小一档，都不够时
 * 最大的一档。没有能解析的尺寸时 null。
 */
export function upscaleModelSize(sizes: readonly string[], width: number, height: number, scale: number): { size: string; width: number; height: number } | null {
  const parsed = sizes.flatMap((size) => {
    const match = /^(\d+)x(\d+)$/.exec(size);
    return match ? [{ size, width: Number(match[1]), height: Number(match[2]) }] : [];
  });
  if (!parsed.length) return null;
  const target = Math.log(width / height);
  const diff = (s: { width: number; height: number }) => Math.abs(Math.log(s.width / s.height) - target);
  const best = Math.min(...parsed.map(diff));
  const near = parsed.filter((s) => diff(s) <= best + 0.005).sort((a, b) => a.width * a.height - b.width * b.height);
  const want = width * scale * height * scale;
  return near.find((s) => s.width * s.height >= want) ?? near.at(-1)!;
}

/** 补边到模型的比例：比源图宽时补左右，高时补上下，居中；补完的尺寸与源图左上角的偏移。 */
function padPlan(width: number, height: number, model: { width: number; height: number }) {
  const ratio = model.width / model.height;
  const padWidth = ratio > width / height ? Math.max(width, Math.round(height * ratio)) : width;
  const padHeight = ratio > width / height ? height : Math.max(height, Math.round(width / ratio));
  return { padWidth, padHeight, x: Math.floor((padWidth - width) / 2), y: Math.floor((padHeight - height) / 2) };
}

export function upscaleImagePipeline(deps: UpscaleImageDeps): PipelineDefinition<FrozenUpscaleImageParams> {
  return {
    name: UPSCALE_IMAGE_PIPELINE,
    label: () => J.label(),
    description: () => J.description(),
    paramsSchema: PARAMS_SCHEMA,
    parse: parseUpscaleImageParams,
    async prepare(params) {
      const spec = UPSCALE_IMAGE_MODEL_SPECS[params.model];
      // 生成式放大先选定模型：每张图出图的尺寸由它的尺寸表定。
      let chosen: Awaited<ReturnType<ImageUpscaler['prepare']>> | null = null;
      if (spec.engine === 'generative') {
        if (!deps.upscaler) throw new RpcError('invalid-request', J.generativeUnavailable(), { code: 'UPSCALE_MODEL_UNSUPPORTED' });
        chosen = await deps.upscaler.prepare({
          ...(params.provider !== undefined ? { provider: params.provider } : {}),
          ...(params.imageModel !== undefined ? { model: params.imageModel } : {}),
        });
      }
      for (const file of params.inputs) {
        const planned = await planInput(file, params, chosen);
        if (!isPlan(planned)) throw new RpcError('invalid-request', planned.message, { code: planned.code, file });
      }
      const outDir = params.outDir ?? deps.saveDirectory?.();
      if (outDir !== undefined) await ensureSaveDirectory(outDir);
      // 工具、权重包与（要缩放、插值时的）ffmpeg 在启动时就要能用：缺了直接拒绝并给补救，不建任务。
      let executor: { providerId: string; modelId: string };
      if (chosen) executor = { providerId: chosen.providerId, modelId: chosen.modelId };
      else if (spec.tool) {
        const tool = await deps.tool(spec.tool);
        const pack = spec.pack ? await deps.tool(spec.pack) : null;
        executor = { providerId: spec.tool, modelId: `${spec.weights}@${(pack ?? tool).version}` };
      } else executor = { providerId: 'ffmpeg', modelId: `lanczos@${await ffmpegOrReject(deps.ffmpeg)}` };
      if (spec.engine !== 'lanczos' && usesFfmpeg(params)) await ffmpegOrReject(deps.ffmpeg);
      const stats = await Promise.all(params.inputs.map((f) => fs.stat(f)));
      const frozen: FrozenUpscaleImageParams = {
        ...params,
        ...(chosen ? { provider: chosen.providerId, imageModel: chosen.modelId } : {}),
        ...(outDir !== undefined ? { outDir } : {}),
      };
      const identity = {
        inputs: params.inputs.map((file, i) => ({ file, size: stats[i]!.size, mtimeMs: stats[i]!.mtimeMs })),
        scale: params.scale,
        model: params.model,
        denoise: params.denoise ?? null,
        prompt: params.prompt ?? null,
        executor,
      };
      return { params: frozen, ...executor, videoId: null, contentHash: `sha256:${sha256Hex(canonicalJson(identity))}` };
    },
    steps: [
      {
        name: 'probe',
        label: () => J.stepProbe(),
        run: async ({ params, progress }) => {
          progress({ done: 0, total: params.inputs.length, unit: 'units' }, 'probing');
          const chosen = UPSCALE_IMAGE_MODEL_SPECS[params.model].engine === 'generative' ? await generativeTarget(deps, params) : null;
          const images: ImagePlan[] = [];
          for (const file of params.inputs) {
            const planned = await planInput(file, params, chosen);
            if (!isPlan(planned)) throw new PipelineStepError(planned.code, planned.message, { file });
            images.push(planned);
            progress({ done: images.length, total: params.inputs.length, unit: 'units' });
          }
          const stats = await Promise.all(params.inputs.map((f) => fs.stat(f)));
          const output: ProbeOutput = { images, stats: stats.map((s) => ({ size: s.size, mtimeMs: s.mtimeMs })) };
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
        name: 'upscale',
        label: () => J.stepUpscale(),
        resources: (params, outputs) => {
          const spec = UPSCALE_IMAGE_MODEL_SPECS[params.model];
          if (spec.engine === 'generative') {
            return params.provider && params.imageModel ? (deps.upscaler?.resources?.({ providerId: params.provider, modelId: params.imageModel }) ?? null) : null;
          }
          const largest = Math.max(...(outputs.probe as ProbeOutput).images.map((i) => i.width * i.height));
          const factor = upscalePeakScale(params.model, params.scale);
          return { demand: upscaleImageDemand(largest * factor * factor, spec.engine !== 'lanczos') };
        },
        run: (context) => upscale(deps, context),
        reusable: async (output) => {
          for (const { file } of (output as UpscaleOutput).files) if (!(await fs.stat(file).catch(() => null))) return false;
          return true;
        },
      },
      {
        name: 'verify',
        label: () => J.stepVerify(),
        run: async ({ params, outputs, progress }) => {
          progress(null, 'validating');
          const upscaled = outputs.upscale as UpscaleOutput;
          for (const item of upscaled.files) {
            const name = path.basename(item.source);
            const header = await readImageHeader(item.file).catch(() => null);
            if (!header) throw new PipelineStepError('EXPORT_VALIDATION_FAILED', J.outputMissing({ name }), { file: item.source });
            const expected = { width: item.width * params.scale, height: item.height * params.scale };
            if (header.mediaType !== 'image/png' || header.width !== expected.width || header.height !== expected.height) {
              throw new PipelineStepError(
                'EXPORT_VALIDATION_FAILED',
                J.outputSizeMismatch({ name, actual: `${header.width}×${header.height}`, expected: `${expected.width}×${expected.height}` }),
                { file: item.source },
              );
            }
          }
          return { output: {} };
        },
      },
      {
        name: 'publish',
        label: () => J.stepPublish(),
        run: async ({ params, outputs, signal, progress, jobId }) => {
          const upscaled = outputs.upscale as UpscaleOutput;
          progress(null, 'publishing');
          if (params.outDir !== undefined) await ensureSaveDirectoryForStep(params.outDir);
          const published: GeneratedOutput[] = [];
          for (const item of upscaled.files) {
            signal.throwIfAborted();
            const dir = params.outDir ?? path.dirname(item.source);
            const stem = `${path.parse(item.source).name}-upscaled-${params.scale}x`;
            const file = await publishFile(item.file, dir, stem, '.png', jobId, deps.hardLink ?? true);
            const { size, digest } = await digestFile(file);
            published.push({
              artifactId: `sha256:${digest}`,
              mediaType: 'image/png',
              byteLength: size,
              assetId: null,
              media: { kind: 'image', width: item.width * params.scale, height: item.height * params.scale },
              path: file,
            });
          }
          const output: PublishOutput = { outputs: published };
          return { output, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
        },
      },
    ],
    async complete({ params, outputs }) {
      const probed = outputs.probe as ProbeOutput;
      const upscaled = outputs.upscale as UpscaleOutput;
      const published = (outputs.publish as PublishOutput).outputs;
      const warnings = params.inputs.flatMap((file, i) => {
        const name = path.basename(file);
        const image = probed.images[i];
        const out: string[] = [];
        if ((image?.orientation ?? 1) !== 1) out.push(J.exifOrientation({ name }).text);
        // 出图里源图那一块不够目标尺寸：差的部分是插值。
        if (image?.model && Math.round((image.model.width * image.width) / image.model.padWidth) < image.width * params.scale) {
          out.push(J.generativeInterpolated({ name, size: image.model.size.replace('x', '×') }).text);
        }
        return out;
      });
      if (UPSCALE_IMAGE_MODEL_SPECS[params.model].engine === 'generative') warnings.unshift(J.generativeRedraws().text);
      const summary: UpscaleImageSummary = {
        model: params.model,
        scale: params.scale,
        executor: upscaled.executor,
        images: upscaled.files.map((item, i) => ({
          source: item.source,
          width: item.width,
          height: item.height,
          outWidth: item.width * params.scale,
          outHeight: item.height * params.scale,
          file: published[i]!.path!,
          modelSize: probed.images[i]?.model?.size ?? null,
        })),
        files: published.map((o) => o.path!),
        warnings,
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
    },
  };
}

export function parseUpscaleImageParams(raw: Record<string, unknown>): FrozenUpscaleImageParams {
  const reader = new ParamReader(raw, ['inputs', 'scale', 'model', 'denoise', 'provider', 'imageModel', 'prompt', 'outDir']);
  const inputs = reader.array('inputs', { min: 1, max: 50 })!;
  for (const input of inputs) {
    rejectUnresolvedEntry('inputs', input);
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw invalid('inputs', JobsParams.itemsMustBeAbsolutePaths());
  }
  const scale = (reader.int('scale', 2, 4) ?? 4) as UpscaleImageScale;
  const model = reader.oneOf('model', UPSCALE_IMAGE_MODELS) ?? 'photo';
  const spec = UPSCALE_IMAGE_MODEL_SPECS[model];
  const denoise = reader.int('denoise', -1, 3) as UpscaleImageDenoise | undefined;
  if (denoise !== undefined && !spec.denoise) throw invalid('denoise', J.denoiseUnsupported({ model }));
  const generative = {
    provider: reader.string('provider', { optional: true, max: 200 }),
    imageModel: reader.string('imageModel', { optional: true, max: 200 }),
    prompt: reader.string('prompt', { optional: true, max: UPSCALE_IMAGE_PROMPT_MAX }),
  };
  if (spec.engine !== 'generative') {
    for (const [key, value] of Object.entries(generative)) if (value !== undefined) throw invalid(key, J.generativeOnly({ model }));
  }
  const outDir = reader.string('outDir', { optional: true, max: 4096 });
  if (outDir !== undefined && !path.isAbsolute(outDir)) throw invalid('outDir', JobsParams.mustBeAbsolutePath());
  return {
    inputs: inputs as string[],
    scale,
    model,
    ...(spec.denoise ? { denoise: denoise ?? 0 } : {}),
    ...Object.fromEntries(Object.entries(generative).filter(([, value]) => value !== undefined)),
    ...(outDir !== undefined ? { outDir } : {}),
  };
}

/** 这次要不要 ffmpeg：插值、生成式放大的补边与缩放，或模型没有原生的这个倍数。 */
function usesFfmpeg(params: FrozenUpscaleImageParams): boolean {
  const engine = UPSCALE_IMAGE_MODEL_SPECS[params.model].engine;
  return engine === 'lanczos' || engine === 'generative' || upscaleNeedsResize(params.model, params.scale);
}

/** 执行时重新选定冻结的 Provider 与模型（拿它的尺寸表）。 */
async function generativeTarget(deps: UpscaleImageDeps, params: FrozenUpscaleImageParams) {
  if (!deps.upscaler) throw new PipelineStepError('UPSCALE_MODEL_UNSUPPORTED', J.generativeUnavailable());
  try {
    return await deps.upscaler.prepare({
      ...(params.provider !== undefined ? { provider: params.provider } : {}),
      ...(params.imageModel !== undefined ? { model: params.imageModel } : {}),
    });
  } catch (error) {
    if (error instanceof RpcError) {
      const details = (error.details ?? {}) as Record<string, unknown>;
      throw new PipelineStepError(typeof details.code === 'string' ? details.code : 'UPSCALE_MODEL_UNSUPPORTED', error.message, details);
    }
    throw error;
  }
}

/** 读一张输入、定它的计划；读不出、放大后超出上限、生成式放大出图不比源图大时给出错误码与说明。 */
async function planInput(
  file: string,
  params: FrozenUpscaleImageParams,
  chosen: { modelId: string; sizes: readonly string[] } | null,
): Promise<ImagePlan | { code: string; message: Localized }> {
  const header = await inspectInput(file);
  if (!isHeader(header)) return { code: 'INPUT_UNREADABLE', message: header };
  const problem = sizeProblem(file, header, params.scale);
  if (problem) return { code: 'UPSCALE_OUTPUT_TOO_LARGE', message: problem };
  const base = { width: header.width, height: header.height, orientation: header.orientation, model: null };
  if (!chosen) return base;
  const size = upscaleModelSize(chosen.sizes, header.width, header.height, params.scale);
  if (!size) return { code: 'UPSCALE_MODEL_UNSUPPORTED', message: J.modelNoSizes({ modelId: chosen.modelId }) };
  const pad = padPlan(header.width, header.height, size);
  // 出图里源图那一块的宽度不比源图大：重画也没有放大。
  if (Math.round((size.width * header.width) / pad.padWidth) <= header.width) {
    return { code: 'UPSCALE_MODEL_TOO_SMALL', message: J.modelTooSmall({ name: path.basename(file), modelId: chosen.modelId, size: size.size.replace('x', '×') }) };
  }
  return { ...base, model: { ...size, ...pad } };
}

const isPlan = (value: ImagePlan | { code: string; message: Localized }): value is ImagePlan => 'width' in value;

/** 读一张输入的文件头；不在、读不出或不是 PNG、JPEG、WebP 时给出说明。 */
async function inspectInput(file: string): Promise<ImageHeader | Localized> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return J.inputNotFound({ file });
  return (await readImageHeader(file).catch(() => null)) ?? J.inputUnsupported({ name: path.basename(file) });
}

const isHeader = (value: ImageHeader | Localized): value is ImageHeader => 'mediaType' in value;

/** 放大后超出每边上限时给出说明；没问题时 null。 */
function sizeProblem(file: string, header: ImageHeader, scale: UpscaleImageScale) {
  const width = header.width * scale;
  const height = header.height * scale;
  if (width <= MAX_OUTPUT_SIDE && height <= MAX_OUTPUT_SIDE) return null;
  return J.outputTooLarge({ name: path.basename(file), width, height, max: MAX_OUTPUT_SIDE });
}

/** ffmpeg 不能用时以 `conflict` 拒绝启动（同文件转码），带补救；能用时给出版本。 */
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

/** 用 ffmpeg 出一张 PNG：`filters` 是滤镜链。 */
async function ffmpegPng(ffmpeg: MediaToolResolver, input: string, output: string, filters: string, signal: AbortSignal): Promise<void> {
  await fs.rm(output, { force: true });
  await runFfmpeg(ffmpeg, ['-hide_banner', '-v', 'error', '-i', `file:${input}`, '-vf', filters, '-frames:v', '1', '-update', '1', '-y', `file:${output}`], { signal });
}

async function upscale(deps: UpscaleImageDeps, context: PipelineStepContext<FrozenUpscaleImageParams>): Promise<{ output: UpscaleOutput }> {
  const { params, outputs, signal, staging, progress, jobId } = context;
  const probed = outputs.probe as ProbeOutput;
  const spec = UPSCALE_IMAGE_MODEL_SPECS[params.model];
  const ffmpeg = usesFfmpeg(params) ? await ffmpegVersion(deps.ffmpeg) : null;
  const tool = spec.tool ? await deps.tool(spec.tool) : null;
  const pack = spec.pack ? await deps.tool(spec.pack) : null;
  const resize = ffmpeg && spec.engine !== 'lanczos' ? { tool: 'ffmpeg' as const, version: ffmpeg } : null;
  const executor: UpscaleImageSummary['executor'] = {
    engine: spec.engine,
    tool: spec.tool ?? (spec.engine === 'lanczos' ? 'ffmpeg' : null),
    version: tool?.version ?? (spec.engine === 'lanczos' ? ffmpeg : null),
    weights: spec.weights,
    denoise: spec.denoise ? (params.denoise ?? 0) : null,
    pack: pack ? { tool: UPSCAYL_MODELS, version: pack.version } : null,
    resize,
    model: spec.engine === 'generative' ? { providerId: params.provider!, modelId: params.imageModel! } : null,
  };
  const factor = upscalePeakScale(params.model, params.scale);
  const total = params.inputs.length;
  const files: UpscaleOutput['files'] = [];
  progress({ done: 0, total, unit: 'units' }, 'generating');
  for (const [index, input] of params.inputs.entries()) {
    const plan = probed.images[index]!;
    const { width, height } = plan;
    const name = path.basename(input);
    const out = path.join(staging, `upscaled-${index + 1}.png`);
    const target = `${width * params.scale}:${height * params.scale}`;
    if (spec.engine === 'lanczos') {
      await ffmpegPng(deps.ffmpeg, input, out, `scale=${target}:flags=lanczos`, signal);
    } else if (spec.engine === 'generative') {
      await generate(deps, { input, out, plan, index, target, params, jobId, staging, signal });
    } else {
      const raw = path.join(staging, `upscaled-${index + 1}${resize ? `-x${factor}` : ''}.png`);
      await fs.rm(raw, { force: true });
      const args =
        spec.engine === 'waifu2x'
          ? ['-i', input, '-o', raw, '-n', String(params.denoise ?? 0), '-s', String(factor), '-m', path.join(tool!.modelsDir ?? path.dirname(tool!.command), spec.weights!), '-f', 'png']
          : ['-i', input, '-o', raw, '-n', spec.weights!, '-s', String(factor), '-m', pack?.command ?? tool!.modelsDir ?? path.join(path.dirname(tool!.command), 'models'), '-f', 'png'];
      const run = await runTool(spec.tool!, tool!, args, signal, deps);
      if (run.code !== 0) {
        await fs.rm(raw, { force: true });
        const detail = lastLine(run.stderr) || `exit ${run.code}`;
        throw new PipelineStepError('UPSCALE_FAILED', J.upscaleFailed({ tool: toolLabel(spec.tool!), name, detail }), {
          file: input,
          exitCode: run.code,
          stderr: run.stderr.trim().slice(-1000),
        });
      }
      if (!(await fs.stat(raw).catch(() => null))) {
        throw new PipelineStepError('UPSCALE_FAILED', J.outputMissing({ name }), { file: input, stderr: run.stderr.trim().slice(-1000) });
      }
      if (resize) {
        await ffmpegPng(deps.ffmpeg, raw, out, `scale=${target}:flags=lanczos`, signal);
        await fs.rm(raw, { force: true });
      }
    }
    files.push({ file: out, source: input, width, height });
    progress({ done: index + 1, total, unit: 'units' });
  }
  return { output: { files, executor } };
}

/** 生成式放大一张图：要补边时先补到模型的比例，模型出图之后裁回源图那一块，再缩放到目标尺寸。 */
async function generate(
  deps: UpscaleImageDeps,
  job: {
    input: string;
    out: string;
    plan: ImagePlan;
    index: number;
    target: string;
    params: FrozenUpscaleImageParams;
    jobId: Id;
    staging: string;
    signal: AbortSignal;
  },
): Promise<void> {
  const { plan, params, signal } = job;
  const model = plan.model!;
  const padded = model.padWidth !== plan.width || model.padHeight !== plan.height;
  let image = job.input;
  if (padded) {
    image = path.join(job.staging, `padded-${job.index + 1}.png`);
    await ffmpegPng(deps.ffmpeg, job.input, image, `pad=${model.padWidth}:${model.padHeight}:${model.x}:${model.y}:color=black`, signal);
  }
  const prompt = [GENERATIVE_PROMPT, padded ? GENERATIVE_PADDED : null, params.prompt?.trim() ? `Additional guidance: ${params.prompt.trim()}` : null]
    .filter(Boolean)
    .join('\n\n');
  const generated = await deps.upscaler!.upscale({
    providerId: params.provider!,
    modelId: params.imageModel!,
    image,
    prompt,
    size: model.size,
    jobId: job.jobId,
    staging: job.staging,
    signal,
  });
  // 按实际出图的尺寸裁：模型不一定正好按请求的尺寸出图。
  const header = await readImageHeader(generated.file).catch(() => null);
  if (!header) throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.outputMissing({ name: path.basename(job.input) }), { file: job.input });
  const crop = padded
    ? (() => {
        const cw = Math.max(1, Math.round((header.width * plan.width) / model.padWidth));
        const ch = Math.max(1, Math.round((header.height * plan.height) / model.padHeight));
        const cx = Math.min(header.width - cw, Math.round((model.x * header.width) / model.padWidth));
        const cy = Math.min(header.height - ch, Math.round((model.y * header.height) / model.padHeight));
        return `crop=${cw}:${ch}:${cx}:${cy},`;
      })()
    : '';
  await ffmpegPng(deps.ffmpeg, generated.file, job.out, `${crop}scale=${job.target}:flags=lanczos`, signal);
  await fs.rm(generated.file, { force: true });
  if (padded) await fs.rm(image, { force: true });
}

/** 工具给人看的名字（错误信息里用）。 */
function toolLabel(name: string): string {
  return name === WAIFU2X ? 'waifu2x' : name === REALESRGAN ? 'Real-ESRGAN' : name;
}

function lastLine(text: string): string {
  return (
    text
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^\d+(\.\d+)?%$/.test(l))
      .at(-1) ?? ''
  ).slice(0, 300);
}

/** 起一次工具，等它退出。中止时结束整棵进程树（先 SIGTERM，宽限之后 SIGKILL），等它退出再抛。 */
async function runTool(
  name: string,
  tool: UpscaleTool,
  args: string[],
  signal: AbortSignal,
  options: { spawn?: SpawnProcess; platform?: NodeJS.Platform },
): Promise<{ code: number | null; stderr: string }> {
  signal.throwIfAborted();
  const platform = options.platform ?? process.platform;
  const run = options.spawn ?? spawn;
  return await new Promise((resolve, reject) => {
    const child: ChildProcess = run(tool.command, [...(tool.args ?? []), ...args], {
      env: tool.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: platform !== 'win32',
      windowsHide: true,
    });
    let stderr = '';
    let killTimer: NodeJS.Timeout | null = null;
    const kill = (sig: NodeJS.Signals) => killProcessTree(child, sig, { platform, spawn: run });
    const onAbort = () => {
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      signal.removeEventListener('abort', onAbort);
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        reject(new PipelineStepError('TOOL_NOT_INSTALLED', J.toolNotFound({ tool: toolLabel(name), code: error.code }), { tool: name }));
      } else reject(error);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      if (signal.aborted) reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      else resolve({ code, stderr });
    });
  });
}

async function digestFile(file: string): Promise<{ size: number; digest: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, digest: hash.digest('hex') };
}
