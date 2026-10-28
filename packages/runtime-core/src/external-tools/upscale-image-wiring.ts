import path from 'node:path';
import { upscaleImagePipeline, type ImageUpscaler, type PipelineDefinition, type ProbeToolResolver } from '@baocut/jobs';
import type { GrantService } from '../grants/grant-service.ts';
import { withPipelineGrants } from '../grants/pipeline-grants.ts';
import { IMAGE_EDIT_DATA_KINDS } from '../models/image-edit.ts';
import type { ExternalToolService } from './external-tool-service.ts';
import { REALESRGAN, WAIFU2X } from './tool-manifests.ts';

/**
 * 「图片超分」流程在 Runtime 里的接线（架构设计 §7.9）：Real-ESRGAN、waifu2x 与 Upscayl 权重包由外部工具服务给出（受管副本、
 * 用户指定的路径或 PATH，已安装、能运行）。Real-ESRGAN 的权重是可执行文件旁边的 `models/`，waifu2x 的各个 `models-*` 与可执行
 * 文件在同一层，权重包解析出的路径就是它的目录；ffmpeg 与文件转码同一个。生成式放大的执行者来自模型服务（`imageUpscaler`），
 * 启动前按生成图片判断授权与额度（只有 `generative` 外发，同图片编辑的 AI 修补）。外部工具服务在 Runtime 启动的后面几步才有，
 * 调用时再取。
 */
export interface UpscaleImageWiring {
  tools: () => ExternalToolService;
  ffmpeg: ProbeToolResolver;
  /** 生成式放大：执行者与它的授权；不给时不收 `generative`。 */
  generative?: { upscaler: ImageUpscaler; grants: GrantService };
  saveDirectory?: () => string;
}

export function upscaleImageDefinition(wiring: UpscaleImageWiring): PipelineDefinition<any, any> {
  const definition = upscaleImagePipeline({
    tool: async (name) => {
      const resolved = await wiring.tools().resolveForUse(name);
      const dir = path.dirname(resolved.command);
      const modelsDir = name === REALESRGAN ? path.join(dir, 'models') : name === WAIFU2X ? dir : undefined;
      return { command: resolved.command, version: resolved.version, env: resolved.env, ...(modelsDir ? { modelsDir } : {}) };
    },
    ffmpeg: wiring.ffmpeg,
    ...(wiring.generative ? { upscaler: wiring.generative.upscaler } : {}),
    ...(wiring.saveDirectory ? { saveDirectory: wiring.saveDirectory } : {}),
  });
  if (!wiring.generative) return definition;
  return withPipelineGrants(definition, wiring.generative.grants, IMAGE_EDIT_DATA_KINDS, (plan) =>
    plan.params.model === 'generative'
      ? [{ capability: 'generateImage' as const, providerId: plan.providerId, modelId: plan.modelId, dataKinds: IMAGE_EDIT_DATA_KINDS }]
      : [],
  );
}
