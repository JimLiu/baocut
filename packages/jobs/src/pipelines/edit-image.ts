import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EDIT_IMAGE_ANCHORS,
  EDIT_IMAGE_METHODS,
  RpcError,
  type EditImageExpand,
  type EditImageMask,
  type EditImageMethod,
  type EditImageOp,
  type EditImageParams,
  type EditImageSummary,
  type GeneratedOutput,
  type Id,
  type Localized,
} from '@baocut/protocol';
import { JobsEditImage as J } from '@baocut/protocol/messages/jobs/edit-image.ts';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { fileInputSchema, rejectUnresolvedEntry } from './entry-input.ts';
import { ffmpegVersion, runFfmpeg, type MediaToolResolver } from './ffmpeg.ts';
import { readImageHeader, type ImageHeader } from './image-header.ts';
import {
  EXPAND_MAX_SIDE,
  MAX_MASK_COVERAGE,
  encodeGrayPng,
  expandMask,
  expandPlan,
  maskStats,
  parseRatio,
  rasterizeMask,
  scaleMask,
  workArea,
  type ExpandPlan,
  type Rect,
} from './image-mask.ts';
import { ParamReader, invalid } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext, type StepResources } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep } from './save-location.ts';
import { publishFile } from './transcode.ts';

/**
 * 图片编辑（架构设计 §7.9）：去除物体（`remove-object`）、去水印（`remove-watermark`）、重绘局部（`repaint-image`）与扩展画面
 * （`expand-image`）是同一套步骤的四个流程，文件到文件，输出 PNG，不建视频、不动原文件。
 *
 * 步骤：读取（文件头里的尺寸；选区换算到每张图、栅格化，按覆盖率与新画布的大小拒绝）→ 准备选区（遮罩写进 staging）→ 修改 →
 * 校验（PNG，尺寸是源图或新画布的）→ 发布（`<源文件名>-erased|no-watermark|repainted|expanded.png`，不覆盖已有的文件）。
 *
 * 两种补法：
 * - `fill`：本机 ffmpeg 的 `removelogo` 按选区四周的像素往里填，不用模型，几秒钟；适合小块的文字、角标与字幕条；
 * - `model`：能按提示词改图的图像模型（`referenceImages.edit`，由 `ImageEditor` 调用，授权与预算同生成图片）。只送选区周围的一块
 *   （外框四周各留一半上下文、每边至少 512，图更小时整张；长边超过 1536 时缩小再送），选区涂成纯品红色并在提示词里说明；扩图送
 *   整张新画布，新增的部分涂成品红。
 *
 * 贴回时只取选区（向外扩 12 像素、高斯羽化），选区之外的像素保持原图；扩图只取新增的部分（向原图里让 12 像素羽化相接），原图
 * 那一块原样保留。EXIF 方向不转正：选区按存储的像素读（同图片超分），带方向标记的源图在摘要里提醒。
 */

export type EditImagePipelineName = 'remove-object' | 'remove-watermark' | 'repaint-image' | 'expand-image';

export const EDIT_IMAGE_PIPELINES: Readonly<Record<EditImageOp, EditImagePipelineName>> = {
  erase: 'remove-object',
  watermark: 'remove-watermark',
  repaint: 'repaint-image',
  expand: 'expand-image',
};

/** 每个流程收的补法（第一个是默认）、选区、提示词与张数。 */
const OPS: Readonly<
  Record<EditImageOp, { methods: readonly EditImageMethod[]; mask: boolean; prompt: 'none' | 'required' | 'optional'; maxInputs: number; suffix: string }>
> = {
  erase: { methods: ['model', 'fill'], mask: true, prompt: 'none', maxInputs: 1, suffix: 'erased' },
  watermark: { methods: ['fill', 'model'], mask: true, prompt: 'none', maxInputs: 50, suffix: 'no-watermark' },
  repaint: { methods: ['model'], mask: true, prompt: 'required', maxInputs: 1, suffix: 'repainted' },
  expand: { methods: ['model'], mask: false, prompt: 'optional', maxInputs: 1, suffix: 'expanded' },
};

/** 选区向外扩（像素）与羽化的高斯 sigma：扩出三个 sigma，选区里面贴回的是完整的修改。 */
const FEATHER_SIGMA = 4;
const FEATHER_GROW = 3 * FEATHER_SIGMA;
/** 送给模型的图长边的上限（像素）：再大多数服务按字节拒绝，回来的也不会更清楚。 */
export const SEND_MAX_SIDE = 1536;
/** 涂在选区上的标记色（提示词里同一个）。 */
const MARK_COLOR = '0xFF00FF';
const PROMPT_MAX = 2000;

/**
 * 能按提示词改图的图像模型的调用者（Runtime 接线，同配音的 `DubSpeech`）：选择、参数检查、输入图冻结与授权都在那边。
 */
export interface ImageEditor {
  /** 启动（与重试）时：选定 Provider 与模型；模型不能按提示词改图时抛 `RpcError('invalid-request')`（`IMAGE_EDIT_UNSUPPORTED`）。 */
  prepare(target: { provider?: string; model?: string }): Promise<{ providerId: string; modelId: string }>;
  /** 改图这一步的峰值需求与执行队列：本机模型包要先占它的 Model Worker、与它的其他任务排队；在线与节点的 null。 */
  resources?(target: { providerId: string; modelId: string }): StepResources | null;
  /** 改一张图，输出写在 `staging` 里；`width`×`height` 是想要的比例（模型按自己支持的尺寸出图，流程再缩放回去）。 */
  edit(request: {
    providerId: string;
    modelId: string;
    image: string;
    prompt: string;
    width: number;
    height: number;
    jobId: Id;
    staging: string;
    signal: AbortSignal;
  }): Promise<{ file: string }>;
}

export interface EditImageDeps {
  ffmpeg: MediaToolResolver;
  /** `model` 补法的执行者；没有接线时只能 `fill`。 */
  editor?: ImageEditor;
  /** 不给 `outDir` 时的保存位置；没有接线时写在源文件旁边。 */
  saveDirectory?: () => string;
  /** 同 `TranscodeDeps.hardLink`。 */
  hardLink?: boolean;
}

/** 冻结的参数：补法定了；`model` 补法补上选定的 Provider 与模型。 */
export interface FrozenEditImageParams extends EditImageParams {
  method: EditImageMethod;
}

/** 一张图的计划：读取这一步算好，之后的步骤照用。 */
interface ImagePlan {
  width: number;
  height: number;
  orientation: number | null;
  outWidth: number;
  outHeight: number;
  /** 选区占画面的比例；扩图是新增部分占新画布的比例。 */
  coverage: number;
  /** 送去修补的一块（原图像素；扩图是整张新画布）；`fill` 时 null。 */
  region: Rect | null;
  /** 这张图的选区（批量时已换算）；扩图 null。 */
  mask: EditImageMask | null;
  expand: ExpandPlan | null;
}

interface ProbeOutput extends Record<string, unknown> {
  images: ImagePlan[];
  stats: Array<{ size: number; mtimeMs: number }>;
}

interface MaskOutput extends Record<string, unknown> {
  /** 每张图：标记用的遮罩（`model`：工作区大小；`fill`：整张）与贴回用的遮罩。 */
  files: Array<{ mark: string; blend: string }>;
}

interface EditOutput extends Record<string, unknown> {
  files: Array<{ file: string; source: string }>;
  version: string;
}

interface PublishOutput extends Record<string, unknown> {
  outputs: GeneratedOutput[];
}

function paramsSchema(op: EditImageOp): Record<string, unknown> {
  const o = OPS[op];
  // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
  const properties: Record<string, unknown> = {
    inputs: {
      type: 'array',
      items: fileInputSchema('输入图片的绝对路径（PNG、JPEG、WebP）', 'Space 里的图片条目'),
      minItems: 1,
      maxItems: o.maxInputs,
      ...(o.maxInputs > 1 ? { description: '同一组框用于每一张：框按第一张的像素记，别的图按宽高的比例换算' } : {}),
    },
  };
  if (o.mask) {
    properties.mask = {
      type: 'object',
      description: '选区（原图像素，左上角为原点）：框与笔画的并集。至少一个框或一笔；占画面超过六成时拒绝',
      properties: {
        boxes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false,
          },
        },
        strokes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              radius: { type: 'number', description: '笔刷半径（像素）' },
              points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 1 },
            },
            required: ['radius', 'points'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };
  }
  if (o.methods.length > 1) {
    properties.method = {
      type: 'string',
      enum: o.methods,
      default: o.methods[0],
      description: 'fill：本机 ffmpeg 按四周像素填充，不用模型，适合小块文字与角标；model：能改图的图像模型重画，适合大块物体与复杂背景',
    };
  }
  if (o.prompt !== 'none') {
    properties.prompt = {
      type: 'string',
      maxLength: PROMPT_MAX,
      description: op === 'repaint' ? '选区改成什么（必填）' : '新增的部分画什么（可选；不写时接着原图的场景往外画）',
    };
  }
  if (op === 'expand') {
    properties.expand = {
      type: 'object',
      description: `新画布：ratio（W:H，只往缺的方向加、按 anchor 放原图）或 margins（四边各加多少像素）二选一；每边至多 ${EXPAND_MAX_SIDE}`,
      properties: {
        ratio: { type: 'string', description: '如 16:9、9:16、1:1' },
        anchor: { type: 'string', enum: EDIT_IMAGE_ANCHORS, default: 'center' },
        margins: {
          type: 'object',
          properties: { left: { type: 'integer' }, top: { type: 'integer' }, right: { type: 'integer' }, bottom: { type: 'integer' } },
          required: ['left', 'top', 'right', 'bottom'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    };
  }
  properties.provider = { type: 'string', description: 'model 补法用的生图 Provider（同 models.generateImage）；不给时用生图的默认' };
  properties.model = { type: 'string', description: 'model 补法用的模型；要能按提示词改图' };
  properties.outDir = { type: 'string', description: '输出目录的绝对路径（不存在时创建）；不给时是保存位置（设置 downloads.directory）' };
  // i18n-ignore-end
  return { type: 'object', properties, required: op === 'expand' ? ['inputs', 'expand'] : ['inputs', 'mask'], additionalProperties: false };
}

const LABELS: Readonly<Record<EditImageOp, { label: () => Localized; description: () => Localized }>> = {
  erase: { label: () => J.eraseLabel(), description: () => J.eraseDescription() },
  watermark: { label: () => J.watermarkLabel(), description: () => J.watermarkDescription() },
  repaint: { label: () => J.repaintLabel(), description: () => J.repaintDescription() },
  expand: { label: () => J.expandLabel(), description: () => J.expandDescription() },
};

export function editImagePipeline(op: EditImageOp, deps: EditImageDeps): PipelineDefinition<FrozenEditImageParams, EditImageParams> {
  return {
    name: EDIT_IMAGE_PIPELINES[op],
    label: LABELS[op].label,
    description: LABELS[op].description,
    paramsSchema: paramsSchema(op),
    parse: (raw) => parseEditImageParams(op, raw),
    async prepare(raw) {
      const method = raw.method ?? OPS[op].methods[0]!;
      for (const file of raw.inputs) {
        const planned = await planInput(op, method, file, raw);
        if (planned.problem) throw new RpcError('invalid-request', planned.problem.message, { code: planned.problem.code, file });
      }
      const outDir = raw.outDir ?? deps.saveDirectory?.();
      if (outDir !== undefined) await ensureSaveDirectory(outDir);
      const ffmpeg = await ffmpegOrReject(deps.ffmpeg);
      let executor = { providerId: 'ffmpeg', modelId: `removelogo@${ffmpeg}` };
      if (method === 'model') {
        if (!deps.editor) throw new RpcError('invalid-request', J.methodUnsupported({ method }), { code: 'IMAGE_EDIT_UNSUPPORTED' });
        executor = await deps.editor.prepare({
          ...(raw.provider !== undefined ? { provider: raw.provider } : {}),
          ...(raw.model !== undefined ? { model: raw.model } : {}),
        });
      }
      const stats = await Promise.all(raw.inputs.map((f) => fs.stat(f)));
      const params: FrozenEditImageParams = {
        ...raw,
        method,
        ...(method === 'model' ? { provider: executor.providerId, model: executor.modelId } : {}),
        ...(outDir !== undefined ? { outDir } : {}),
      };
      const identity = {
        op,
        inputs: raw.inputs.map((file, i) => ({ file, size: stats[i]!.size, mtimeMs: stats[i]!.mtimeMs })),
        mask: raw.mask ?? null,
        method,
        prompt: raw.prompt ?? null,
        expand: raw.expand ?? null,
        executor,
      };
      return { params, ...executor, videoId: null, contentHash: `sha256:${sha256Hex(canonicalJson(identity))}` };
    },
    steps: [
      {
        name: 'probe',
        label: () => J.stepProbe(),
        run: async ({ params, progress }) => {
          progress({ done: 0, total: params.inputs.length, unit: 'units' }, 'probing');
          const images: ImagePlan[] = [];
          for (const file of params.inputs) {
            const planned = await planInput(op, params.method, file, params);
            if (planned.problem) throw new PipelineStepError(planned.problem.code, planned.problem.message, { file });
            images.push(planned.plan);
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
        name: 'mask',
        label: () => J.stepMask(),
        run: async ({ params, outputs, staging }) => {
          const { images } = outputs.probe as ProbeOutput;
          const files: MaskOutput['files'] = [];
          for (const [index, plan] of images.entries()) {
            const mark = path.join(staging, `mark-${index + 1}.png`);
            const blend = path.join(staging, `blend-${index + 1}.png`);
            if (plan.expand) {
              const { width, height } = plan.expand;
              await fs.writeFile(mark, encodeGrayPng(expandMask(plan.expand, plan, 0), width, height));
              await fs.writeFile(blend, encodeGrayPng(expandMask(plan.expand, plan, FEATHER_GROW), width, height));
            } else {
              // `fill` 的遮罩是整张图（removelogo 要与输入同样大）；`model` 的是工作区那一块。
              const area = params.method === 'model' ? plan.region! : { x: 0, y: 0, width: plan.width, height: plan.height };
              const origin = { x: area.x, y: area.y };
              await fs.writeFile(mark, encodeGrayPng(rasterizeMask(plan.mask!, area.width, area.height, { origin, grow: 2 }), area.width, area.height));
              await fs.writeFile(blend, encodeGrayPng(rasterizeMask(plan.mask!, area.width, area.height, { origin, grow: FEATHER_GROW }), area.width, area.height));
            }
            files.push({ mark, blend });
          }
          const output: MaskOutput = { files };
          return { output };
        },
        reusable: async (output) => {
          for (const { mark, blend } of (output as MaskOutput).files) {
            if (!(await fs.stat(mark).catch(() => null)) || !(await fs.stat(blend).catch(() => null))) return false;
          }
          return true;
        },
      },
      {
        name: 'edit',
        label: () => J.stepEdit(),
        resources: (params) =>
          params.method === 'model' && params.provider && params.model ? (deps.editor?.resources?.({ providerId: params.provider, modelId: params.model }) ?? null) : null,
        run: (context) => edit(op, deps, context),
        reusable: async (output) => {
          for (const { file } of (output as EditOutput).files) if (!(await fs.stat(file).catch(() => null))) return false;
          return true;
        },
      },
      {
        name: 'verify',
        label: () => J.stepVerify(),
        run: async ({ outputs, progress }) => {
          progress(null, 'validating');
          const { images } = outputs.probe as ProbeOutput;
          for (const [i, item] of (outputs.edit as EditOutput).files.entries()) {
            const name = path.basename(item.source);
            const header = await readImageHeader(item.file).catch(() => null);
            if (!header) throw new PipelineStepError('EXPORT_VALIDATION_FAILED', J.outputMissing({ name }), { file: item.source });
            const plan = images[i]!;
            if (header.mediaType !== 'image/png' || header.width !== plan.outWidth || header.height !== plan.outHeight) {
              throw new PipelineStepError(
                'EXPORT_VALIDATION_FAILED',
                J.outputSizeMismatch({ name, actual: `${header.width}×${header.height}`, expected: `${plan.outWidth}×${plan.outHeight}` }),
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
          const { images } = outputs.probe as ProbeOutput;
          progress(null, 'publishing');
          if (params.outDir !== undefined) await ensureSaveDirectoryForStep(params.outDir);
          const published: GeneratedOutput[] = [];
          for (const [i, item] of (outputs.edit as EditOutput).files.entries()) {
            signal.throwIfAborted();
            const dir = params.outDir ?? path.dirname(item.source);
            const stem = `${path.parse(item.source).name}-${OPS[op].suffix}`;
            const file = await publishFile(item.file, dir, stem, '.png', jobId, deps.hardLink ?? true);
            const { size, digest } = await digestFile(file);
            published.push({
              artifactId: `sha256:${digest}`,
              mediaType: 'image/png',
              byteLength: size,
              assetId: null,
              media: { kind: 'image', width: images[i]!.outWidth, height: images[i]!.outHeight },
              path: file,
            });
          }
          const output: PublishOutput = { outputs: published };
          return { output, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
        },
      },
    ],
    async complete({ params, outputs }) {
      const { images } = outputs.probe as ProbeOutput;
      const edited = outputs.edit as EditOutput;
      const published = (outputs.publish as PublishOutput).outputs;
      const warnings: string[] = [];
      for (const [i, file] of params.inputs.entries()) {
        const plan = images[i]!;
        const name = path.basename(file);
        if (plan.expand && staged(plan, plan.expand)) warnings.push(J.expandStaged({ name }).text);
      }
      const summary: EditImageSummary = {
        op,
        method: params.method,
        executor: {
          tool: 'ffmpeg',
          version: edited.version,
          providerId: params.method === 'model' ? (params.provider ?? null) : null,
          modelId: params.method === 'model' ? (params.model ?? null) : null,
        },
        images: images.map((plan, i) => ({
          source: params.inputs[i]!,
          width: plan.width,
          height: plan.height,
          outWidth: plan.outWidth,
          outHeight: plan.outHeight,
          coverage: Math.round(plan.coverage * 1000) / 1000,
          region: plan.region,
          file: published[i]!.path!,
        })),
        files: published.map((o) => o.path!),
        warnings,
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: published[0]!.artifactId, outputs: published } };
    },
  };
}

/* ---------- 参数 ---------- */

export function parseEditImageParams(op: EditImageOp, raw: Record<string, unknown>): EditImageParams {
  const o = OPS[op];
  const reader = new ParamReader(raw, ['inputs', 'mask', 'method', 'prompt', 'expand', 'provider', 'model', 'outDir']);
  const inputs = reader.array('inputs', { min: 1, max: o.maxInputs })!;
  for (const input of inputs) {
    rejectUnresolvedEntry('inputs', input);
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw invalid('inputs', JobsParams.itemsMustBeAbsolutePaths());
  }
  const method = reader.oneOf('method', EDIT_IMAGE_METHODS);
  if (method !== undefined && !o.methods.includes(method)) throw new RpcError('invalid-request', J.methodUnsupported({ method }));
  let mask: EditImageMask | undefined;
  if (o.mask) {
    if (raw.mask === undefined) throw new RpcError('invalid-request', J.maskRequired());
    mask = parseMask(raw.mask);
  } else if (raw.mask !== undefined) throw new RpcError('invalid-request', J.maskNotAccepted());
  const prompt = reader.string('prompt', { optional: true, max: PROMPT_MAX });
  if (o.prompt === 'none' && prompt !== undefined) throw new RpcError('invalid-request', J.promptNotAccepted());
  if (o.prompt === 'required' && prompt === undefined) throw new RpcError('invalid-request', J.promptRequired());
  let expand: EditImageExpand | undefined;
  if (op === 'expand') {
    if (raw.expand === undefined) throw new RpcError('invalid-request', J.expandRequired());
    expand = parseExpand(raw.expand);
  } else if (raw.expand !== undefined) throw invalid('expand', J.expandShape());
  const provider = reader.string('provider', { optional: true, max: 200 });
  const model = reader.string('model', { optional: true, max: 200 });
  const outDir = reader.string('outDir', { optional: true, max: 4096 });
  if (outDir !== undefined && !path.isAbsolute(outDir)) throw invalid('outDir', JobsParams.mustBeAbsolutePath());
  return {
    inputs: inputs as string[],
    ...(mask ? { mask } : {}),
    ...(method !== undefined ? { method } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(expand ? { expand } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(outDir !== undefined ? { outDir } : {}),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPixel = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;

function parseMask(value: unknown): EditImageMask {
  const bad = () => invalid('mask', J.maskShape());
  if (!isObject(value) || Object.keys(value).some((k) => k !== 'boxes' && k !== 'strokes')) throw bad();
  const boxes = value.boxes ?? [];
  const strokes = value.strokes ?? [];
  if (!Array.isArray(boxes) || !Array.isArray(strokes) || boxes.length + strokes.length === 0 || boxes.length > 100 || strokes.length > 500) throw bad();
  const mask: EditImageMask = {
    boxes: boxes.map((b) => {
      if (!isObject(b) || ![b.x, b.y, b.width, b.height].every(isPixel) || Object.keys(b).length !== 4) throw bad();
      return { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number };
    }),
    strokes: strokes.map((s) => {
      if (!isObject(s) || !isPixel(s.radius) || s.radius < 1 || !Array.isArray(s.points) || s.points.length === 0 || s.points.length > 10_000) throw bad();
      if (Object.keys(s).length !== 2) throw bad();
      return {
        radius: s.radius,
        points: s.points.map((p) => {
          if (!Array.isArray(p) || p.length !== 2 || !p.every(isPixel)) throw bad();
          return [p[0], p[1]] as [number, number];
        }),
      };
    }),
  };
  return mask;
}

function parseExpand(value: unknown): EditImageExpand {
  const bad = () => invalid('expand', J.expandShape());
  if (!isObject(value) || Object.keys(value).some((k) => k !== 'ratio' && k !== 'anchor' && k !== 'margins')) throw bad();
  if (value.margins !== undefined && (value.ratio !== undefined || value.anchor !== undefined)) throw new RpcError('invalid-request', J.expandBoth());
  if (value.margins !== undefined) {
    const m = value.margins;
    const sides = ['left', 'top', 'right', 'bottom'] as const;
    if (!isObject(m) || Object.keys(m).length !== 4 || !sides.every((k) => Number.isInteger(m[k]) && isPixel(m[k]))) throw bad();
    return { margins: { left: m.left as number, top: m.top as number, right: m.right as number, bottom: m.bottom as number } };
  }
  if (typeof value.ratio !== 'string') throw new RpcError('invalid-request', J.expandRequired());
  if (parseRatio(value.ratio) === null) throw new RpcError('invalid-request', J.ratioInvalid({ ratio: value.ratio }));
  if (value.anchor !== undefined && !EDIT_IMAGE_ANCHORS.includes(value.anchor as never)) throw bad();
  return { ratio: value.ratio, ...(value.anchor !== undefined ? { anchor: value.anchor as EditImageExpand['anchor'] } : {}) };
}

/* ---------- 每张图的计划 ---------- */

type Planned = { plan: ImagePlan; problem?: undefined } | { plan?: undefined; problem: { code: string; message: Localized } };

/** 读文件头，换算选区或算新画布，按覆盖率与大小检查。启动时与读取这一步各算一次（之间文件可能变了）。 */
async function planInput(op: EditImageOp, method: EditImageMethod, file: string, params: EditImageParams): Promise<Planned> {
  const header = await inspectInput(file);
  if (!isHeader(header)) return { problem: { code: 'INPUT_UNREADABLE', message: header } };
  const name = path.basename(file);
  const base = { width: header.width, height: header.height, orientation: header.orientation };
  if (op === 'expand') {
    const plan = expandPlan(header, params.expand!);
    if (plan.width === header.width && plan.height === header.height) return { problem: { code: 'IMAGE_EDIT_NOTHING_TO_DO', message: J.expandSame({ name }) } };
    if (plan.width > EXPAND_MAX_SIDE || plan.height > EXPAND_MAX_SIDE) {
      return { problem: { code: 'IMAGE_EDIT_TOO_LARGE', message: J.expandTooLarge({ name, width: plan.width, height: plan.height, max: EXPAND_MAX_SIDE }) } };
    }
    const added = 1 - (header.width * header.height) / (plan.width * plan.height);
    return {
      plan: { ...base, outWidth: plan.width, outHeight: plan.height, coverage: added, region: { x: 0, y: 0, width: plan.width, height: plan.height }, mask: null, expand: plan },
    };
  }
  // 批量去水印：选区按第一张记，换算到这张的尺寸。
  const first = params.inputs[0] === file ? header : await readImageHeader(params.inputs[0]!).then((h) => (h ? upright(h) : null), () => null);
  const mask = first ? scaleMask(params.mask!, first, header) : params.mask!;
  const stats = maskStats(rasterizeMask(mask, header.width, header.height), header.width, header.height);
  if (!stats) return { problem: { code: 'IMAGE_EDIT_MASK_EMPTY', message: J.maskEmpty({ name }) } };
  if (stats.coverage > MAX_MASK_COVERAGE) {
    return {
      problem: {
        code: 'IMAGE_EDIT_MASK_TOO_LARGE',
        message: J.maskTooLarge({ name, percent: Math.round(stats.coverage * 100), max: Math.round(MAX_MASK_COVERAGE * 100) }),
      },
    };
  }
  return {
    plan: {
      ...base,
      outWidth: header.width,
      outHeight: header.height,
      coverage: stats.coverage,
      region: method === 'model' ? workArea(stats.bounds, header) : null,
      mask,
      expand: null,
    },
  };
}

async function inspectInput(file: string): Promise<ImageHeader | Localized> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return J.inputNotFound({ file });
  const header = await readImageHeader(file).catch(() => null);
  return header ? upright(header) : J.inputUnsupported({ name: path.basename(file) });
}

/**
 * 按 EXIF 方向转正之后的尺寸：界面（浏览器）与 ffmpeg 都把带方向标记的 JPEG 转正了再显示、解码，选区也是在转正的画面上画的，
 * 所以计划、遮罩与输出都按转正的尺寸算；结果是转正的 PNG（不再带方向标记）。方向 5–8 宽高互换。
 */
export function upright(header: ImageHeader): ImageHeader {
  return (header.orientation ?? 1) >= 5 ? { ...header, width: header.height, height: header.width } : header;
}

const isHeader = (value: ImageHeader | Localized): value is ImageHeader => 'mediaType' in value;

/** 一边扩出超过原图一倍：线条与地平线容易接不上，提醒分两次。 */
function staged(image: { width: number; height: number }, plan: ExpandPlan): boolean {
  return (plan.width - image.width) / image.width > 1 || (plan.height - image.height) / image.height > 1;
}

/** ffmpeg 不能用时以 `conflict` 拒绝启动，带补救（同图片超分）。 */
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

/* ---------- 修改 ---------- */

// i18n-ignore-start: 给图像模型的提示词
const MARK_NOTE = 'The solid magenta (#FF00FF) pixels mark the area to change.';
const KEEP_NOTE = 'Keep every pixel outside the magenta area exactly as it is, and leave no magenta in the result.';
function modelPrompt(op: EditImageOp, prompt: string | undefined): string {
  switch (op) {
    case 'erase':
    case 'watermark':
      return `${MARK_NOTE} Remove whatever is under it and fill the area so it continues the surrounding scene seamlessly: textures, lines, lighting and noise. Do not add new objects, text or logos. ${KEEP_NOTE}`;
    case 'repaint':
      return `${MARK_NOTE} Paint this into the area: ${prompt ?? ''}. Match the lighting, perspective, style and grain of the rest of the picture. ${KEEP_NOTE}`;
    case 'expand':
      return `This picture was placed on a larger canvas; the solid magenta (#FF00FF) border is empty. Extend the scene into it so the whole canvas is one seamless picture with consistent perspective, lighting and style.${prompt ? ` In the new areas: ${prompt}.` : ''} ${KEEP_NOTE}`;
  }
}
// i18n-ignore-end

/** 滤镜参数里的文件路径：先按选项值转义（`\`、`'`、`:`），再按滤镜图转义（`\`、`'`、`[`、`]`、`,`、`;`）。 */
export function filterPath(file: string): string {
  return file.replace(/[\\':]/g, '\\$&').replace(/[\\'[\],;]/g, '\\$&');
}

/** 送去模型的图缩到长边至多 {@link SEND_MAX_SIDE}；本来就小时不动。 */
function sendScale(width: number, height: number): string {
  const long = Math.max(width, height);
  if (long <= SEND_MAX_SIDE) return '';
  const k = SEND_MAX_SIDE / long;
  return `,scale=${Math.max(2, Math.round(width * k))}:${Math.max(2, Math.round(height * k))}:flags=lanczos`;
}

const ffmpegArgs = (inputs: string[], graph: string, out: string) => [
  '-hide_banner',
  '-v',
  'error',
  ...inputs.flatMap((file) => ['-i', `file:${file}`]),
  '-filter_complex',
  graph,
  '-map',
  '[o]',
  '-frames:v',
  '1',
  '-update',
  '1',
  '-y',
  `file:${out}`,
];

async function edit(
  op: EditImageOp,
  deps: EditImageDeps,
  context: PipelineStepContext<FrozenEditImageParams>,
): Promise<{ output: EditOutput }> {
  const { params, outputs, signal, staging, progress, jobId } = context;
  const { images } = outputs.probe as ProbeOutput;
  const masks = (outputs.mask as MaskOutput).files;
  const version = await ffmpegVersion(deps.ffmpeg);
  const run = (inputs: string[], graph: string, out: string) => runFfmpeg(deps.ffmpeg, ffmpegArgs(inputs, graph, out), { signal });
  const files: EditOutput['files'] = [];
  const total = params.inputs.length;
  progress({ done: 0, total, unit: 'units' }, 'generating');
  for (const [index, input] of params.inputs.entries()) {
    const plan = images[index]!;
    const { mark, blend } = masks[index]!;
    const n = index + 1;
    const out = path.join(staging, `edited-${n}.png`);
    await fs.rm(out, { force: true });
    if (params.method === 'fill') {
      // removelogo 按遮罩四周的像素往里填；它只处理 YUV，所以整张出来后只把选区贴回原图。
      const filled = path.join(staging, `filled-${n}.png`);
      await run([input], `[0:v]format=yuv420p,removelogo=f=${filterPath(mark)},format=rgb24[o]`, filled);
      await composite(run, input, filled, blend, { x: 0, y: 0, width: plan.width, height: plan.height }, out);
    } else {
      const region = plan.region!;
      const send = path.join(staging, `send-${n}.png`);
      const base = plan.expand ? path.join(staging, `canvas-${n}.png`) : input;
      if (plan.expand) {
        const e = plan.expand;
        // 新画布：原图按位置放，新增的部分是标记色（送去的图）；贴回时的底是同一张画布。
        await run([input], `[0:v]format=rgb24,pad=${e.width}:${e.height}:${e.x}:${e.y}:color=${MARK_COLOR}[o]`, base);
        await run([base], `[0:v]format=rgb24${sendScale(e.width, e.height)}[o]`, send);
      } else {
        const { x, y, width, height } = region;
        await run(
          [input, mark],
          `[0:v]crop=${width}:${height}:${x}:${y},format=rgb24[r];color=c=${MARK_COLOR}:s=${width}x${height},format=rgba[c0];` +
            `[1:v]format=gray[m];[c0][m]alphamerge[c];[r][c]overlay=shortest=1:format=auto,format=rgb24${sendScale(width, height)}[o]`,
          send,
        );
      }
      const editor = deps.editor;
      if (!editor) throw new PipelineStepError('IMAGE_EDIT_UNSUPPORTED', J.methodUnsupported({ method: 'model' }));
      const result = await editor.edit({
        providerId: params.provider!,
        modelId: params.model!,
        image: send,
        prompt: modelPrompt(op, params.prompt),
        width: region.width,
        height: region.height,
        jobId,
        staging,
        signal,
      });
      if (!(await readImageHeader(result.file).catch(() => null))) {
        throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.modelOutputUnreadable({ name: path.basename(input) }), { file: input });
      }
      // 扩图：羽化只为新画的部分与原图相接；最后把原图原样盖回它的位置，原图的每个像素都不变。
      await composite(run, base, result.file, blend, region, out, plan.expand ? { file: input, x: plan.expand.x, y: plan.expand.y } : null);
    }
    files.push({ file: out, source: input });
    progress({ done: n, total, unit: 'units' });
  }
  return { output: { files, version } };
}

/**
 * 贴回：`patch` 缩放到 `area` 的大小，经羽化的遮罩（`blend`，与 `area` 同样大）叠在 `base` 的 `area` 上，输出与 `base` 同样大。
 * `keep`：最后把这张图原样盖在 (x, y)（扩图的原图）。
 */
async function composite(
  run: (inputs: string[], graph: string, out: string) => Promise<void>,
  base: string,
  patch: string,
  blend: string,
  area: Rect,
  out: string,
  keep: { file: string; x: number; y: number } | null = null,
): Promise<void> {
  const blended = `[1:v]scale=${area.width}:${area.height}:flags=lanczos,format=rgba[p];[2:v]format=gray,gblur=sigma=${FEATHER_SIGMA}[m];` +
    `[p][m]alphamerge[pm];[0:v]format=rgba[b];[b][pm]overlay=x=${area.x}:y=${area.y}:format=auto`;
  await run(
    keep ? [base, patch, blend, keep.file] : [base, patch, blend],
    keep ? `${blended}[t];[3:v]format=rgba[k];[t][k]overlay=x=${keep.x}:y=${keep.y}:format=auto,format=rgba[o]` : `${blended},format=rgba[o]`,
    out,
  );
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
