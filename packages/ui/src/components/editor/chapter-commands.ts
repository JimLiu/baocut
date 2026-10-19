import type { Sequence, TransactionReceipt } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ToastQueue } from '@react-spectrum/s2';
import {
  addChapterOperation,
  moveChapterOperation,
  removeChapterOperation,
  renameChapterOperation,
  sequenceChapters,
  type ChapterSpan,
} from '../../model/chapters.ts';
import { CHAPTER_COPY as C } from './chapter-copy.ts';
import type { EditorActions } from './editor-context.tsx';

/**
 * 章节的编辑命令：章节条、右键菜单与文稿章节头行共用。每一步是一笔编辑事务（`apply`），撤销栈上有名字；
 * 加、改名、删除之后出带「撤销」的提示，撤的是这一笔（不是栈顶）。
 * 章节条上拖起点与拖片段边缘一样，不出提示；片条上拖边界出（`moveChapter` 的 `message`）。
 */

const TOAST_MS = 2500;

/** 上一条带撤销的提示：新的一条出来时收掉旧的（S2 带操作的提示不会自己消失）。 */
let closeUndoToast: (() => void) | null = null;

function undoToast(actions: EditorActions, message: string, receipt: TransactionReceipt): void {
  closeUndoToast?.();
  const close = ToastQueue.positive(message, {
    actionLabel: C.undo,
    onAction: () => void actions.undo({ transaction: receipt.transactionId }),
    shouldCloseOnAction: true,
    onClose: () => {
      if (closeUndoToast === close) closeUndoToast = null;
    },
  });
  closeUndoToast = close;
}

export async function addChapter(actions: EditorActions, sequence: Sequence, frame: number, title: string): Promise<boolean> {
  const result = addChapterOperation(sequence, sequenceChapters(sequence), frame, title);
  if (!result.ok) {
    ToastQueue.neutral(C.refusal[result.reason], { timeout: TOAST_MS });
    return false;
  }
  const receipt = await actions.apply([result.operation], EditLabel.addChapter());
  if (receipt) undoToast(actions, C.added(title.trim()), receipt);
  return !!receipt;
}

export async function renameChapter(actions: EditorActions, sequence: Sequence, chapter: ChapterSpan, title: string): Promise<boolean> {
  const operation = renameChapterOperation(sequence.id, chapter, title);
  if (!operation) return false;
  const receipt = await actions.apply([operation], EditLabel.renameChapter());
  if (receipt) undoToast(actions, C.renamed(title.trim()), receipt);
  return !!receipt;
}

export async function removeChapter(actions: EditorActions, sequence: Sequence, chapter: ChapterSpan): Promise<boolean> {
  const receipt = await actions.apply([removeChapterOperation(sequence.id, chapter)], EditLabel.removeChapter());
  if (receipt) undoToast(actions, C.removed(chapter.title), receipt);
  return !!receipt;
}

/**
 * 挪起点（调用方已按 `startBounds` / `chipEdge` 夹好）。章节条上拖起点不出提示；片条上拖边界给 `message`，
 * 出一条带「撤销」的提示（轻量编辑器设计 §3.2）。
 */
export async function moveChapter(
  actions: EditorActions,
  sequence: Sequence,
  chapter: ChapterSpan,
  frame: number,
  message?: string,
): Promise<boolean> {
  const operation = moveChapterOperation(sequence.id, chapter, frame);
  if (!operation) return false;
  const receipt = await actions.apply([operation], EditLabel.moveChapter());
  if (receipt && message) undoToast(actions, message, receipt);
  return !!receipt;
}
