import type { LibraryEntrySummary, LibraryExportResult, MediaHandle, VoiceCloneRemoveResult } from '@baocut/protocol';
import type { RuntimeSession } from '../../runtime/session.ts';
import {
  clonesToRemove,
  createVoiceRequest,
  editVoiceRequest,
  errorCode,
  rpcErrorText,
  type VoiceEntry,
  type VoiceForm,
} from '../../model/voices-library.ts';

/**
 * 我的声音的命令（架构设计 §5.9）：都经 `RuntimeSession` 的薄方法，列表的变化由 `library` 主题送回来，这里不改本地状态。
 * 克隆会把参考录音上传给第三方：只在用户确认之后调用（my-voices.tsx 里先弹告知）。
 */

type Session = Pick<
  RuntimeSession,
  | 'getLibraryEntry'
  | 'putLibraryEntry'
  | 'removeLibraryEntry'
  | 'importLibraryFile'
  | 'exportLibraryEntry'
  | 'openLibraryHandle'
  | 'createVoiceClone'
  | 'removeVoiceClone'
>;

export async function loadVoice(session: Session, id: string): Promise<VoiceEntry> {
  return (await session.getLibraryEntry({ library: 'voices', id })) as VoiceEntry;
}

/** 从一个音频文件新建。 */
export async function createVoice(session: Session, form: VoiceForm, path: string): Promise<VoiceEntry> {
  const { entry } = await session.putLibraryEntry(createVoiceRequest(form, path));
  return entry as VoiceEntry;
}

export type SaveOutcome = { kind: 'saved'; entry: VoiceEntry; changed: boolean } | { kind: 'conflict'; entry: VoiceEntry; message: string };

/**
 * 改名字、语言、逐字稿或声明。别处先改了（`LIBRARY_VERSION_CONFLICT`）时取回最新的一版交给对话框重新看，
 * 不拿新版本号自动重试——那样会悄悄盖掉别处的修改。
 */
export async function saveVoice(session: Session, form: VoiceForm, entry: VoiceEntry): Promise<SaveOutcome> {
  try {
    const result = await session.putLibraryEntry(editVoiceRequest(form, entry));
    return { kind: 'saved', entry: result.entry as VoiceEntry, changed: result.changed };
  } catch (error) {
    if (errorCode(error) !== 'LIBRARY_VERSION_CONFLICT') throw error;
    return { kind: 'conflict', entry: await loadVoice(session, entry.id), message: rpcErrorText(error) };
  }
}

export type DeleteOutcome =
  | { kind: 'deleted'; clones: { providerId: string; remote: VoiceCloneRemoveResult['remote'] }[] }
  /** 远端的克隆没删掉：音色没删（只删条目会把克隆留在对方账户里，界面上却再也找不到）。 */
  | { kind: 'clone-failed'; providerId: string; message: string };

/**
 * 删除一只音色：先逐个删掉它在各 Provider 上的克隆，都删掉了才删条目。某个远端删不掉时停下、不删条目。
 * `localOnly`：用户明确选了「只删本机记录」——克隆的记录只在本机清掉（对方账户里的克隆留着），再删条目。
 */
export async function deleteVoice(session: Session, voice: LibraryEntrySummary, localOnly = false): Promise<DeleteOutcome> {
  const clones: { providerId: string; remote: VoiceCloneRemoveResult['remote'] }[] = [];
  for (const providerId of clonesToRemove(voice)) {
    try {
      const result = await session.removeVoiceClone(voice.id, providerId, localOnly);
      clones.push({ providerId, remote: result.remote });
    } catch (error) {
      // 记录已经没有了（别处刚删掉）：当作删掉了。
      if ((error as { code?: unknown }).code === 'not-found') continue;
      return { kind: 'clone-failed', providerId, message: rpcErrorText(error) };
    }
  }
  await session.removeLibraryEntry('voices', voice.id);
  return { kind: 'deleted', clones };
}

/** 导入一个音色包（`.bcvoice`，Runtime 按内容识别）。 */
export async function importVoicePackage(session: Session, path: string): Promise<VoiceEntry> {
  return (await session.importLibraryFile(path)) as VoiceEntry;
}

/** 导出成音色包；目标已存在时 Runtime 不覆盖（`conflict`），原样抛出。 */
export async function exportVoice(session: Session, voice: LibraryEntrySummary, path: string): Promise<LibraryExportResult> {
  return session.exportLibraryEntry({ library: 'voices', id: voice.id }, path);
}

/** 在一个 Provider 上建克隆：上传参考录音，返回任务 ID。 */
export async function cloneVoice(session: Session, voice: LibraryEntrySummary, providerId: string): Promise<string> {
  return session.createVoiceClone(voice.id, providerId);
}

/** 删掉一个克隆：先删远端，删不掉时以 Provider 的错误码报告；`localOnly` 只清本机记录。 */
export async function removeClone(session: Session, voice: LibraryEntrySummary, providerId: string, localOnly = false): Promise<VoiceCloneRemoveResult> {
  return session.removeVoiceClone(voice.id, providerId, localOnly);
}

/** 试听要的地址：手里的还没到期（留 30 秒余量）就接着用，否则重新要一个。 */
export async function auditionHandle(session: Session, voice: LibraryEntrySummary, cached: MediaHandle | null, now = Date.now()): Promise<MediaHandle> {
  if (cached && Date.parse(cached.expiresAt) - now > 30_000) return cached;
  return session.openLibraryHandle({ library: 'voices', id: voice.id });
}
