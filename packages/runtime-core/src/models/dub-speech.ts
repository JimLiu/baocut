import crypto from 'node:crypto';
import path from 'node:path';
import {
  PipelineStepError,
  libraryVoice,
  localLibraryVoice,
  type DubSpeech,
  type DubVoice,
  type JobLibrary,
  type PipelineDefinition,
} from '@baocut/jobs';
import {
  ProviderFailure,
  builtinReferenceFile,
  checkReferenceTranscript,
  freezeReferenceFile,
  frozenVoiceOf,
  planLocalVoice,
  speechParameters,
  type GenerationSelection,
  type LocalSpeechFreeze,
  type LocalVoicePlan,
  type ModelServices,
  type SpeechParameters,
} from '@baocut/models';
import {
  RpcError,
  estimateCallCost,
  refOf,
  type FrozenSpeechReference,
  type Localized,
  type GrantDataKind,
  type JobSubmitter,
  type SpeechFormat,
  type SynthesizeSpeechRequest,
} from '@baocut/protocol';
import type { GrantService } from '../grants/grant-service.ts';
import { RcModels } from '@baocut/protocol/messages/runtime-core';
import { localizedOf } from '../localized.ts';

/**
 * 翻译配音的逐句合成（架构设计 §7.9）：流程在进程内调用语音合成的 Provider，不经 JobManager 的提交，所以选择、参数检查、
 * 库里音色的换算与授权都在这里：
 *
 * - 启动时选定 Provider 与模型（§6.2），按模型检查音色、语言与格式（与 `models.synthesizeSpeech` 同一份 `speechParameters`）；
 *   格式优先 WAV（对齐按采样数算，不受 MP3 编码延迟的影响）；
 * - 在线 Provider 上，`library:<id>` 每次调用都重新换成这个 Provider 上的有效克隆（克隆在两次调用之间可能过期或被删）；
 * - 本地模型按 `models.synthesizeSpeech` 的规则冻结声音（§5.9、§6.1），在启动与每次重试时冻结一次、之后逐句共用：内置音色读出
 *   随应用分发的录音的摘要（读不出时拒绝）；音色库的音色直接用条目的参考录音与它记下的摘要（不要克隆，也不要本人声明），
 *   每句先查库里还在，种子随 `DubVoice` 冻结；
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
  /**
   * 本地模型冻结的声音，按 Provider、模型与音色记：启动、重试与说话人绑定的检查（`prepare`）各重新冻结一份（音色库的条目可能
   * 改过），之后的句子共用这一份；没有时（Runtime 重启后接着跑）第一句冻结。冻结失败不留下：装好、改好之后重新读。
   */
  const frozenVoices = new Map<string, Promise<LocalVoice>>();
  const localVoice = (selection: GenerationSelection<'synthesizeSpeech'>, speech: SynthesizeSpeechRequest, refresh: boolean) => {
    const plan = planLocalVoice(selection, speech);
    const libraryId = plan.mode === 'clone' && plan.source === 'library' ? plan.libraryId : null;
    // 库里删了的音色每句都报 `VOICE_NOT_FOUND`（与在线 Provider 每次换算克隆一样）；还在时照用冻结的录音。
    if (!refresh && libraryId !== null && library) inLibrary(speech.voice!, () => library.get({ library: 'voices', id: libraryId }));
    const key = [selection.providerId, selection.modelId, frozenVoiceOf(plan)].join('\0');
    const cached = refresh ? undefined : frozenVoices.get(key);
    if (cached) return cached;
    const frozen = freezeLocalVoice(library, selection, plan);
    frozenVoices.set(key, frozen);
    frozen.catch(() => {
      if (frozenVoices.get(key) === frozen) frozenVoices.delete(key);
    });
    return frozen;
  };
  /**
   * 冻结一次调用的参数：在线 Provider 的 `library:<id>` 换成克隆的 voiceId；本地模型的声音见 `localVoice`。`voice` 为 null 是
   * 启动（与重试）时的检查，本地模型的声音在这时重新冻结。
   */
  const parameters = async (
    selection: GenerationSelection<'synthesizeSpeech'>,
    voice: DubVoice | null,
    request: { text: string; voice?: string; language: string; format?: SpeechFormat; seed?: number },
  ): Promise<{ parameters: SpeechParameters; local: LocalVoice | null }> => {
    const speech: SynthesizeSpeechRequest = {
      text: request.text,
      language: request.language,
      ...(request.voice !== undefined ? { voice: request.voice } : {}),
      ...(voice ? { format: voice.format } : request.format ? { format: request.format } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    };
    if (selection.model.local) {
      const local = await localVoice(selection, speech, voice === null);
      return { parameters: speechParameters(selection, speech, local), local };
    }
    const resolved = voiceFromLibrary(library, request.voice, selection.providerId);
    return { parameters: speechParameters(selection, resolved ? { ...speech, voice: resolved.voiceId } : speech), local: null };
  };

  return {
    async prepare(target) {
      const selection = await select(target.provider, target.model);
      const model = selection.model;
      const format = FORMAT_PREFERENCE.find((f) => model.formats.includes(f));
      if (!format) throw new RpcError('invalid-request', RcModels.noAlignableFormat({ modelId: selection.modelId }), { formats: model.formats });
      // 用一句占位的文本检查音色、语言与格式（文本本身逐句检查）；本地模型的参考录音在这里读出摘要，读不出时拒绝。
      const checked = await parameters(selection, null, {
        text: '.',
        language: target.language,
        format,
        ...(target.voice !== undefined ? { voice: target.voice } : {}),
      });
      // 音色库的音色交给收种子的本地模型：种子随音色冻结（§5.9），每句、每次重试都用同一颗。
      const local = checked.local;
      const fromLibrary = local?.plan.mode === 'clone' && local.plan.source === 'library';
      const seed = local && fromLibrary && model.acceptsSeed ? (local.seed ?? crypto.randomInt(0, 2 ** 32)) : null;
      return {
        providerId: selection.providerId,
        modelId: selection.modelId,
        voice: target.voice ?? checked.parameters.voice,
        format,
        maxInputChars: model.maxInputChars,
        acceptsSeed: model.acceptsSeed,
        ...(seed !== null ? { seed } : {}),
      };
    },

    async synthesize(request) {
      const { voice } = request;
      let selection: GenerationSelection<'synthesizeSpeech'>;
      let frozen;
      try {
        selection = await select(voice.providerId, voice.modelId);
        // 种子：句级重配的优先，其次音色冻结的。冻结时已经按模型检查过；模型后来不接受了时不传（`speechParameters` 会拒绝）。
        const chosen = request.seed ?? voice.seed;
        const seed = chosen !== undefined && selection.model.acceptsSeed ? { seed: chosen } : {};
        frozen = (await parameters(selection, voice, { text: request.text, voice: voice.voice, language: request.language, ...seed })).parameters;
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

/** 本地模型冻结的声音；`seed` 是音色库的音色给这个模型记的种子（其次兜底的），别的声音与没有记的 null。 */
type LocalVoice = LocalSpeechFreeze & { seed: number | null };

/**
 * 本地模型的声音按 `models.synthesizeSpeech` 的规则冻结（架构设计 §5.9、§6.1）：音色库条目直接用它的参考录音（本机不上传，不要
 * 克隆，也不要本人声明）；克隆模型的内置音色是随应用分发的录音，读出摘要与长度，读不出时 `APP_FILE_MISSING`（安装不完整）。
 * 模型不读原文时不带原文。执行前由本地 Provider 按摘要再核对，变了或读不出时这句失败，不换声音。
 */
async function freezeLocalVoice(
  library: JobLibrary | undefined,
  selection: GenerationSelection<'synthesizeSpeech'>,
  plan: LocalVoicePlan,
): Promise<LocalVoice> {
  const model = selection.model;
  const withTranscript = model.local?.reference?.acceptsTranscript ?? false;
  let reference: FrozenSpeechReference | null = null;
  let seed: number | null = null;
  if (plan.mode === 'clone' && plan.source === 'library') {
    const voice = inLibrary(`library:${plan.libraryId}`, () =>
      localLibraryVoice(library, plan.libraryId, withTranscript, PIPELINE_SUBMITTER, selection.modelId),
    );
    reference = voice.reference;
    seed = voice.seed;
  } else {
    const builtin = builtinReferenceFile(model, plan);
    if (builtin) reference = await freezeReferenceFile({ ...builtin, transcript: withTranscript ? builtin.transcript : null });
  }
  checkReferenceTranscript(model, reference?.transcript);
  return { plan, reference, seed };
}

/** `library:<id>` 换成在线 Provider 上的克隆。 */
function voiceFromLibrary(library: JobLibrary | undefined, voice: string | undefined, providerId: string) {
  return inLibrary(String(voice), () => libraryVoice(library, voice, providerId, PIPELINE_SUBMITTER));
}

/** 读音色库；库里删了的音色报 `VOICE_NOT_FOUND`（配音按说话人逐句报告时要与别的失败分开）。 */
function inLibrary<T>(voice: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof RpcError && error.code === 'not-found') {
      throw new RpcError('not-found', RcModels.voiceRemoved({ reason: localizedOf(error), voice }), { code: 'VOICE_NOT_FOUND', library: 'voices', reason: 'removed' });
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
      case 'tool-unavailable':
        // 参考录音转换要的 ffmpeg 找不到或不能运行：外部工具的问题，不是录音读不出来。
        return new PipelineStepError('MEDIA_TOOL_UNAVAILABLE', error.message, { ...details, providerId });
      case 'input-unreadable':
        // 冻结的参考录音执行前读不出或变了；随应用分发的（内置音色的录音）读不出来是安装不完整。
        return new PipelineStepError(code === 'APP_FILE_MISSING' ? 'APP_FILE_MISSING' : 'ASSET_MISSING', error.message, { ...details, providerId });
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
