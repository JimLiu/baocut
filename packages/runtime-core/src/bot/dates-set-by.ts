import type { DateSetBy, WorkItem } from '@baocut/protocol';

/**
 * 记下截止日与事件日是谁定的（BOT-TK-06）：日期变了就记成这次的 `by`，清掉就一起清掉；没变的不动。
 * 新建时（`before` 为 undefined）已经带了 `*By` 的照留（界面新建传 `user`）。
 */
export function datesSetBy(before: WorkItem | undefined, next: WorkItem, by: DateSetBy): WorkItem {
  const out = { ...next };
  for (const [date, key] of [
    ['dueOn', 'dueOnBy'],
    ['eventOn', 'eventOnBy'],
  ] as const) {
    if (!out[date]) delete out[key];
    else if (before ? out[date] !== before[date] : !out[key]) out[key] = by;
  }
  return out;
}
