import type { Id } from '@baocut/protocol';
import { TASK_PILL_COPY, TASK_VIEW_COPY } from '../copy.ts';
import { agoLabel } from './format.ts';
import type { TaskRow } from './task-list.ts';

/**
 * 任务胶囊与悬停卡（原型 model-task-pill.js）。一条不变量：**胶囊上的「+N」与卡片里的行是同一张表**。
 * 胶囊念表头那一条，「+N」是其余的条数；卡片把整张表画出来，最多 CARD_MAX 行，余下一句「还有 N 个」。
 *
 * 原型的「这个项目」在这里是编辑器打开的视频（`videoId`）：Job 记着它的视频，Agent 任务属于会话、没有视频，
 * 所以 `mineOnly` 时 Agent 任务不进胶囊（它就在旁边的会话里）。
 */

export const CARD_MAX = 5;

export interface PillOptions {
  /** 编辑器打开的视频。 */
  videoId?: Id | null;
  /** 只报这个视频的任务。 */
  mineOnly?: boolean;
  /** 正在看的那条任务详情，排最前。 */
  focusId?: Id | null;
}

const isMine = (row: TaskRow, videoId: Id | null | undefined) => !!videoId && row.videoId === videoId;

/**
 * 胶囊与卡片共用的那张表：活着的任务（在跑、排队、等批准），这个视频的导出不进表（导出按钮自己念进度）。
 * 排序：正在看的那条 → 这个视频的 → 其余在跑的 → 排队的；同档后起的在前。
 */
export function pillList(rows: readonly TaskRow[], options: PillOptions = {}): TaskRow[] {
  const { videoId, mineOnly, focusId } = options;
  const rank = (row: TaskRow) => {
    if (focusId && row.id === focusId) return 0;
    if (isMine(row, videoId)) return 1;
    return row.queued ? 3 : 2;
  };
  return rows
    .filter((row) => row.live)
    .filter((row) => !(isMine(row, videoId) && row.kind === 'export'))
    .filter((row) => !mineOnly || isMine(row, videoId))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || Date.parse(b.row.startedAt) - Date.parse(a.row.startedAt) || a.index - b.index)
    .map(({ row }) => row);
}

/** 右侧那一格：百分比 / 排队中 / 需要你确认 / 正在停止；不确定进度时为空。 */
export function pillState(row: TaskRow): string {
  if (row.waiting) return TASK_VIEW_COPY.awaitingApproval;
  if (row.queued) return TASK_VIEW_COPY.queued;
  if (row.origin === 'task' && !row.action) return row.label;
  return row.pct == null ? '' : `${row.pct}%`;
}

/** 胶囊上的字：`转录 · 37%`。 */
export function pillLabel(row: TaskRow): string {
  const tail = pillState(row);
  return tail ? `${row.kindText} · ${tail}` : row.kindText;
}

export interface PillFace {
  head: TaskRow;
  label: string;
  more: number;
}

/** 胶囊的样子：表头那一条 ＋ 其余条数；表空时不画。 */
export function pillFace(list: readonly TaskRow[]): PillFace | null {
  const head = list[0];
  if (!head) return null;
  return { head, label: pillLabel(head), more: list.length - 1 };
}

export interface PillCardRow {
  id: Id;
  title: string;
  detail: string;
  meta: string;
  state: string;
  /** 数字是确定进度；`indet` 转圈；null 不画（排队、等批准）。 */
  progress: number | 'indet' | null;
  cancellable: boolean;
}

/** 卡片的一行。 */
export function pillRow(row: TaskRow, videoId: Id | null | undefined, now: number): PillCardRow {
  // 不到一分钟（与 `agoLabel` 的「刚刚」同一条线）写「刚开始」，不靠比对显示文字。
  const justStarted = Math.max(0, now - Date.parse(row.startedAt)) < 60_000;
  const when = justStarted ? TASK_PILL_COPY.justStarted : TASK_PILL_COPY.startedAt(agoLabel(row.startedAt, now));
  return {
    id: row.id,
    title: row.title || row.kindText,
    detail: [row.phase, row.where].filter(Boolean).join(' · '),
    meta: [row.queued ? null : when, isMine(row, videoId) ? TASK_PILL_COPY.mine : null].filter(Boolean).join(' · '),
    state: pillState(row),
    progress: row.queued || row.waiting ? null : (row.pct ?? 'indet'),
    cancellable: row.action !== null,
  };
}

export interface PillCard {
  multi: boolean;
  title: string | null;
  rows: PillCardRow[];
  overflow: number;
}

/** 整张卡：单条时是那一条的详情；多条时是计数头 ＋ 行表 ＋ 溢出一句。 */
export function pillCard(list: readonly TaskRow[], videoId: Id | null | undefined, now: number): PillCard {
  return {
    multi: list.length > 1,
    title: list.length > 1 ? TASK_PILL_COPY.count(list.length) : null,
    rows: list.slice(0, CARD_MAX).map((row) => pillRow(row, videoId, now)),
    overflow: Math.max(0, list.length - CARD_MAX),
  };
}
