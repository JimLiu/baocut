import { newId, type MediaHandle, type StickerApplyParams, type StickerApplyResult } from '@baocut/protocol';
import type { RuntimeSession } from './session.ts';

/**
 * 随包贴纸（`stickers.*`）的命令：元素面板画缩略图要的读取地址，与把一张拷进视频。句柄按贴纸 ID 记住，到期前 30 秒就不再用。
 */
const handles = new Map<string, Promise<MediaHandle>>();
const HANDLE_MARGIN_MS = 30_000;

export function openStickerHandle(session: RuntimeSession, id: string): Promise<MediaHandle> {
  const cached = handles.get(id);
  if (cached) return cached;
  const pending = session.client.request('stickers.openHandle', { id });
  handles.set(id, pending);
  pending.then(
    (handle) => {
      const left = Date.parse(handle.expiresAt) - Date.now() - HANDLE_MARGIN_MS;
      setTimeout(
        () => {
          if (handles.get(id) === pending) handles.delete(id);
        },
        Math.max(0, Number.isFinite(left) ? left : 0),
      );
    },
    () => handles.delete(id),
  );
  return pending;
}

/** 拷进视频：这一笔不经编辑器的命令队列，所以先等队列里的修改都有了结果；不给 `expectedRevision`，由 Runtime 用当前版本。 */
export async function applySticker(
  session: RuntimeSession,
  params: Omit<StickerApplyParams, 'commandId' | 'expectedRevision'>,
): Promise<StickerApplyResult> {
  await session.videos.settled();
  return session.client.request('stickers.applyToVideo', { ...params, commandId: newId('cmd') });
}
