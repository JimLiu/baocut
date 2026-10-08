import path from 'node:path';
import { PipelineStepError, libraryVoice, type DubSpeech, type DubVoice, type JobLibrary, type PipelineDefinition } from '@baocut/jobs';
import { ProviderFailure, speechParameters, type GenerationSelection, type ModelServices } from '@baocut/models';
import { RpcError, estimateCallCost, refOf, type Localized, type GrantDataKind, type JobSubmitter, type SpeechFormat } from '@baocut/protocol';
import type { GrantService } from '../grants/grant-service.ts';
import { RcModels } from '@baocut/protocol/messages/runtime-core';
import { localizedOf } from '../localized.ts';

/**
 * 翻译配音的逐句合成（架构设计 §7.9）：流程在进程内调用语音合成的 Provider，不经 JobManager 的提交，所以选择、参数检查、
 * 库里音色的换算与授权都在这里：
 *
 * - 启动时选定 Provider 与模型（§6.2），按模型检查音色、语言与格式（与 `models.synthesizeSpeech` 同一份 `speechParameters`）；
 *   格式优先 WAV（对齐按采样数算，不受 MP3 编码延迟的影响）；
 * - `library:<id>` 每次调用都重新换成这个 Provider 上的有效克隆（克隆在两次调用之间可能过期或被删）；
 * - 每次调用（含重发）各预留一次授权与预算、结束时结算；外发的是译文（`transcript`）。本机与节点的 Provider 不经授权；
 * - Provider 的失败换成任务的错误码（与生成任务相同）。
 */

/** 配音外发的数据：要合成的译文。 */
export const DUB_DATA_KINDS: GrantDataKind[] = ['transcript'];

const FORMAT_PREFERENCE: SpeechFormat[] = ['wav', 'flac', 'mp3'];
/** 库里的音色只给本机的用户用（与 `models.synthesizeSpeech` 的会话提交同等）。 */
const PIPELINE_SUBMITTER: JobSubmitter = { kind: 'pipeline', id: 'dub' };

export function dubSpeech(options: { services: ModelServices; grants: GrantService; library: JobLibrary | undefined }): DubSpeech {
  const { services, grants, library } = options;
  const select = (provider?: string, model?: string) =>
    services.selectGeneration('synthesizeSpeech', {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
    });
  /** 冻结一次调用的参数；`library:<id>` 换成克隆的 voiceId。 */
  const parameters = (
    selection: GenerationSelection<'synthesizeSpeech'>,
    voice: DubVoice | null,
    request: { text: string; voice?: string; language: string; format?: SpeechFormat; seed?: number },
  ) => {
    const resolved = voiceFromLibrary(library, request.voice, selection.providerId);
    return speechParameters(selection, {
      text: request.text,
      language: request.language,
      ...(resolved ? { voice: resolved.voiceId } : request.voice !== undefined ? { voice: request.voice } : {}),
      ...(voice ? { format: voice.format } : request.format ? { format: request.format } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    });
  };

  return {
    async prepare(target) {
      const selection = await select(target.provider, target.model);
      const model = selection.model;
      const format = FORMAT_PREFERENCE.find((f) => model.formats.includes(f));
      if (!format) throw new RpcError('invalid-request', RcModels.noAlignableFormat({ modelId: selection.modelId }), { formats: model.formats });
      // 用一句占位的文本检查音色、语言与格式（文本本身逐句检查）。
      const checked = parameters(selection, null, {
        text: '.',
        language: target.language,
        format,
        ...(target.voice !== undefined ? { voice: target.voice } : {}),
      });
      return {
        providerId: selection.providerId,
        modelId: selection.modelId,
        voice: target.voice ?? checked.voice,
        format,
        maxInputChars: model.maxInputChars,
        acceptsSeed: model.acceptsSeed,
      };
    },

    async synthesize(request) {
      const { voice } = request;
      let selection: GenerationSelection<'synthesizeSpeech'>;
      let frozen;
      try {
        selection = await select(voice.providerId, voice.modelId);
        // 种子（句级重配）：冻结时已经按模型检查过；模型后来不接受了时不传（`speechParameters` 会拒绝）。
        const seed = request.seed !== undefined && selection.model.acceptsSeed ? { seed: request.seed } : {};
        frozen = parameters(selection, voice, { text: request.text, voice: voice.voice, language: request.language, ...seed });
      } catch (error) {
        throw stepError(error, voice.providerId);
      }
      let settle: ((outcome: { state: 'completed' | 'failed' }) => void) | null = null;
      if (selection.kind !== 'local' && selection.kind !== 'node') {
        grants.ensureDefault(selection.providerId, selection.label, 'synthesizeSpeech');
        try {
          settle = await grants.begin({
            recipient: selection.providerId,
            dataKinds: DUB_DATA_KINDS,
            videoId: request.videoId,
            taskId: null,
            estimate: estimateCallCost(selection.model.price, { chars: [...request.text].length }),
            label: selection.label,
            jobId: request.jobId,
          });
        } catch (error) {
          throw stepError(error, voice.providerId);
        }
      }
      try {
        const attempt = await selection.generator.generate(
          {
            jobId: request.jobId,
            attempt: 1,
            providerId: selection.providerId,
            modelId: selection.modelId,
            parameters: frozen,
            staging: request.staging,
          },
          { generating: () => {}, progress: () => {} },
          request.signal,
        );
        if (attempt.outcome === 'cancelled') throw request.signal.reason ?? new DOMException('aborted', 'AbortError');
        const output = attempt.outputs[0];
        if (attempt.outputs.length !== 1 || !output) {
          throw localizedStepError('MODEL_OUTPUT_INVALID', RcModels.synthOutputCount({ count: attempt.outputs.length }));
        }
        const file = path.resolve(request.staging, output.path);
        const relative = path.relative(request.staging, file);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
          throw localizedStepError('MODEL_OUTPUT_INVALID', RcModels.synthOutputOutsideStaging());
        }
        settle?.({ state: 'completed' });
        return { file };
      } catch (error) {
        settle?.({ state: 'failed' });
        if (request.signal.aborted) throw error;
        throw stepError(error, voice.providerId);
      }
    },
  };
}

/**
 * 配音被拒在授权上时的下一步（架构设计 §12.5、§14 已定）：Provider 启用时的默认授权不含文字稿（`transcript`），配音要把译文
 * （缺译文时还有原文）交出去，所以第一次配音会以 `GRANT_REQUIRED` 被拒。这里不放宽授权，只把补救说清楚：要发哪一条授权
 * （`remedy.commands` 已经是那条 `baocut grants create …`），发了之后重新执行。只改提示，错误码与其余细节不变。
 */
export function withDubGrantGuidance<P, R>(definition: PipelineDefinition<P, R>): PipelineDefinition<P, R> {
  return {
    ...definition,
    async prepare(params, options) {
      try {
        return await definition.prepare(params, options);
      } catch (error) {
        throw dubGrantError(error);
      }
    },
  };
}

export function dubGrantError(error: unknown): unknown {
  if (!(error instanceof RpcError)) return error;
  const details = error.details as
    { code?: unknown; recipient?: unknown; dataKinds?: unknown; remedy?: { hint?: unknown; commands?: unknown } } | undefined;
  if (
    details?.code !== 'GRANT_REQUIRED' ||
    !details.remedy ||
    !Array.isArray(details.dataKinds) ||
    !details.dataKinds.includes('transcript')
  ) {
    return error;
  }
  const hint = RcModels.dubGrantHint({ recipient: String(details.recipient) });
  return new RpcError(
    error.code,
    error.message,
    { ...details, remedy: { ...details.remedy, hint: hint.text, hintRef: refOf(hint) } },
    error.messageRef,
  );
}

/** 带消息引用的步骤错误（`PipelineStepError` 只收字符串，引用另挂在 `messageRef` 上）。 */
function localizedStepError(code: string, message: Localized): PipelineStepError {
  return Object.assign(new PipelineStepError(code, message.text), { messageRef: refOf(message) });
}

/** `library:<id>` 换成克隆；库里删了的音色报 `VOICE_NOT_FOUND`（配音按说话人逐句报告时要与别的失败分开）。 */
function voiceFromLibrary(library: JobLibrary | undefined, voice: string | undefined, providerId: string) {
  try {
    return libraryVoice(library, voice, providerId, PIPELINE_SUBMITTER);
  } catch (error) {
    if (error instanceof RpcError && error.code === 'not-found') {
      throw new RpcError('not-found', RcModels.voiceRemoved({ reason: localizedOf(error), voice: String(voice) }), { code: 'VOICE_NOT_FOUND', library: 'voices', reason: 'removed' });
    }
    throw error;
  }
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
