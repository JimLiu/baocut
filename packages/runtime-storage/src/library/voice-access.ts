import type { FrozenLibraryEntry, Id, LibraryEntry } from '@baocut/protocol';
import { libraryError } from './library-errors.ts';
import { RuntimeStorageLibrary as SL } from '@baocut/protocol/messages/runtime-storage';

/** 合成请求里指向音色库的写法：`library:<条目 ID>`。 */
export const LIBRARY_VOICE_PREFIX = 'library:';

export function parseLibraryVoice(voice: string | undefined): Id | null {
  return voice?.startsWith(LIBRARY_VOICE_PREFIX) ? voice.slice(LIBRARY_VOICE_PREFIX.length) : null;
}

/**
 * 出站授权（架构设计 §5.9、§12.5）：把这段声音上传给供应商（克隆）之前必须调用。没有授权声明时拒绝，
 * `conflict` + `VOICE_CONSENT_REQUIRED`：由用户在音色里补上声明后再试，不换一种办法绕过。
 */
export function assertVoiceUploadAllowed(voice: LibraryEntry<'voices'>, providerId: string): void {
  const { consent } = voice.content;
  if (consent.declared && consent.declaredAt) return;
  throw libraryError(
    'VOICE_CONSENT_REQUIRED',
    'conflict',
    SL.voiceConsentRequired({ name: voice.content.name, provider: providerId }),
    { library: 'voices', id: voice.id, providerId },
  );
}

/**
 * `library:<id>` 在一个 Provider 上的音色：用它的有效克隆。没有克隆、或克隆已过期（参考录音变了、条目删了）时拒绝，
 * `conflict` + `VOICE_CLONE_REQUIRED`（`details.reason`：`missing`、`stale`）：先创建克隆再合成。
 */
export function resolveVoiceClone(voice: LibraryEntry<'voices'>, providerId: string): { voiceId: string; entry: FrozenLibraryEntry } {
  // 撤回了授权声明的声音，已有的克隆也不再使用。
  assertVoiceUploadAllowed(voice, providerId);
  const clone = voice.clones?.[providerId];
  const entry: FrozenLibraryEntry = { library: 'voices', id: voice.id, version: voice.version, contentHash: voice.contentHash };
  if (clone && clone.state === 'valid' && clone.referenceHash === voice.content.reference.sha256) return { voiceId: clone.voiceId, entry };
  const reason = clone ? 'stale' : 'missing';
  throw libraryError(
    'VOICE_CLONE_REQUIRED',
    'conflict',
    clone
      ? SL.voiceCloneStale({ name: voice.content.name, provider: providerId })
      : SL.voiceCloneMissing({ name: voice.content.name, provider: providerId }),
    { library: 'voices', id: voice.id, providerId, reason },
  );
}
