import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { killProcessTree, type SpawnProcess } from '@baocut/process-host';
import {
  RpcError,
  UPSCALE_IMAGE_MODELS,
  type GeneratedOutput,
  type Localized,
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
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep } from './save-location.ts';
import { publishFile } from './transcode.ts';

/**
 * 图片超分（架构设计 §7.9；技术方案 §4.1）：文件到文件，不建视频，由受管外部工具 Real-ESRGAN（ncnn 版，`realesrgan-ncnn-vulkan`）
 * 在本机 GPU 上执行（Vulkan；macOS 经 MoltenVK 跑 Metal）。
 *
 * 步骤：读取（文件头里的格式、尺寸与 EXIF 方向；输出每边不超过 `MAX_OUTPUT_SIDE`）→ 放大（每张图起一次工具，写进 staging；
 * `photo` 的 2、3 倍先放大 4 倍再由 ffmpeg 用 Lanczos 缩到目标尺寸）→ 校验（输出是 PNG，尺寸正好是源尺寸乘倍数）→ 发布
 * （`<源文件名>-upscaled-<倍数>x.png`，不覆盖已有的文件）。
 *
 * - 工具按块推理并拼回（ncnn 按显存自选块大小），透明通道由它另行放大；EXIF 方向不转正（像素原样放大），带方向标记的源图在摘要里提醒。
 * - 超分是更高分辨率的估计，不能找回压缩或失焦丢掉的真实细节；文字、界面截图可能被「画」出不存在的笔画。
 */

export const UPSCALE_IMAGE_PIPELINE = 'upscale-image';

/** 输出每边的上限（像素）：再大 PNG 编码与查看都不现实，也超出常见图片软件的上限。 */
export const MAX_OUTPUT_SIDE = 16384;

/** 两种模型对应的权重与它原生支持的倍数（ncnn 发布包 `models/` 里的名字）。 */
export const UPSCALE_WEIGHTS: Readonly<Record<UpscaleImageModel, { weights: string; native: readonly UpscaleImageScale[] }>> = {
  photo: { weights: 'realesrgan-x4plus', native: [4] },
  anime: { weights: 'realesr-animevideov3', native: [2, 3, 4] },
};

const KILL_GRACE_MS = 2000;
const STDERR_TAIL = 4000;

/** 解析好、能用的 Real-ESRGAN：可执行文件与版本（受管副本是发布版本）。 */
export interface UpscaleTool {
  command: string;
  version: string;
  /** 用解释器运行脚本时的固定参数（测试的假工具）；不经 shell。 */
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** 权重目录；不给时是可执行文件旁边的 `models/`（发布包的布局）。 */
  modelsDir?: string;
}

export interface UpscaleImageDeps {
  /** 解析工具：没装、不能运行时抛 `RpcError('conflict')`（`TOOL_NOT_INSTALLED` 等，带补救）。 */
  tool: () => Promise<UpscaleTool>;
  /** `photo` 的 2、3 倍缩小用。 */
  ffmpeg: MediaToolResolver;
  /** 不给 `outDir` 时的保存位置（§7.9「保存位置」）；没有接线时写在源文件旁边。 */
  saveDirectory?: () => string;
  /** 同 `TranscodeDeps.hardLink`。 */
  hardLink?: boolean;
  spawn?: SpawnProcess;
  platform?: NodeJS.Platform;
}

/** 冻结的参数：默认值已经补上。 */
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
      enum: ['photo', 'anime'],
      default: 'photo',
      description: 'photo：照片与写实画面（realesrgan-x4plus，2、3 倍要 ffmpeg 缩小）；anime：动画、插画与线稿（realesr-animevideov3）',
    },
    outDir: { type: 'string', description: '输出目录的绝对路径（不存在时创建）；不给时是保存位置（设置 downloads.directory，默认主机的下载文件夹）' },
    // i18n-ignore-end
  },
  required: ['inputs'],
  additionalProperties: false,
};

interface ProbeOutput extends Record<string, unknown> {
  images: Array<{ width: number; height: number; orientation: number | null }>;
  stats: Array<{ size: number; mtimeMs: number }>;
}

interface UpscaleOutput extends Record<string, unknown> {
  files: Array<{ file: string; source: string; width: number; height: number }>;
  version: string;
  resize: { tool: 'ffmpeg'; version: string } | null;
}

interface PublishOutput extends Record<string, unknown> {
  outputs: GeneratedOutput[];
}

/** 这次要不要 ffmpeg 缩小：模型没有原生的这个倍数。 */
export function needsResize(model: UpscaleImageModel, scale: UpscaleImageScale): boolean {
  return !UPSCALE_WEIGHTS[model].native.includes(scale);
}

/** 交给工具的倍数：原生支持的就是它，否则 4 倍（之后缩小）。 */
function nativeScale(model: UpscaleImageModel, scale: UpscaleImageScale): UpscaleImageScale {
  return needsResize(model, scale) ? 4 : scale;
}

export function upscaleImagePipeline(deps: UpscaleImageDeps): PipelineDefinition<FrozenUpscaleImageParams> {
  return {
    name: UPSCALE_IMAGE_PIPELINE,
    label: () => J.label(),
    description: () => J.description(),
    paramsSchema: PARAMS_SCHEMA,
    parse: parseUpscaleImageParams,
    async prepare(params) {
      for (const file of params.inputs) {
        const header = await inspectInput(file);
        if (!isHeader(header)) throw new RpcError('invalid-request', header, { code: 'INPUT_UNREADABLE', file });
        const problem = sizeProblem(file, header, params.scale);
        if (problem) throw new RpcError('invalid-request', problem, { code: 'UPSCALE_OUTPUT_TOO_LARGE', file });
      }
      const outDir = params.outDir ?? deps.saveDirectory?.();
      if (outDir !== undefined) await ensureSaveDirectory(outDir);
      // 工具与（要缩小时的）ffmpeg 在启动时就要能用：缺了直接拒绝并给补救，不建任务。
      const tool = await deps.tool();
      if (needsResize(params.model, params.scale)) await ffmpegOrReject(deps.ffmpeg);
      const stats = await Promise.all(params.inputs.map((f) => fs.stat(f)));
      const identity = {
        inputs: params.inputs.map((file, i) => ({ file, size: stats[i]!.size, mtimeMs: stats[i]!.mtimeMs })),
        scale: params.scale,
        model: params.model,
      };
      return {
        params: outDir !== undefined ? { ...params, outDir } : params,
        providerId: 'realesrgan-ncnn-vulkan',
        modelId: `${UPSCALE_WEIGHTS[params.model].weights}@${tool.version}`,
        videoId: null,
        contentHash: `sha256:${sha256Hex(canonicalJson(identity))}`,
      };
    },
    steps: [
      {
        name: 'probe',
        label: () => J.stepProbe(),
        run: async ({ params, progress }) => {
          progress({ done: 0, total: params.inputs.length, unit: 'units' }, 'probing');
          const images: ProbeOutput['images'] = [];
          for (const file of params.inputs) {
            const header = await inspectInput(file);
            if (!isHeader(header)) throw new PipelineStepError('INPUT_UNREADABLE', header, { file });
            const problem = sizeProblem(file, header, params.scale);
            if (problem) throw new PipelineStepError('UPSCALE_OUTPUT_TOO_LARGE', problem, { file });
            images.push({ width: header.width, height: header.height, orientation: header.orientation });
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
          const largest = Math.max(...(outputs.probe as ProbeOutput).images.map((i) => i.width * i.height));
          const factor = nativeScale(params.model, params.scale);
          return { demand: upscaleImageDemand(largest * factor * factor) };
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
      const warnings = params.inputs.flatMap((file, i) =>
        (probed.images[i]?.orientation ?? 1) !== 1 ? [J.exifOrientation({ name: path.basename(file) }).text] : [],
      );
      const summary: UpscaleImageSummary = {
        model: params.model,
        scale: params.scale,
        executor: { tool: 'realesrgan-ncnn-vulkan', version: upscaled.version, weights: UPSCALE_WEIGHTS[params.model].weights, resize: upscaled.resize },
        images: upscaled.files.map((item, i) => ({
          source: item.source,
          width: item.width,
          height: item.height,
          outWidth: item.width * params.scale,
          outHeight: item.height * params.scale,
          file: published[i]!.path!,
        })),
        files: published.map((o) => o.path!),
        warnings,
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
    },
  };
}

export function parseUpscaleImageParams(raw: Record<string, unknown>): FrozenUpscaleImageParams {
  const reader = new ParamReader(raw, ['inputs', 'scale', 'model', 'outDir']);
  const inputs = reader.array('inputs', { min: 1, max: 50 })!;
  for (const input of inputs) {
    rejectUnresolvedEntry('inputs', input);
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw invalid('inputs', JobsParams.itemsMustBeAbsolutePaths());
  }
  const scale = (reader.int('scale', 2, 4) ?? 4) as UpscaleImageScale;
  const model = reader.oneOf('model', UPSCALE_IMAGE_MODELS) ?? 'photo';
  const outDir = reader.string('outDir', { optional: true, max: 4096 });
  if (outDir !== undefined && !path.isAbsolute(outDir)) throw invalid('outDir', JobsParams.mustBeAbsolutePath());
  return { inputs: inputs as string[], scale, model, ...(outDir !== undefined ? { outDir } : {}) };
}

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

/** ffmpeg 不能用时以 `conflict` 拒绝启动（同文件转码），带补救。 */
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

async function upscale(deps: UpscaleImageDeps, context: PipelineStepContext<FrozenUpscaleImageParams>): Promise<{ output: UpscaleOutput }> {
  const { params, outputs, signal, staging, progress } = context;
  const probed = outputs.probe as ProbeOutput;
  const tool = await deps.tool();
  const resize = needsResize(params.model, params.scale) ? { tool: 'ffmpeg' as const, version: await ffmpegVersion(deps.ffmpeg) } : null;
  const factor = nativeScale(params.model, params.scale);
  const modelsDir = tool.modelsDir ?? path.join(path.dirname(tool.command), 'models');
  const total = params.inputs.length;
  const files: UpscaleOutput['files'] = [];
  progress({ done: 0, total, unit: 'units' }, 'generating');
  for (const [index, input] of params.inputs.entries()) {
    const { width, height } = probed.images[index]!;
    const name = path.basename(input);
    const raw = path.join(staging, `upscaled-${index + 1}${resize ? '-x4' : ''}.png`);
    const out = path.join(staging, `upscaled-${index + 1}.png`);
    await fs.rm(raw, { force: true });
    const args = ['-i', input, '-o', raw, '-n', UPSCALE_WEIGHTS[params.model].weights, '-s', String(factor), '-m', modelsDir, '-f', 'png'];
    const run = await runTool(tool, args, signal, deps);
    if (run.code !== 0) {
      await fs.rm(raw, { force: true });
      const detail = lastLine(run.stderr) || `exit ${run.code}`;
      throw new PipelineStepError('UPSCALE_FAILED', J.upscaleFailed({ name, detail }), { file: input, exitCode: run.code, stderr: run.stderr.trim().slice(-1000) });
    }
    if (!(await fs.stat(raw).catch(() => null))) {
      throw new PipelineStepError('UPSCALE_FAILED', J.outputMissing({ name }), { file: input, stderr: run.stderr.trim().slice(-1000) });
    }
    if (resize) {
      const target = `${width * params.scale}:${height * params.scale}`;
      await fs.rm(out, { force: true });
      await runFfmpeg(
        deps.ffmpeg,
        ['-hide_banner', '-v', 'error', '-i', `file:${raw}`, '-vf', `scale=${target}:flags=lanczos`, '-frames:v', '1', '-update', '1', '-y', `file:${out}`],
        { signal },
      );
      await fs.rm(raw, { force: true });
    }
    files.push({ file: out, source: input, width, height });
    progress({ done: index + 1, total, unit: 'units' });
  }
  return { output: { files, version: tool.version, resize } };
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
        reject(new PipelineStepError('TOOL_NOT_INSTALLED', J.toolNotFound({ code: error.code }), { tool: 'realesrgan-ncnn-vulkan' }));
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
