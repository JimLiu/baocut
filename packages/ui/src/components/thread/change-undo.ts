import { RpcError, isEngineErrorBody, newId, type FileTarget, type Id } from '@baocut/protocol';
import type { BaoCutClient } from '@baocut/client';

export interface BackgroundUndoDeps {
  request: BaoCutClient['request'];
  /**
   * 这个窗口的编辑器此刻占着这个视频（正在打开它，或已经开着）。是的话撤销完不替它关：
   * Runtime 按连接记谁打开了视频，同一条连接上关一次，编辑器那边的打开也跟着没了。
   */
  editorHolds: (target: FileTarget, videoId: Id) => boolean;
}

export type BackgroundUndoResult =
  /** 撤销了：`transactionId` 是新写下的补偿事务。 */
  | { kind: 'undone'; transactionId: Id }
  /** 之前已经撤销过了（别的窗口、或 Agent 自己撤的）：`transactionId` 是那一笔撤销。 */
  | { kind: 'already-undone'; transactionId: Id };

/**
 * 视频没在编辑器里开着时撤销变更卡的那一笔：在后台打开视频、按事务撤销、再关掉（命令与协议规范 §8 的 `{ transaction }` 目标）。
 * 撤销冲突（之后又改过同一批对象）由引擎判断，原样抛给调用方。
 *
 * 未验证：后台打开期间编辑器恰好开始打开同一个视频时，这里的关闭可能先于编辑器的打开落到 Runtime，
 * 编辑器会收到 `video.closed` 再自己重新打开（video-controller 已处理），画面闪一下，不丢数据。
 */
export async function undoInBackground(deps: BackgroundUndoDeps, target: FileTarget, transaction: Id): Promise<BackgroundUndoResult> {
  const { ref } = await deps.request('videos.open', target);
  try {
    const { receipt } = await deps.request('edits.undo', { videoId: ref.videoId, commandId: newId('cmd'), target: { transaction } });
    return { kind: 'undone', transactionId: receipt.transactionId };
  } catch (error) {
    const undoneBy = alreadyUndoneBy(error);
    if (undoneBy) return { kind: 'already-undone', transactionId: undoneBy };
    throw error;
  } finally {
    if (!deps.editorHolds(target, ref.videoId)) await deps.request('videos.close', { videoId: ref.videoId }).catch(() => {});
  }
}

/** 引擎的 `UNDO_UNAVAILABLE`「这次修改已经撤销过」带着撤销它的那一笔（`details.undoneBy`）。 */
export function alreadyUndoneBy(error: unknown): Id | null {
  if (!(error instanceof RpcError) || !isEngineErrorBody(error.details)) return null;
  const body = error.details;
  if (body.code !== 'UNDO_UNAVAILABLE') return null;
  const by = (body.details as { undoneBy?: unknown } | null | undefined)?.undoneBy;
  return typeof by === 'string' && by ? by : null;
}
