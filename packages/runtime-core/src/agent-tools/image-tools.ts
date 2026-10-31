import path from 'node:path';
import { z } from 'zod';
import { EDIT_IMAGE_PIPELINES, UPSCALE_IMAGE_PIPELINE, type PipelineRunner } from '@baocut/jobs';
import {
  EDIT_IMAGE_ANCHORS,
  EDIT_IMAGE_METHODS,
  EDIT_IMAGE_OPS,
  RpcError,
  UPSCALE_IMAGE_MODEL_SPECS,
  UPSCALE_IMAGE_MODELS,
  UPSCALE_IMAGE_PROMPT_MAX,
  type ExternalToolStatus,
  type UpscaleImageModel,
} from '@baocut/protocol';
import { JobsEditImage } from '@baocut/protocol/messages/jobs/edit-image.ts';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ExternalToolService } from '../external-tools/external-tool-service.ts';
import { toolErrorOf } from './link-import-tools.ts';
import { formatBytes } from './model-install-tools.ts';
import { isPaidProvider } from './paid-calls.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { resolveUserPath } from './video-digest.ts';
import { commandIdArg } from './video-tools.ts';

/**
 * 图片的本机处理（架构设计 §7.9、§12.9）：`upscale` 把图片放大，启动 `upscale-image` 流程。引擎按模型定：Real-ESRGAN（自带权重
 * 或 Upscayl 权重包）、waifu2x 是受管的外部工具，`lanczos` 只用 ffmpeg，`generative` 交给收参考图的生图模型重画。文件到文件：
 * 输出 PNG 到 `outDir`（不给时是保存位置），不动原图。
 *
 * - 要的工具都装好了：按 `upscale`（`command`）确认，之后启动流程。本机工具不读网络、不读用户数据之外的东西，不要单独的使用同意；
 *   `generative` 先选定模型（同流程），确认卡写出它，外发的授权与预算同生成图片。
 * - 执行的工具或权重包没有安装：按 `external_tools_install`（`high`）确认，说明里写明来源、版本、大小与许可；用户同意即提交安装
 *   任务，返回安装任务号（一次装一个）。装好之后智能体再调用一次。
 *
 * `retouch` 去除物体、去水印、重绘局部与扩展画面（`remove-object` 等四个流程）：快速填充只用本机 ffmpeg；AI 修补把选区周围的
 * 一块（扩图是整张新画布）交给能改图的图像模型，授权与预算同生成图片。按 `retouch`（`command`）确认后启动流程。
 *
 * 对外服务不能用：路径是本机的，安装第三方程序由用户在 BaoCut 里决定。
 */

export interface ImageToolsDeps {
  tools: ExternalToolService;
  pipelines: PipelineRunner;
  /** 不给 `outDir` 时的保存位置（与流程一样）；只用来写进确认的摘要。 */
  saveDirectory: () => string;
  /**
   * AI 修补用哪个模型（同流程启动时的选择：没指定模型时只在能改图的里选）。确认前先选定，确认卡写出真正要用的模型、流程
   * 用同一个；选不出时同步拒绝。不给时（目录生成）不选，确认卡写「生图的默认模型」。
   */
  editModel?: (target: { provider?: string; model?: string }) => Promise<{ providerId: string; modelId: string }>;
  /** 生成式放大用哪个模型（同流程启动时的选择：只在收参考图、列出尺寸的里选）；确认前先选定。不给时不选。 */
  upscaleModel?: (target: { provider?: string; model?: string }) => Promise<{ providerId: string; modelId: string }>;
  scope: ToolScope;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  upscale: z.strictObject({
    files: z
      .array(z.string().min(1).max(4000))
      .min(1)
      .max(50)
      .describe('要放大的图片（PNG、JPEG、WebP），相对路径按工作目录（终端里是当前目录），~/ 是主目录'),
    scale: z
      .union([z.literal(2), z.literal(3), z.literal(4)])
      .optional()
      .describe('可选。放大倍数 2、3、4，默认 4。输出的边长不能超过 16384 像素'),
    model: z
      .enum(UPSCALE_IMAGE_MODELS)
      .optional()
      .describe(
        '可选，默认 photo。Real-ESRGAN：photo 照片、实拍、截图；anime 动画、视频截图；illustration 插画、线稿。Upscayl 权重（第一次用时要装权重包）：' +
          'upscayl-lite 快；high-fidelity 保真；remacri 锐利的写实（不可商用）；ultramix-balanced 均衡；ultrasharp 最锐利（不可商用）。waifu2x（可降噪）：' +
          'waifu2x 插画；waifu2x-anime 动画；waifu2x-photo 照片。lanczos 插值，不用模型、不补细节。generative 把图发给生图模型重画（联网、计费，可能改动细节与文字）',
      ),
    denoise: z
      .union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
      .optional()
      .describe('可选。降噪强度，-1 不降噪、0 默认、3 最强；只有 waifu2x 的模型收，适合有 JPEG 噪点的图'),
    provider: z.string().min(1).max(200).optional().describe('可选，只有 generative 收。生图的 Provider；不给时用生图的默认（它不收参考图时换第一个收的）'),
    imageModel: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选，只有 generative 收。生图模型的 ID，要收参考图并列出尺寸（models_capabilities 的 generateImage 里 referenceImages 不为 null）'),
    prompt: z
      .string()
      .min(1)
      .max(UPSCALE_IMAGE_PROMPT_MAX)
      .optional()
      .describe('可选，只有 generative 收。附加的说明：画面里是什么、要保留的文字'),
    outDir: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('可选。输出目录（不存在时创建）；不给时是保存位置（设置 downloads.directory，默认系统的下载文件夹）'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  retouch: z.strictObject({
    op: z
      .enum(EDIT_IMAGE_OPS)
      .describe('erase：去除物体；watermark：去水印、角标、字幕条（可以一次几张）；repaint：把选区重画成 prompt 写的样子；expand：把画面往外扩'),
    files: z
      .array(z.string().min(1).max(4000))
      .min(1)
      .max(50)
      .describe('图片（PNG、JPEG、WebP），相对路径按工作目录，~/ 是主目录。只有 watermark 收多张（同一组框按比例用于每一张）'),
    mask: z
      .strictObject({
        boxes: z
          .array(z.strictObject({ x: z.number().min(0), y: z.number().min(0), width: z.number().min(0), height: z.number().min(0) }))
          .max(100)
          .optional(),
        strokes: z
          .array(z.strictObject({ radius: z.number().min(1), points: z.array(z.tuple([z.number().min(0), z.number().min(0)])).min(1).max(10000) }))
          .max(500)
          .optional(),
      })
      .optional()
      .describe('选区，原图像素（左上角为原点；批量时按第一张）：框与笔画的并集。erase、watermark、repaint 必填，expand 不收。选区占画面超过六成会被拒绝'),
    method: z
      .enum(EDIT_IMAGE_METHODS)
      .optional()
      .describe('可选。fill：本机 ffmpeg 按四周像素填充，几秒钟、不用模型，适合小块文字与角标（watermark 默认）；model：能改图的图像模型重画，适合大块物体与复杂背景（erase 默认；repaint、expand 只有它）'),
    prompt: z.string().min(1).max(2000).optional().describe('repaint 必填（选区改成什么）；expand 可选（新增的部分画什么）；别的不收'),
    expand: z
      .strictObject({
        ratio: z.string().max(12).optional().describe('W:H，如 16:9；只往缺的方向加，不裁原图'),
        anchor: z.enum(EDIT_IMAGE_ANCHORS).optional().describe('原图放在新画布的哪里，默认 center'),
        margins: z
          .strictObject({ left: z.number().int().min(0), top: z.number().int().min(0), right: z.number().int().min(0), bottom: z.number().int().min(0) })
          .optional()
          .describe('四边各加多少像素；与 ratio 二选一'),
      })
      .optional()
      .describe('expand 必填：新画布。每边至多 4096 像素'),
    provider: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。model 补法的生图 Provider；不给时用生图的默认，它不能改图时自动换第一个能改图的（本机 › OpenAI…）'),
    model: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。model 补法用的模型，要能按提示词改图（models_capabilities 的 generateImage 里 referenceImages.edit 为 true）'),
    outDir: z.string().min(1).max(4000).optional().describe('可选。输出目录（不存在时创建）；不给时是保存位置'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type Args = z.infer<(typeof schemas)['upscale']>;
type EditArgs = z.infer<(typeof schemas)['retouch']>;

const DEFINITIONS: Record<'upscale' | 'retouch', ToolInfo> = {
  upscale: {
    title: '放大图片',
    description: [
      '把图片放大 2–4 倍（超分辨率，补出细节，不是简单拉伸）。文件到文件：每张输出一个 <原名>-upscaled-<倍数>x.png，不动原图。',
      '默认在本机用 Real-ESRGAN：照片、截图用 model photo（默认）；动画、视频截图用 anime；插画、线稿用 illustration。要别的风格时换 Upscayl 的权重或 waifu2x（有 JPEG 噪点时加 denoise）；lanczos 不用模型。没有原生倍数时先放大到原生倍数再缩到目标尺寸。',
      'generative 把图发给生图模型重画：细节最多，但会改动内容，只在用户要「AI 重画」或本机效果不够时用；remacri、ultrasharp 的权重不可商用，用户要商用时别选。',
      '会按访问模式向用户确认；选的模型要的工具或权重包没有安装时会请用户同意下载（显示来源、版本、大小与许可），这次只提交安装并返回 installJobId：用 jobs_wait 等它 completed，再调用一次本工具。',
      '立即返回 jobId。用 jobs_wait 等它结束；state 为 completed 时 outputs 里是放大后的 PNG（path），要放进视频时用 assets_import 导入。失败时 error.code 是 UPSCALE_FAILED、UPSCALE_OUTPUT_TOO_LARGE、UPSCALE_MODEL_TOO_SMALL、INPUT_UNREADABLE 等；不要自己运行放大程序绕过。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '把截图放大 2 倍', args: { files: ['shots/cover.png'], scale: 2 } },
      { title: '把插画放大 4 倍，存到指定文件夹', args: { files: ['art/a.jpg', 'art/b.jpg'], model: 'illustration', outDir: '~/Pictures/upscaled' } },
      { title: '给有噪点的动画截图降噪并放大 2 倍', args: { files: ['frames/ep1.jpg'], model: 'waifu2x-anime', scale: 2, denoise: 2 } },
    ],
    surfaces: ['agent', 'cli'],
    positional: 'files',
  },
  retouch: {
    title: '修改图片',
    description: [
      '去除物体（erase）、去水印（watermark）、重绘局部（repaint）或扩展画面（expand）。文件到文件：每张输出一个 <原名>-erased / -no-watermark / -repainted / -expanded.png，不动原图。',
      '选区用原图像素：先看图（尺寸、要改的东西在哪）再给 mask。框住水印、角标、字幕条用 boxes；不规则的物体用 strokes（半径够盖住边缘，边缘多涂一点更自然）。',
      'method fill 不用模型，在这台电脑上几秒钟做完；model 把选区周围的一块（扩图是整张新画布）发给图像模型，回来后只贴回选区，选区外的像素不变。',
      '不指定 model 时用生图的默认模型；它不能改图时自动换第一个能改图的，返回的 model 是实际用的。没有能改图的模型时以 IMAGE_EDIT_UNSUPPORTED 拒绝，按 remedy 改用 fill 或请用户装一个。',
      '会按访问模式向用户确认。立即返回 jobId；用 jobs_wait 等它结束，state 为 completed 时 outputs 的 path 是新图片。失败时 error.code 是 IMAGE_EDIT_MASK_TOO_LARGE、IMAGE_EDIT_UNSUPPORTED（模型不能改图）、MODEL_OUTPUT_INVALID 等。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '去掉右下角的水印', args: { op: 'watermark', files: ['shots/a.png'], mask: { boxes: [{ x: 1500, y: 980, width: 380, height: 80 }] } } },
      { title: '把天空扩成 16:9', args: { op: 'expand', files: ['photo.jpg'], expand: { ratio: '16:9', anchor: 'bottom' }, prompt: '晴朗的天空' } },
    ],
    surfaces: ['agent', 'cli'],
    positional: 'files',
  },
};
// i18n-ignore-end

export class ImageTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: ImageToolsDeps;

  constructor(deps: ImageToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    const run =
      name === 'upscale'
        ? upscale(this.#deps, args as Args, principal)
        : name === 'retouch'
          ? imageEdit(this.#deps, args as EditArgs, principal)
          : Promise.reject(new ToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`));
    return run.catch((error: unknown) => {
      throw toolErrorOf(error);
    });
  }
}

async function upscale(deps: ImageToolsDeps, args: Args, principal: ToolPrincipal) {
  const { pipelines, scope } = deps;
  const access = scope.authorize(principal, true);
  if (access.principal.kind === 'service') {
    throw new ToolError('INVALID_ARGUMENTS', 'External services cannot upscale images on this computer. Ask the user to use the Upscale image tool in BaoCut.');
  }
  const base = scope.fileBase(access);
  const inputs = args.files.map((file) => resolveUserPath(file, base));
  const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, base) : undefined;
  const scale = args.scale ?? 4;
  const model = args.model ?? 'photo';
  const spec = UPSCALE_IMAGE_MODEL_SPECS[model];
  // 确认之前先挡住这个模型不收的参数，免得用户同意了再失败。
  if (args.denoise !== undefined && !spec.denoise) {
    throw new ToolError('INVALID_ARGUMENTS', `The ${model} model can't denoise; denoise only works with waifu2x, waifu2x-anime and waifu2x-photo.`);
  }
  const extra = (['provider', 'imageModel', 'prompt'] as const).filter((key) => args[key] !== undefined);
  if (spec.engine !== 'generative' && extra.length) {
    throw new ToolError('INVALID_ARGUMENTS', `${extra.join(', ')} only apply to model generative; ${model} runs on this computer.`);
  }
  // 本机的引擎：执行的工具与权重包没装好时先按安装确认（一次装一个，装好之后智能体再调用一次）。
  for (const name of [spec.tool, spec.pack]) {
    const pending = name ? await installStep(deps, access, args, name) : null;
    if (pending) return pending;
  }
  const target =
    spec.engine === 'generative' && deps.upscaleModel
      ? await deps.upscaleModel({
          ...(args.provider !== undefined ? { provider: args.provider } : {}),
          ...(args.imageModel !== undefined ? { model: args.imageModel } : {}),
        })
      : null;
  const dir = outDir ?? deps.saveDirectory();
  const summary =
    spec.engine === 'generative'
      ? RcAgentTools.upscaleGenerativeSummary({
          count: inputs.length,
          scale,
          model: target ? `${target.providerId}/${target.modelId}` : (args.imageModel ?? args.provider ?? RcAgentTools.imageEditDefaultModel().text),
          dir,
        })
      : RcAgentTools.upscaleSummary({ count: inputs.length, scale, executor: executorLabel(model), dir });
  // 生成式放大交给图片模型：选不出模型时（目录生成）按付费处理；本机的超分不花钱（§14.2）。
  const paid = spec.engine === 'generative' && (target ? isPaidProvider(target.providerId) : true);
  const approval = await scope.confirm(access, { tool: 'upscale', paid, ...confirmSummary(summary) });
  const { jobId } = await pipelines.start(
    {
      pipeline: UPSCALE_IMAGE_PIPELINE,
      params: {
        inputs,
        scale,
        model,
        ...(args.denoise !== undefined ? { denoise: args.denoise } : {}),
        ...(target
          ? { provider: target.providerId, imageModel: target.modelId }
          : {
              ...(args.provider !== undefined ? { provider: args.provider } : {}),
              ...(args.imageModel !== undefined ? { imageModel: args.imageModel } : {}),
            }),
        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
        ...(outDir !== undefined ? { outDir } : {}),
      },
      ...(args.commandId ? { commandId: scope.commandId(access, args.commandId) } : {}),
    },
    access.submitter,
  );
  return {
    jobId,
    installJobId: null,
    ...(target ? { provider: target.providerId, imageModel: target.modelId } : {}),
    ...approvalField(approval),
    next: `Upscale submitted (${inputs.length} ${inputs.length === 1 ? 'image' : 'images'}, ${scale}×, ${target ? `${model}, ${target.providerId}/${target.modelId}` : model}); PNGs go to ${outDir ?? 'the save location'}${
      inputs.length === 1 ? ` (${path.parse(inputs[0]!).name}-upscaled-${scale}x.png)` : ''
    }. Wait with jobs_wait; when state is completed, outputs[].path is the upscaled image. Tell the user where it is${
      spec.engine === 'generative' ? ' and ask them to check it: a generative upscale may change details and text' : ''
    }.`,
  };
}

/** 确认卡与回复里的执行器：工具名与权重（产品名与模型名，不翻译）。 */
function executorLabel(model: UpscaleImageModel): string {
  const spec = UPSCALE_IMAGE_MODEL_SPECS[model];
  if (spec.engine === 'waifu2x') return `waifu2x (${spec.weights})`;
  if (spec.engine === 'realesrgan') return `Real-ESRGAN (${spec.weights}${spec.pack ? ', Upscayl' : ''})`;
  return 'Lanczos (ffmpeg)';
}

/**
 * 一个要用的受管工具（或权重包）：装好了时 null；正在装时返回那个安装任务；没装时按 `external_tools_install`（`high`）确认、提交
 * 安装并返回安装任务号；装不了时报错（带补救）。
 */
async function installStep(deps: ImageToolsDeps, access: ToolAccess, args: Args, name: string) {
  const { tools, scope } = deps;
  const status = await tools.status(name);
  if (status.state === 'installed' && !status.installJobId) return null;
  if (status.installJobId) {
    return { jobId: null, installJobId: status.installJobId, tool: toolView(status), next: installNext(status.label) };
  }
  if (status.state === 'unavailable' || !status.installable) {
    throw new ToolError('TOOL_UNAVAILABLE', `${status.label} is not available: ${status.reason ?? 'no usable version'}`, {
      tool: status.name,
      state: status.state,
      remedy: status.remedy ?? `Ask the user to install ${status.label} or set its path in BaoCut's external tool settings.`,
    });
  }
  const offer = status.offer;
  if (!offer || offer.blockedReason || !offer.url) {
    throw new ToolError('TOOL_MANIFEST_INCOMPLETE', `${status.label} cannot be downloaded: ${offer?.blockedReason ?? 'no release for this platform'}`, {
      tool: status.name,
      remedy: `Ask the user to install ${status.label} themselves, then set its path in BaoCut's external tool settings.`,
    });
  }
  const approval = await scope.confirm(access, {
    tool: 'external_tools_install',
    ...confirmSummary(
      RcAgentTools.installUpscalerSummary({
        tool: status.label,
        version: offer.version,
        size: formatBytes(offer.sizeBytes ?? offer.estimatedBytes),
        license: offer.license,
        url: offer.url,
      }),
    ),
    risk: 'high',
  });
  const installed = await tools.install(
    {
      name: status.name,
      consent: true,
      via: 'agent-approval',
      ...(args.commandId ? { commandId: scope.commandId(access, `${args.commandId}-install-${name}`) } : {}),
    },
    access.submitter,
  );
  return { jobId: null, installJobId: installed.jobId, tool: toolView(installed.tool), ...approvalField(approval), next: installNext(status.label) };
}

const EDIT_LABELS = { erase: JobsEditImage.eraseLabel, watermark: JobsEditImage.watermarkLabel, repaint: JobsEditImage.repaintLabel, expand: JobsEditImage.expandLabel };

async function imageEdit(deps: ImageToolsDeps, args: EditArgs, principal: ToolPrincipal) {
  const { pipelines, scope } = deps;
  const access = scope.authorize(principal, true);
  if (access.principal.kind === 'service') {
    throw new ToolError('INVALID_ARGUMENTS', 'External services cannot edit images on this computer. Ask the user to use the image tools in BaoCut.');
  }
  const base = scope.fileBase(access);
  const inputs = args.files.map((file) => resolveUserPath(file, base));
  const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, base) : undefined;
  const method = args.method ?? (args.op === 'watermark' ? 'fill' : 'model');
  const target = method === 'model' && deps.editModel ? await editTarget(deps.editModel, args) : null;
  const executor =
    method === 'fill'
      ? 'ffmpeg'
      : target
        ? `${target.providerId}/${target.modelId}`
        : (args.model ?? args.provider ?? RcAgentTools.imageEditDefaultModel().text);
  // AI 修补交给图片模型（选不出时按付费处理）；快速填充只用本机的 ffmpeg（§14.2）。
  const paid = method === 'model' && (target ? isPaidProvider(target.providerId) : true);
  const approval = await scope.confirm(access, {
    tool: 'retouch',
    paid,
    ...confirmSummary(
      RcAgentTools.imageEditSummary({ tool: EDIT_LABELS[args.op]().text, count: inputs.length, executor, dir: outDir ?? deps.saveDirectory() }),
    ),
  });
  const pipeline = EDIT_IMAGE_PIPELINES[args.op];
  const { jobId } = await pipelines.start(
    {
      pipeline,
      params: {
        inputs,
        ...(args.mask ? { mask: args.mask } : {}),
        ...(args.method ? { method: args.method } : {}),
        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
        ...(args.expand ? { expand: args.expand } : {}),
        ...(target
          ? { provider: target.providerId, model: target.modelId }
          : {
              ...(args.provider !== undefined ? { provider: args.provider } : {}),
              ...(args.model !== undefined ? { model: args.model } : {}),
            }),
        ...(outDir !== undefined ? { outDir } : {}),
      },
      ...(args.commandId ? { commandId: scope.commandId(access, args.commandId) } : {}),
    },
    access.submitter,
  );
  return {
    jobId,
    ...(target ? { provider: target.providerId, model: target.modelId } : {}),
    ...approvalField(approval),
    next: `Submitted (${pipeline}, ${inputs.length} ${inputs.length === 1 ? 'image' : 'images'}, ${target ? `${target.providerId}/${target.modelId}` : method}); PNGs go to ${outDir ?? 'the save location'}. Wait with jobs_wait; when state is completed, outputs[].path is the new image. Tell the user where it is and ask them to check the result.`,
  };
}

/**
 * AI 修补的模型：没指定模型、哪里都没有能改图的时，换成带下一步的错误（快速填充，或请用户装一个能改图的模型）。
 */
async function editTarget(resolve: NonNullable<ImageToolsDeps['editModel']>, args: EditArgs) {
  try {
    return await resolve({
      ...(args.provider !== undefined ? { provider: args.provider } : {}),
      ...(args.model !== undefined ? { model: args.model } : {}),
    });
  } catch (error) {
    const details = error instanceof RpcError && isRecord(error.details) ? error.details : null;
    if (details?.code !== 'IMAGE_EDIT_UNSUPPORTED' || args.model !== undefined) throw error;
    const { code, ...rest } = details;
    const where = args.provider !== undefined ? `${args.provider} has` : 'There is';
    const setUp =
      'Ask the user to set up an edit-capable image model: install a local Qwen-Image bundle (models_install) or connect OpenAI in Settings › Models; models_capabilities lists models whose referenceImages.edit is true.';
    throw new ToolError(String(code), `${where} no ready image model that can edit an image by prompt (the default, ${String(rest.modelId)}, can't).`, {
      ...rest,
      remedy: args.op === 'erase' || args.op === 'watermark' ? `Use method fill for small marks on a plain background, or: ${setUp}` : setUp,
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const installNext = (label: string) =>
  `${label} is being installed. Wait for installJobId with jobs_wait; once its state is completed, call upscale again. If it fails, error.details.remedy says how to fix it.`;

function toolView(status: ExternalToolStatus) {
  return { name: status.name, state: status.state, version: status.version, source: status.source };
}
