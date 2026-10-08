import type { Logger } from '@baocut/harness';
import { TaskFailure, canonicalJson, sha256Hex, type JobManager, type TaskRun } from '@baocut/jobs';
import { ProviderFailure } from '@baocut/models';
import {
  RpcError,
  refOf,
  type FrozenLibraryEntry,
  type GrantDataKind,
  type Id,
  type JobRecord,
  type JobSubmitter,
  type LibraryEntry,
  type VoiceCloneCreateParams,
  type VoiceCloneRemoveParams,
  type VoiceCloneRemoveResult,
} from '@baocut/protocol';
import type { VoiceCloner } from '@baocut/providers';
import { assertVoiceUploadAllowed, libraryError, type LibraryStore } from '@baocut/runtime-storage/library';
import { outboundPurpose, type GrantService } from '../grants/grant-service.ts';
import { RcLibrary } from '@baocut/protocol/messages/runtime-core';
import { localizedOf, taskFailure, withLocalized, withMessageRef } from '../localized.ts';

/** 克隆外发的数据：参考录音。 */
export const VOICE_CLONE_DATA_KINDS: GrantDataKind[] = ['audio'];

/** 克隆任务记录里的「模型」：克隆不是某个模型的调用。 */
const CLONE_MODEL_ID = 'voice-clone';

/** 删除远端克隆的期限。 */
const REMOVE_TIMEOUT_MS = 60_000;

export interface VoiceCloneServiceOptions {
  store: LibraryStore;
  jobs: JobManager;
  grants: GrantService;
  /** 一个 Provider 的克隆接口；没有克隆接口（或不认识这个 Provider）时 null。 */
  cloner(providerId: string): VoiceCloner | null;
  log: Logger;
}

/**
 * 音色克隆（架构设计 §5.9）：`library.createVoiceClone` 与 `library.removeVoiceClone`。
 *
 * - 创建是一个普通任务（`kind: 'voiceClone'`），进度、取消与失败都在任务里。提交时依次检查：授权声明
 *   （`VOICE_CONSENT_REQUIRED`）、Provider 有没有克隆接口（`VOICE_CLONE_UNSUPPORTED`）、是否启用、已有的有效克隆
 *   （`VOICE_CLONE_EXISTS`）、数据外发的授权与额度（数据种类 `audio`，§12.5）。不通过时不建任务。
 * - 执行时固定提交时的版本，再查一次授权声明，按授权预留、上传、结算；建好之后记进条目的 `clones[providerId]`，
 *   记的是上传的那份参考录音的摘要，上传期间参考录音改了时直接是 `stale`。替换下来的过期克隆随后请求远端删除，
 *   删不掉时留一条告警（带它的 `voiceId`），不让任务失败。
 * - 删除先请求远端、成功（或远端已经没有）才清掉记录；远端失败时记录保留，以 Provider 的错误码报告。
 */
export class VoiceCloneService {
  readonly #options: VoiceCloneServiceOptions;

  constructor(options: VoiceCloneServiceOptions) {
    this.#options = options;
  }

  async create(params: VoiceCloneCreateParams, submitter: JobSubmitter): Promise<{ jobId: Id }> {
    const { store, jobs, grants } = this.#options;
    if (submitter.kind === 'service') {
      throw withLocalized(
        libraryError('LIBRARY_ENTRY_NOT_APPLICABLE', 'invalid-request', '', { reason: 'service-client' }),
        RcLibrary.serviceClientNoLibraryVoice(),
      );
    }
    const entry = store.get({ library: 'voices', id: params.id });
    assertVoiceUploadAllowed(entry, params.providerId);
    const cloner = this.#cloner(params.providerId);
    if (!cloner.available()) {
      throw new RpcError('conflict', RcLibrary.clonerNotConfigured({ label: cloner.label }), {
        code: 'CAPABILITY_NOT_CONFIGURED',
        providerId: params.providerId,
      });
    }
    const existing = entry.clones?.[params.providerId];
    if (existing?.state === 'valid' && existing.referenceHash === entry.content.reference.sha256) {
      throw withLocalized(
        libraryError('VOICE_CLONE_EXISTS', 'conflict', '', { library: 'voices', id: entry.id, providerId: params.providerId }),
        RcLibrary.cloneExists({ name: entry.content.name, label: cloner.label }),
      );
    }
    const taskId = submitter.kind === 'agent' ? submitter.taskId : null;
    // 提交前的判断：没有授权覆盖、额度不够时不建任务。审批只在会话与对外服务里，这里直接拒绝（与 `models.*` 一致）。
    const plan = grants.plan({
      capability: 'synthesizeSpeech',
      providerId: params.providerId,
      videoId: null,
      taskId,
      dataKinds: VOICE_CLONE_DATA_KINDS,
      ...outboundPurpose(RcLibrary.clonePurpose({ name: entry.content.name })),
    });
    if (plan.status === 'approval') {
      grants.assertCovered(
        { recipient: plan.item.recipient, dataKinds: VOICE_CLONE_DATA_KINDS, videoId: null, taskId, estimate: plan.item.estimate },
        cloner.label,
      );
    }
    const frozen: FrozenLibraryEntry = { library: 'voices', id: entry.id, version: entry.version, contentHash: entry.contentHash };
    const spec = { task: 'voiceClone' as const, ...frozen, library: 'voices' as const, providerId: params.providerId };
    const inputHash = `sha256:${sha256Hex(canonicalJson(spec))}`;
    // 同一个音色、同一个 Provider、同一个版本的克隆还在排队或进行时，返回那个任务。
    const active = jobs
      .list()
      .find((job) => job.kind === 'voiceClone' && job.inputHash === inputHash && (job.state === 'queued' || job.state === 'running'));
    if (active) return { jobId: active.jobId };
    const name = params.name ?? entry.content.name;
    return jobs.submitTask(
      {
        kind: 'voiceClone',
        spec,
        videoId: null,
        contentHash: entry.content.reference.sha256,
        inputHash,
        providerId: params.providerId,
        modelId: CLONE_MODEL_ID,
        extra: { library: { entries: [frozen] } },
        ...(params.commandId ? { commandId: params.commandId } : {}),
        queue: { key: `voice-clone:${params.providerId}`, concurrency: 1 },
        run: (run) => this.#run(run, frozen, params.providerId, name, taskId),
      },
      submitter,
    );
  }

  async remove(params: VoiceCloneRemoveParams): Promise<VoiceCloneRemoveResult> {
    const { store, log } = this.#options;
    const { clone } = store.cloneOf(params.id, params.providerId);
    if (!clone) throw new RpcError('not-found', RcLibrary.noClone());
    let remote: VoiceCloneRemoveResult['remote'] = 'skipped';
    if (!params.localOnly) {
      const cloner = this.#cloner(params.providerId);
      try {
        remote = await cloner.remove(clone.voiceId, AbortSignal.timeout(REMOVE_TIMEOUT_MS));
      } catch (error) {
        const failure = providerError(error, params.providerId);
        log.warn('Deleting the remote clone failed', { id: params.id, providerId: params.providerId, code: failure.code });
        throw new RpcError('conflict', RcLibrary.remoteCloneNotDeleted({ label: cloner.label, reason: localizedOf(failure) }), {
          ...failure.details,
          code: failure.code,
          id: params.id,
        });
      }
    }
    await store.removeClone(params.id, params.providerId);
    log.info('Voice clone deleted', { id: params.id, providerId: params.providerId, remote });
    return { removed: true, remote };
  }

  #cloner(providerId: string): VoiceCloner {
    const cloner = this.#options.cloner(providerId);
    if (cloner) return cloner;
    throw withLocalized(
      libraryError('VOICE_CLONE_UNSUPPORTED', 'invalid-request', '', { providerId }),
      RcLibrary.cloneUnsupported({ providerId }),
    );
  }

  async #run(
    run: TaskRun,
    frozen: FrozenLibraryEntry,
    providerId: string,
    name: string,
    taskId: Id | null,
  ): Promise<NonNullable<JobRecord['result']>> {
    const { store, grants, jobs, log } = this.#options;
    run.phase('starting');
    // 固定提交时的版本：排队期间条目被改、被删，上传的仍是提交时那一份；任务终结时由 JobManager 解除。
    let entry: LibraryEntry<'voices'>;
    try {
      store.pin(run.jobId, [frozen]);
      entry = store.get({ library: 'voices', id: frozen.id, version: frozen.version });
    } catch {
      throw taskFailure('LIBRARY_ENTRY_GONE', RcLibrary.cloneVersionGone(), { library: 'voices', id: frozen.id });
    }
    // 排队期间撤回了授权声明：不上传。
    try {
      assertVoiceUploadAllowed(this.#currentOrFrozen(entry), providerId);
    } catch (error) {
      if (error instanceof RpcError) throw withMessageRef(new TaskFailure('VOICE_CONSENT_REQUIRED', error.message, error.details), error);
      throw error;
    }
    const cloner = this.#cloner(providerId);
    let settle: Awaited<ReturnType<GrantService['begin']>>;
    try {
      grants.ensureDefault(providerId, cloner.label, 'synthesizeSpeech');
      settle = await grants.begin({
        recipient: providerId,
        dataKinds: VOICE_CLONE_DATA_KINDS,
        videoId: null,
        taskId,
        estimate: null,
        label: cloner.label,
        jobId: run.jobId,
      });
    } catch (error) {
      if (error instanceof RpcError) {
        const details = (error.details ?? {}) as Record<string, unknown>;
        throw withMessageRef(new TaskFailure(typeof details.code === 'string' ? details.code : 'GRANT_REQUIRED', error.message, details), error);
      }
      throw error;
    }
    const reference = entry.content.reference;
    const previous = store.cloneOf(frozen.id, providerId).clone;
    run.phase('generating');
    let voiceId: string;
    try {
      ({ voiceId } = await cloner.create({
        name,
        file: store.filePath(entry, reference),
        fileName: reference.fileName,
        mediaType: reference.mediaType,
        description: entry.content.language ? `BaoCut voice (${entry.content.language})` : null,
        signal: run.signal,
      }));
      settle({ state: 'completed' });
    } catch (error) {
      settle({ state: 'failed' });
      if (run.signal.aborted) throw error;
      const failure = providerError(error, providerId);
      throw new TaskFailure(failure.code, failure.message, failure.details);
    }
    run.phase('publishing');
    await store.recordClone(frozen.id, providerId, voiceId, reference.sha256);
    log.info('Voice clone created', { id: frozen.id, providerId, jobId: run.jobId });
    // 替换下来的旧克隆：请求远端删除，删不掉只告警（新克隆已经记下，旧的 voiceId 写在告警里）。
    if (previous && previous.voiceId !== voiceId) {
      try {
        await cloner.remove(previous.voiceId, AbortSignal.any([run.signal, AbortSignal.timeout(REMOVE_TIMEOUT_MS)]));
      } catch (error) {
        const failure = providerError(error, providerId);
        const detail = RcLibrary.oldCloneNotDeleted({ voiceId: previous.voiceId, label: cloner.label, reason: localizedOf(failure) });
        run.warn({ code: 'VOICE_CLONE_OLD_NOT_DELETED', detail: detail.text, detailRef: refOf(detail) });
      }
    }
    const receipt = {
      schema: 'baocut.voice-clone/1',
      voice: frozen,
      providerId,
      voiceId,
      referenceHash: reference.sha256,
      adapter: cloner.version,
    };
    const { artifactId } = await jobs.artifacts.put(Buffer.from(canonicalJson(receipt), 'utf8'));
    return { documentId: null, artifactId };
  }

  /** 授权声明以条目的当前版本为准（撤回声明是新版本）；条目删了时用固定的版本。 */
  #currentOrFrozen(frozen: LibraryEntry<'voices'>): LibraryEntry<'voices'> {
    try {
      return this.#options.store.get({ library: 'voices', id: frozen.id });
    } catch {
      return frozen;
    }
  }
}

/** Provider 的失败换成任务错误：错误码、说明（已经去掉密钥）与不含请求头和地址的详情。 */
function providerError(error: unknown, providerId: string): { code: string; message: string; details: Record<string, unknown> } {
  if (error instanceof ProviderFailure) {
    const { code, status, reason } = error.details;
    const fallback =
      error.kind === 'unavailable-remote'
        ? 'PROVIDER_UNAVAILABLE'
        : error.kind === 'protocol'
          ? 'MODEL_OUTPUT_INVALID'
          : 'PROVIDER_REJECTED';
    return {
      code: typeof code === 'string' ? code : fallback,
      message: error.message,
      details: {
        providerId,
        ...(typeof status === 'number' ? { status } : {}),
        ...(typeof reason === 'string' ? { reason } : {}),
      },
    };
  }
  if (error instanceof RpcError) {
    const details = (error.details ?? {}) as Record<string, unknown>;
    return { code: typeof details.code === 'string' ? details.code : 'PROVIDER_REJECTED', message: error.message, details: { providerId } };
  }
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error), details: { providerId } };
}
