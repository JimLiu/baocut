import { newId, type MediaHandle, type PetApplyParams, type PetApplyResult, type PetHandleParams } from '@baocut/protocol';
import { petRefKey } from '../model/codex-pets.ts';
import type { RuntimeSession } from './session.ts';

/**
 * Codex Pets（`pets.*`）的命令：元素面板画格子要的读取地址，与把一只贴进视频。句柄按 pet 与文件记住，到期前 30 秒就不再用；
 * 取失败的不记，下次再试。
 */
const handles = new Map<string, Promise<MediaHandle>>();
const HANDLE_MARGIN_MS = 30_000;

export function openPetHandle(session: RuntimeSession, params: PetHandleParams): Promise<MediaHandle> {
  const key = `${petRefKey(params.pet)}:${params.file}`;
  const cached = handles.get(key);
  if (cached) return cached;
  const pending = session.client.request('pets.openHandle', params);
  handles.set(key, pending);
  pending.then(
    (handle) => {
      const left = Date.parse(handle.expiresAt) - Date.now() - HANDLE_MARGIN_MS;
      setTimeout(
        () => {
          if (handles.get(key) === pending) handles.delete(key);
        },
        Math.max(0, Number.isFinite(left) ? left : 0),
      );
    },
    () => handles.delete(key),
  );
  return pending;
}

/** 贴进视频：同 `applySticker`，先等编辑器队列里的修改都有了结果。 */
export async function applyPet(session: RuntimeSession, params: Omit<PetApplyParams, 'commandId'>): Promise<PetApplyResult> {
  await session.videos.settled();
  return session.client.request('pets.applyToVideo', { ...params, commandId: newId('cmd') });
}
