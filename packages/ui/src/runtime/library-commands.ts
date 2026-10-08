import {
  newId,
  type AssetRecord,
  type Id,
  type LibraryApplyParams,
  type LibraryApplyResult,
  type LibraryEntry,
  type LibraryEntryRef,
  type LibraryExportResult,
  type LibraryName,
  type LibraryPutParams,
  type MediaHandle,
} from '@baocut/protocol';
import { entryKey } from '../model/library-entry.ts';
import { useVideo } from '../state/video-store.ts';
import type { RuntimeSession } from './session.ts';

/**
 * 用户库（架构设计 §5.9，`library.*`）的命令：设置 › 术语库与编辑器 › 品牌共用。条目列表来自 `library` 主题
 * （state/library-store），这里只放读写：读写本身用会话上的用户库方法，这里加上按版本的缓存与文件句柄复用；
 * 会话没有的 `library.applyToVideo` 在这里发。单独成文件，不把会话通道撑大。
 */

/** 条目某个版本的内容不会再变：按「库/ID@版本」记住（连同还在路上的请求，免得几处同时要同一条时重复发）。 */
const entries = new Map<string, Promise<LibraryEntry>>();
/** 文件句柄有期限：到期前 30 秒就不再用。 */
const handles = new Map<string, Promise<MediaHandle>>();
const HANDLE_MARGIN_MS = 30_000;

/** 读一条。带版本时走缓存；失败的不记，下次重取。 */
export function getLibraryEntry(session: RuntimeSession, ref: LibraryEntryRef): Promise<LibraryEntry> {
  if (ref.version === undefined) return session.getLibraryEntry(ref).then(remember);
  const key = entryKey({ library: ref.library, id: ref.id, version: ref.version });
  const cached = entries.get(key);
  if (cached) return cached;
  const pending = session.getLibraryEntry(ref);
  entries.set(key, pending);
  pending.catch(() => entries.delete(key));
  return pending;
}

function remember(entry: LibraryEntry): LibraryEntry {
  entries.set(entryKey(entry), Promise.resolve(entry));
  return entry;
}

/** 新建或修改。修改时带 `expectedVersion`：别处先改了就是 `LIBRARY_VERSION_CONFLICT`。 */
export async function putLibraryEntry(
  session: RuntimeSession,
  params: Omit<LibraryPutParams, 'commandId'>,
): Promise<{ entry: LibraryEntry; created: boolean; changed: boolean }> {
  const result = await session.putLibraryEntry(params);
  remember(result.entry);
  return result;
}

export function removeLibraryEntry(session: RuntimeSession, library: LibraryName, id: Id): Promise<void> {
  return session.removeLibraryEntry(library, id);
}

/** 从文件导入：Runtime 按内容认格式，决定进哪个库。 */
export async function importLibraryFile(session: RuntimeSession, path: string): Promise<LibraryEntry> {
  return remember(await session.importLibraryFile(path));
}

/** 导出到一个新文件；目标已存在时 Runtime 不覆盖（`conflict`）。 */
export function exportLibraryEntry(session: RuntimeSession, entry: LibraryEntryRef, path: string): Promise<LibraryExportResult> {
  return session.exportLibraryEntry(entry, path);
}

/** 带文件的条目（图片、视频、贴纸、字体）的读取地址；同一个版本在句柄到期前复用。 */
export function openLibraryHandle(session: RuntimeSession, ref: LibraryEntryRef & { version: number }): Promise<MediaHandle> {
  const key = entryKey(ref);
  const cached = handles.get(key);
  if (cached) return cached;
  const pending = session.openLibraryHandle(ref);
  handles.set(key, pending);
  pending.then(
    (handle) => {
      const left = Date.parse(handle.expiresAt) - Date.now() - HANDLE_MARGIN_MS;
      setTimeout(() => {
        if (handles.get(key) === pending) handles.delete(key);
      }, Math.max(0, Number.isFinite(left) ? left : 0));
    },
    () => handles.delete(key),
  );
  return pending;
}

/**
 * 把条目放进视频（拷一份，之后库里的改动不影响视频）。这一笔不经编辑器的命令队列，所以先等队列里的修改都有了结果；
 * 不给 `expectedRevision`，由 Runtime 用视频的当前版本。
 */
export async function applyLibraryEntry(
  session: RuntimeSession,
  params: Omit<LibraryApplyParams, 'commandId' | 'expectedRevision'>,
): Promise<LibraryApplyResult> {
  await session.videos.settled();
  return session.client.request('library.applyToVideo', { ...params, commandId: newId('cmd') });
}

/**
 * 等新导入的素材出现在编辑器的视频镜像里（视频主题的事件到了）。之后再提交放到时间线的修改，版本号就是新的。
 * 超时返回 null。
 */
export function waitForAsset(assetId: Id, timeoutMs = 5000): Promise<AssetRecord | null> {
  const find = () => useVideo.getState().video?.state?.video.assets[assetId] ?? null;
  const found = find();
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = useVideo.subscribe(() => {
      const asset = find();
      if (!asset) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(asset);
    });
  });
}
