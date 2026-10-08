import {
  RpcError,
  type FrozenLibraryEntry,
  type FrozenSpeechReference,
  type JobLibraryUse,
  type JobSubmitter,
  type Localized,
  type TranscriptionGlossary,
} from '@baocut/protocol';
import {
  composeTranscribeHint,
  parseLibraryVoice,
  resolveVoiceClone,
  type LibraryStore,
} from '@baocut/runtime-storage/library';
import { JobsLibrary as J } from '@baocut/protocol/messages/jobs/job-library.ts';

/**
 * 任务用到的用户库（架构设计 §5.9）：提交时读出条目、冻结版本与摘要；任务进行期间固定这些版本，结束时解除。
 * 库只经这几个方法访问。
 *
 * 解析放在 JobManager 里，网关、智能体工具与对外服务走同一条路。对外服务的客户端（MCP、模型接口服务，
 * `submitter.kind === 'service'`）不能引用用户库：库是本机用户的数据，按最小暴露不对外部程序开放，
 * 以 `invalid-request` + `LIBRARY_ENTRY_NOT_APPLICABLE` 拒绝，不创建任务。
 */
export type JobLibrary = Pick<LibraryStore, 'get' | 'pin' | 'unpin' | 'filePath'>;

function assertLibraryOpenTo(submitter: JobSubmitter, message: () => Localized): void {
  if (submitter.kind !== 'service') return;
  // 与 `libraryError` 同形（`details.code` + 原因），文字带着消息引用。
  throw new RpcError('invalid-request', message(), { code: 'LIBRARY_ENTRY_NOT_APPLICABLE', reason: 'service-client' });
}

/**
 * 识别用术语表进入转写提示。模型接受提示时规范写法接在用户的提示之后（合计不超过 1200 字符）；
 * 不接受时忽略术语表，在 `glossaryHint.status` 里说明。翻译用术语表不能用于识别。
 */
export function transcribeGlossaries(
  library: JobLibrary | undefined,
  refs: { id: string; version?: number }[],
  userHint: string | null,
  acceptsHint: boolean,
  submitter: JobSubmitter,
): { hint: string | null; use: JobLibraryUse } {
  assertLibraryOpenTo(submitter, J.serviceNoGlossaries);
  if (!library) throw new RpcError('invalid-request', J.noLibraryForGlossaries());
  const entries: FrozenLibraryEntry[] = [];
  const glossaries: TranscriptionGlossary[] = [];
  for (const ref of refs) {
    const entry = library.get({ library: 'glossaries', id: ref.id, ...(ref.version !== undefined ? { version: ref.version } : {}) });
    if (entry.content.kind !== 'transcription') {
      throw new RpcError('invalid-request', J.translationGlossary({ name: entry.content.name }), {
        code: 'LIBRARY_ENTRY_NOT_APPLICABLE',
        library: 'glossaries',
        id: entry.id,
      });
    }
    entries.push({ library: 'glossaries', id: entry.id, version: entry.version, contentHash: entry.contentHash });
    glossaries.push(entry.content);
  }
  if (!acceptsHint) {
    const total = new Set(glossaries.flatMap((g) => g.terms.map((t) => t.canonical))).size;
    return { hint: userHint, use: { entries, glossaryHint: { status: 'unsupported', terms: 0, dropped: total } } };
  }
  const composed = composeTranscribeHint(userHint ?? undefined, glossaries);
  return {
    hint: composed.hint ?? null,
    use: { entries, glossaryHint: { status: 'sent', terms: composed.terms, dropped: composed.dropped } },
  };
}

/** `library:<id>` 音色在所选 Provider 上的克隆；不是库里的音色时 null。没有有效克隆时抛 `VOICE_CLONE_REQUIRED`。 */
export function libraryVoice(
  library: JobLibrary | undefined,
  voice: string | undefined,
  providerId: string,
  submitter: JobSubmitter,
): { voiceId: string; use: JobLibraryUse } | null {
  const id = parseLibraryVoice(voice);
  if (id === null) return null;
  assertLibraryOpenTo(submitter, J.serviceNoVoices);
  if (!library) throw new RpcError('invalid-request', J.noLibraryForVoices());
  const resolved = resolveVoiceClone(library.get({ library: 'voices', id }), providerId);
  return { voiceId: resolved.voiceId, use: { entries: [resolved.entry] } };
}

/**
 * 本地合成直接用音色库条目的参考录音（不上传，不需要克隆，也不需要出站授权）：冻结条目的版本与录音的摘要，
 * 执行时由本地 Provider 按摘要再核对一次。`withTranscript` 为 false（模型不读原文）时不带原文。
 */
export function localLibraryVoice(
  library: JobLibrary | undefined,
  id: string,
  withTranscript: boolean,
  submitter: JobSubmitter,
): { reference: FrozenSpeechReference; use: JobLibraryUse } {
  assertLibraryOpenTo(submitter, J.serviceNoVoices);
  if (!library) throw new RpcError('invalid-request', J.noLibraryForVoices());
  const voice = library.get({ library: 'voices', id });
  const file = voice.content.reference;
  const transcript = withTranscript && voice.content.transcript.trim() ? voice.content.transcript.trim() : null;
  return {
    reference: { source: 'library', path: library.filePath(voice, file), sha256: file.sha256, byteLength: file.byteLength, transcript },
    use: { entries: [{ library: 'voices', id: voice.id, version: voice.version, contentHash: voice.contentHash }] },
  };
}
