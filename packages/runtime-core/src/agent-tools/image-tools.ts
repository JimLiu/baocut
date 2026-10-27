import path from 'node:path';
import { z } from 'zod';
import { UPSCALE_IMAGE_PIPELINE, UPSCALE_WEIGHTS, type PipelineRunner } from '@baocut/jobs';
import { UPSCALE_IMAGE_MODELS, type ExternalToolStatus } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ExternalToolService } from '../external-tools/external-tool-service.ts';
import { REALESRGAN } from '../external-tools/tool-manifests.ts';
import { toolErrorOf } from './link-import-tools.ts';
import { formatBytes } from './model-install-tools.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { resolveUserPath } from './video-digest.ts';
import { commandIdArg } from './video-tools.ts';

/**
 * 图片的本机处理（架构设计 §7.9、§12.9）：`upscale` 用 Real-ESRGAN（受管的外部工具）把图片放大，启动 `upscale-image` 流程。
 * 文件到文件：输出 PNG 到 `outDir`（不给时是保存位置），不动原图。
 *
 * - Real-ESRGAN 已安装：按 `upscale`（`command`）确认，之后启动流程。它不读网络、不读用户数据之外的东西，不要单独的使用同意。
 * - 没有安装：按 `external_tools_install`（`high`）确认，说明里写明来源、版本、大小与许可；用户同意即提交安装任务，返回安装任务号。
 *   装好之后智能体再调用一次。
 *
 * 对外服务不能用：路径是本机的，安装第三方程序由用户在 BaoCut 里决定。
 */

export interface ImageToolsDeps {
  tools: ExternalToolService;
  pipelines: PipelineRunner;
  /** 不给 `outDir` 时的保存位置（与流程一样）；只用来写进确认的摘要。 */
  saveDirectory: () => string;
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
      .describe('可选。photo（照片、实拍、截图，默认）或 anime（动画、插画、线稿：边缘更干净）'),
    outDir: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('可选。输出目录（不存在时创建）；不给时是保存位置（设置 downloads.directory，默认系统的下载文件夹）'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type Args = z.infer<(typeof schemas)['upscale']>;

const DEFINITIONS: Record<'upscale', ToolInfo> = {
  upscale: {
    title: '放大图片',
    description: [
      '用本机的 Real-ESRGAN 把图片放大 2–4 倍（超分辨率，补出细节，不是简单拉伸）。文件到文件：每张输出一个 <原名>-upscaled-<倍数>x.png，不动原图。',
      '照片、截图用 model photo（默认）；动画、插画、线稿用 anime。2× 与 3× 的照片是先放大 4 倍再缩到目标尺寸。',
      '会按访问模式向用户确认；Real-ESRGAN 没有安装时会请用户同意下载它（显示来源、版本、大小与许可），这次只提交安装并返回 installJobId：用 jobs_wait 等它 completed，再调用一次本工具。',
      '立即返回 jobId。用 jobs_wait 等它结束；state 为 completed 时 outputs 里是放大后的 PNG（path），要放进视频时用 assets_import 导入。失败时 error.code 是 UPSCALE_FAILED、UPSCALE_OUTPUT_TOO_LARGE、INPUT_UNREADABLE 等；不要自己运行放大程序绕过。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '把截图放大 2 倍', args: { files: ['shots/cover.png'], scale: 2 } },
      { title: '把插画放大 4 倍，存到指定文件夹', args: { files: ['art/a.jpg', 'art/b.jpg'], model: 'anime', outDir: '~/Pictures/upscaled' } },
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
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (name !== 'upscale') return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    return upscale(this.#deps, args as Args, principal).catch((error: unknown) => {
      throw toolErrorOf(error);
    });
  }
}

async function upscale(deps: ImageToolsDeps, args: Args, principal: ToolPrincipal) {
  const { tools, pipelines, scope } = deps;
  const access = scope.authorize(principal, true);
  if (access.principal.kind === 'service') {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    throw new ToolError('INVALID_ARGUMENTS', '对外服务不能放大本机的图片：请用户在 BaoCut 里用图片超分工具');
  }
  const base = scope.fileBase(access);
  const inputs = args.files.map((file) => resolveUserPath(file, base));
  const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, base) : undefined;
  const status = await tools.status(REALESRGAN);
  if (status.installJobId) {
    return { jobId: null, installJobId: status.installJobId, tool: toolView(status), next: installNext };
  }
  if (status.state === 'unavailable' || (status.state !== 'installed' && !status.installable)) {
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    throw new ToolError('TOOL_UNAVAILABLE', `${status.label} 现在不能用：${status.reason ?? '没有可用的版本'}`, {
      tool: status.name,
      state: status.state,
      remedy: status.remedy ?? `请用户在 BaoCut 的外部工具设置里安装或指定 ${status.label} 的路径`,
    });
    // i18n-ignore-end
  }
  if (status.state !== 'installed') {
    const offer = status.offer;
    if (!offer || offer.blockedReason || !offer.url) {
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      throw new ToolError('TOOL_MANIFEST_INCOMPLETE', `不能下载 ${status.label}：${offer?.blockedReason ?? '这个平台没有可用的版本'}`, {
        tool: status.name,
        remedy: `请用户自己安装 ${status.label}，再在 BaoCut 的外部工具设置里指定路径`,
      });
      // i18n-ignore-end
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
        ...(args.commandId ? { commandId: scope.commandId(access, `${args.commandId}-install`) } : {}),
      },
      access.submitter,
    );
    return { jobId: null, installJobId: installed.jobId, tool: toolView(installed.tool), ...approvalField(approval), next: installNext };
  }
  const scale = args.scale ?? 4;
  const model = args.model ?? 'photo';
  const approval = await scope.confirm(access, {
    tool: 'upscale',
    ...confirmSummary(
      RcAgentTools.upscaleSummary({
        count: inputs.length,
        scale,
        weights: UPSCALE_WEIGHTS[model].weights,
        dir: outDir ?? deps.saveDirectory(),
      }),
    ),
  });
  const { jobId } = await pipelines.start(
    {
      pipeline: UPSCALE_IMAGE_PIPELINE,
      params: { inputs, scale, model, ...(outDir !== undefined ? { outDir } : {}) },
      ...(args.commandId ? { commandId: scope.commandId(access, args.commandId) } : {}),
    },
    access.submitter,
  );
  return {
    jobId,
    installJobId: null,
    ...approvalField(approval),
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    next: `放大已提交（${inputs.length} 张，${scale}×，${model}），PNG 存到 ${outDir ?? '保存位置'}${
      inputs.length === 1 ? `（${path.parse(inputs[0]!).name}-upscaled-${scale}x.png）` : ''
    }。用 jobs_wait 等它结束；state 为 completed 时 outputs 的 path 是放大后的图片，把位置告诉用户。`,
    // i18n-ignore-end
  };
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const installNext =
  'Real-ESRGAN 正在安装：用 jobs_wait 等 installJobId 对应的任务，state 为 completed 之后再调用一次 upscale；失败时 error.details.remedy 说明怎么补救。';
// i18n-ignore-end

function toolView(status: ExternalToolStatus) {
  return { name: status.name, state: status.state, version: status.version, source: status.source };
}
