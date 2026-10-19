import { useMemo } from 'react';
import { historyView, taskGroups, type HistoryView, type TaskGroup } from '../../model/task-list.ts';
import { useTaskHistory } from '../../state/task-history-store.ts';
import { useTaskRows } from './use-task-rows.ts';

export interface TaskSections {
  ready: boolean;
  active: TaskGroup;
  /** 这次列出的历史（`view.items`）。 */
  history: TaskGroup;
  view: HistoryView;
}

/**
 * 任务页与侧栏共用的两节（产品设计 §6.1）：进行中照列；历史只列最近 20 条、30 天内、没清空的，要用户决定的总是列出，
 * 展开时每次多列 50 条。
 * `now` 由调用方的计时给。
 */
export function useTaskSections(now: number): TaskSections {
  const { rows, ready } = useTaskRows();
  const clearedAt = useTaskHistory((s) => s.clearedAt);
  const more = useTaskHistory((s) => s.more);
  return useMemo(() => {
    const [active, history] = taskGroups(rows);
    const view = historyView(history.items, { now, clearedAt, more });
    return { ready, active, history: { ...history, items: view.items }, view };
  }, [rows, ready, now, clearedAt, more]);
}
