import path from 'node:path';
import { PipelineStepError, type ImageEditor } from '@baocut/jobs';
import {
  ProviderFailure,
  freezeImageInput,
  imageParameters,
  localImageSeed,
  type GenerationSelection,
  type ModelServices,
} from '@baocut/models';
import { CAPABILITY_DATA_KINDS, RpcError, estimateCallCost, refOf, type GrantDataKind, type ImageModelInfo, type Localized } from '@baocut/protocol';
import { JobsEditImage as J } from '@baocut/protocol/messages/jobs/edit-image.ts';
import type { GrantService } from '../grants/grant-service.ts';

/**
 * 图片编辑的 AI 修补（架构设计 §7.9）：流程在进程内调用生成图片的 Provider（同配音的逐句合成），所以选择、参数检查、输入图冻结
 * 与授权都在这里：
 *
 * - 启动时选定 Provider 与模型（§6.2）；模型要能按提示词改图（`referenceImages.edit`），否则 `IMAGE_EDIT_UNSUPPORTED`；
 * - 每次调用冻结一张输入图（流程写在 staging 里的那一块），按模型支持的尺寸里比例最接近的一个出一张，格式优先 PNG；
 * - 在线 Provider 每次调用预留一次授权与预算、结束时结算，外发的数据种类同生成图片；本机与节点的 Provider 不经授权；
 * - Provider 的失败换成步骤的错误码（同生成任务）。
 */

/** 改图外发的数据：同生成图片。 */
export const IMAGE_EDIT_DATA_KINDS: GrantDataKind[] = [...CAPABILITY_DATA_KINDS.generateImage];

export function imageEditor(options: { services: ModelServices; grants: GrantService }): ImageEditor {
  const { services, grants } = options;
  const select = async (provider?: string, model?: string) => {
    const selection = await services.selectGeneration('generateImage', {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
    });
    if (!selection.model.referenceImages?.edit) {
      throw new RpcError('invalid-request', J.editUnsupported({ modelId: selection.modelId }), {
        code: 'IMAGE_EDIT_UNSUPPORTED',
        providerId: selection.providerId,
        modelId: selection.modelId,
      });
    }
    return selection;
  };

  return {
    async prepare(target) {
      const selection = await select(target.provider, target.model);
      return { providerId: selection.providerId, modelId: selection.modelId };
    },

    async edit(request) {
      let selection: GenerationSelection<'generateImage'>;
      let parameters;
      try {
        selection = await select(request.providerId, request.modelId);
        const model = selection.model;
        const frozen = await freezeImageInput({ source: 'file', path: request.image });
        const size = closestSize(model, request.width, request.height);
        const checked = imageParameters(
          selection,
          {
            prompt: request.prompt,
            images: [request.image],
            imageMode: 'ref',
            count: 1,
            ...(size ? { size } : {}),
            ...(model.formats.includes('png') ? { format: 'png' as const } : {}),
          },
          [frozen],
        );
        parameters = selection.providerId === 'local' ? { ...checked, seed: localImageSeed(checked.seed) } : checked;
      } catch (error) {
        throw stepError(error, request.providerId);
      }
      let settle: ((outcome: { state: 'completed' | 'failed' }) => void) | null = null;
      if (selection.kind !== 'local' && selection.kind !== 'node') {
        grants.ensureDefault(selection.providerId, selection.label, 'generateImage');
        try {
          settle = await grants.begin({
            recipient: selection.providerId,
            dataKinds: IMAGE_EDIT_DATA_KINDS,
            videoId: null,
            taskId: null,
            estimate: estimateCallCost(selection.model.price, { count: 1 }),
            label: selection.label,
            jobId: request.jobId,
          });
        } catch (error) {
          throw stepError(error, request.providerId);
        }
      }
      try {
        const attempt = await selection.generator.generate(
          {
            jobId: request.jobId,
            attempt: 1,
            providerId: selection.providerId,
            modelId: selection.modelId,
            parameters,
            staging: request.staging,
          },
          { generating: () => {}, progress: () => {} },
          request.signal,
        );
        if (attempt.outcome === 'cancelled') throw request.signal.reason ?? new DOMException('aborted', 'AbortError');
        const output = attempt.outputs[0];
        if (attempt.outputs.length !== 1 || !output) throw localizedStepError('MODEL_OUTPUT_INVALID', J.modelOutputCount({ count: attempt.outputs.length }));
        const file = path.resolve(request.staging, output.path);
        const relative = path.relative(request.staging, file);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
          throw localizedStepError('MODEL_OUTPUT_INVALID', J.modelOutputOutsideStaging());
        }
        settle?.({ state: 'completed' });
        return { file };
      } catch (error) {
        settle?.({ state: 'failed' });
        if (request.signal.aborted) throw error;
        throw stepError(error, request.providerId);
      }
    },
  };
}

/**
 * 模型支持的尺寸里比例最接近 `width`×`height` 的一个；比例一样时取像素多的（至多 2048×2048）。模型不列尺寸时 null（由供应商定）。
 */
export function closestSize(model: Pick<ImageModelInfo, 'sizes'>, width: number, height: number): string | null {
  const target = Math.log(width / height);
  let best: { size: string; diff: number; area: number } | null = null;
  for (const size of model.sizes) {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) continue;
    const w = Number(match[1]);
    const h = Number(match[2]);
    const area = w * h;
    if (area > 2048 * 2048) continue;
    const diff = Math.round(Math.abs(Math.log(w / h) - target) * 1000);
    if (!best || diff < best.diff || (diff === best.diff && area > best.area)) best = { size, diff, area };
  }
  return best?.size ?? null;
}

function localizedStepError(code: string, message: Localized): PipelineStepError {
  return Object.assign(new PipelineStepError(code, message.text), { messageRef: refOf(message) });
}

/** Provider 的失败与提交时的拒绝换成步骤的错误（错误码同生成任务）。 */
function stepError(error: unknown, providerId: string): unknown {
  if (error instanceof PipelineStepError) return error;
  if (error instanceof ProviderFailure) {
    const { code, ...details } = error.details;
    switch (error.kind) {
      case 'rejected':
        return new PipelineStepError(typeof code === 'string' ? code : 'PROVIDER_REJECTED', error.message, { ...details, providerId });
      case 'unavailable-remote':
        return new PipelineStepError('PROVIDER_UNAVAILABLE', error.message, { ...details, providerId });
      case 'protocol':
        return new PipelineStepError('MODEL_OUTPUT_INVALID', error.message, { ...details, providerId });
      case 'output-unwritable':
        return new PipelineStepError('STAGING_WRITE_FAILED', error.message, { ...details, providerId });
      case 'input-unreadable':
        return new PipelineStepError('ASSET_MISSING', error.message, { ...details, providerId });
      case 'unavailable':
      case 'load-failed':
        return new PipelineStepError(typeof code === 'string' ? code : 'MODEL_LOAD_FAILED', error.message, { ...details, providerId });
      default:
        return new PipelineStepError('INTERNAL', error.message, { ...details, providerId });
    }
  }
  if (error instanceof RpcError) {
    const details = (error.details ?? {}) as Record<string, unknown>;
    const code = typeof details.code === 'string' ? details.code : error.code === 'invalid-request' ? 'PROVIDER_REJECTED' : 'INTERNAL';
    return new PipelineStepError(code, error.message, details);
  }
  return error;
}
