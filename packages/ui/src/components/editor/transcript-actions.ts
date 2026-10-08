import type { Rate, TransactionReceipt } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import type { RetimePlan } from '../../model/cut-bands.ts';
import type { CutPlan, RestorePlan } from '../../model/transcript-cut.ts';
import { CUT_BAND_COPY } from './cut-band-copy.ts';
import type { EditorActions } from './editor-context.tsx';
import { TRANSCRIPT_COPY as C } from './transcript-copy.ts';

/**
 * 文稿面板与时间线剪口共用的提交：一笔事务，落地后给一条带「撤销」的提示。引擎拒绝（轨道锁着 `TARGET_LOCKED`、
 * 重叠等）时由编辑器统一报错，这里不再说一遍。做不到的（模型层先算出来的）照实说为什么。
 */

type Actions = Pick<EditorActions, 'apply' | 'undo'>;

function undoable(actions: Actions, receipt: TransactionReceipt, message: string) {
  ToastQueue.positive(message, {
    timeout: 5000,
    actionLabel: C.undo,
    onAction: () => void actions.undo({ transaction: receipt.transactionId }),
    shouldCloseOnAction: true,
  });
}

export async function applyCut(actions: Actions, plan: CutPlan, fps: Rate): Promise<boolean> {
  if (!plan.ok) {
    ToastQueue.neutral(plan.reason === 'nothing' ? C.cutNothing : C.cutTooShort, { timeout: 4000 });
    return false;
  }
  const receipt = await actions.apply(plan.operations, C.cutLabel);
  if (!receipt) return false;
  undoable(actions, receipt, C.cutDone((plan.frames * fps.den) / fps.num, plan.ranges.length));
  return true;
}

/**
 * 恢复是新的一笔事务，不是撤销（AT-08）：之后加的补充画面不受影响。剪口找不到接缝、只从剪口集合里去掉的（回执的
 * `cutsNotRelaid`），补一句说明。
 */
export async function applyRestore(actions: Actions, plan: RestorePlan): Promise<boolean> {
  if (!plan.ok) {
    ToastQueue.neutral(C.restoreRefused[plan.reason], { timeout: 6000 });
    return false;
  }
  const receipt = await actions.apply(plan.operations, C.restoreLabel);
  if (!receipt) return false;
  const done = C.restoreDone(plan.seconds);
  undoable(actions, receipt, receipt.impact.cutsNotRelaid?.length ? `${done} · ${C.restoreNotRelaid}` : done);
  return true;
}

/**
 * 拖剪口带的边改剪切范围（原型 editor-cuts.jsx 的 `retime`）：恢复这一处 + 剪新区间是一笔事务，撤销一步回去；
 * 拖到零宽就是恢复，照恢复说。`before` 是原来剪掉的长度（秒）。
 */
export async function applyRetime(actions: Actions, plan: RetimePlan | null, fps: Rate, before: number): Promise<boolean> {
  if (!plan) return false;
  if (!plan.ok) {
    ToastQueue.neutral(C.restoreRefused[plan.reason], { timeout: 6000 });
    return false;
  }
  if (plan.frames === 0) return applyRestore(actions, plan.restore);
  const receipt = await actions.apply(plan.operations, CUT_BAND_COPY.retimeLabel);
  if (!receipt) return false;
  undoable(actions, receipt, CUT_BAND_COPY.retimed(before, (plan.frames * fps.den) / fps.num));
  return true;
}

// ---- 文稿的查找替换、复制、换章与剪章（设计稿 panels.jsx `TranscriptPanel`、`ParaRow`、`ScopeMenu`） ----
// 这个文件只往后加：新用到的导入写在这里。

import type { EditOperation } from '@baocut/protocol';
import type { ChapterCutRefusal, ChapterSpan, ParagraphMove } from '../../model/chapters.ts';
import { TRANSCRIPT_TOOLS_COPY as T } from './transcript-copy.ts';

/** 放进剪贴板：成功时说复制了什么（`done`；null 时不弹，由调用方自己表示，如导出预览的对勾），浏览器拒绝时照实说。 */
export async function copyToClipboard(text: string, done: string | null): Promise<boolean> {
  if (!text.trim()) {
    ToastQueue.neutral(T.copyEmpty, { timeout: 3000 });
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ToastQueue.negative(T.copyFailed, { timeout: 5000 });
    return false;
  }
  if (done !== null) ToastQueue.positive(done, { timeout: 3000 });
  return true;
}

/** 查找替换：几份转写各写一个新版本（`putDocument`），放在同一笔事务里，一次撤销。音画不动。 */
export async function applyTextReplace(actions: Actions, operations: EditOperation[], count: number): Promise<boolean> {
  if (!operations.length || !count) {
    ToastQueue.neutral(T.replaceNothing, { timeout: 3000 });
    return false;
  }
  const receipt = await actions.apply(operations, T.replaceLabel);
  if (!receipt) return false;
  undoable(actions, receipt, T.replaceDone(count));
  return true;
}

/** 把一段挪到相邻章：挪的是那一条章节边界（`upsertChapter`），同侧的邻居一起走。挪不了的由调用方先说清楚。 */
export async function applyParagraphMove(actions: Actions, move: ParagraphMove): Promise<boolean> {
  const receipt = await actions.apply([move.operation], T.moveLabel);
  if (!receipt) return false;
  undoable(actions, receipt, T.moved(move.to.title, move.moved));
  return true;
}

/** 剪掉一章：`removeRange` + 删标记 + 后面的章前移，一笔事务。 */
export async function applyChapterCut(
  actions: Actions,
  chapter: ChapterSpan,
  plan: { ok: true; operations: EditOperation[]; frames: number } | { ok: false; reason: ChapterCutRefusal },
  fps: Rate,
): Promise<boolean> {
  if (!plan.ok) {
    ToastQueue.neutral(T.cutChapterRefused[plan.reason], { timeout: 5000 });
    return false;
  }
  const receipt = await actions.apply(plan.operations, T.cutChapterLabel);
  if (!receipt) return false;
  undoable(actions, receipt, T.cutChapterDone(chapter.title, (plan.frames * fps.den) / fps.num));
  return true;
}
