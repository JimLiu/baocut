import type { ImageUpscaler } from '@baocut/jobs';
import { freezeImageInput, imageParameters, localImageSeed, type GenerationSelection, type ImageParameters, type ModelCatalog, type ModelServices } from '@baocut/models';
import { RpcError, type ImageModelInfo } from '@baocut/protocol';
import { JobsUpscaleImage as J } from '@baocut/protocol/messages/jobs/upscale-image.ts';
import type { GrantService } from '../grants/grant-service.ts';
import { imageCallResources, runImageCall, stepError } from './image-edit.ts';

/**
 * 生成式放大（`upscale-image` 的 `generative`，架构设计 §7.9）：把源图作为参考图交给生图模型，按流程定好的尺寸重画一张。选择、参数
 * 检查、输入图冻结与授权同图片编辑的 AI 修补（`imageEditor`）：
 *
 * - 启动时选定 Provider 与模型（§6.2）：模型要收参考图（`referenceImages`，不必能「按提示词改图」）并列出像素尺寸，否则
 *   `UPSCALE_MODEL_UNSUPPORTED`。没指定模型时只在这样的模型里选：生图的默认不行就按出厂顺序换第一个行的；
 * - 每次调用冻结一张输入图（流程补边后的那张，或源图本身），按请求的尺寸出一张，格式优先 PNG；输入图超过模型的字节上限时
 *   `INPUT_TOO_LARGE`；
 * - 授权、预算、本机模型包的资源与 Provider 的失败同图片编辑（外发的数据种类同生成图片）。
 */

/** 能用来放大：收参考图、列出了像素尺寸。 */
const upscalable = (model: Pick<ImageModelInfo, 'referenceImages' | 'sizes'>) => !!model.referenceImages && pixelSizes(model).length > 0;
const pixelSizes = (model: Pick<ImageModelInfo, 'sizes'>) => model.sizes.filter((size) => /^\d+x\d+$/.test(size));

export function imageUpscaler(options: { services: ModelServices; grants: GrantService; catalog: ModelCatalog }): ImageUpscaler {
  const { services, grants, catalog } = options;
  const select = async (provider?: string, model?: string) => {
    const selection = await services.selectGeneration(
      'generateImage',
      {
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
      },
      upscalable,
    );
    const where = { code: 'UPSCALE_MODEL_UNSUPPORTED', providerId: selection.providerId, modelId: selection.modelId };
    if (!selection.model.referenceImages) throw new RpcError('invalid-request', J.modelNoReferences({ modelId: selection.modelId }), where);
    if (!pixelSizes(selection.model).length) throw new RpcError('invalid-request', J.modelNoSizes({ modelId: selection.modelId }), where);
    return selection;
  };

  return {
    async prepare(target) {
      const selection = await select(target.provider, target.model);
      return { providerId: selection.providerId, modelId: selection.modelId, sizes: pixelSizes(selection.model) };
    },

    resources: (target) => imageCallResources(catalog, target),

    async upscale(request) {
      let selection: GenerationSelection<'generateImage'>;
      let parameters: ImageParameters;
      try {
        selection = await select(request.providerId, request.modelId);
        const frozen = await freezeImageInput({ source: 'file', path: request.image });
        const checked = imageParameters(
          selection,
          {
            prompt: request.prompt,
            images: [request.image],
            imageMode: 'ref',
            count: 1,
            size: request.size,
            ...(selection.model.formats.includes('png') ? { format: 'png' as const } : {}),
          },
          [frozen],
        );
        parameters = selection.providerId === 'local' ? { ...checked, seed: localImageSeed(checked.seed) } : checked;
      } catch (error) {
        throw stepError(error, request.providerId);
      }
      return await runImageCall(grants, selection, parameters, request);
    },
  };
}
