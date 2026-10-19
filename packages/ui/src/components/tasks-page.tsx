import type { Id } from '@baocut/protocol';
import { ActionButton, Content, Heading, IllustratedMessage, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TASK_VIEW_COPY } from '../copy.ts';
import { clearedUpTo } from '../model/task-list.ts';
import { useTaskHistory } from '../state/task-history-store.ts';
import { TaskCard } from './tasks/task-card.tsx';
import { TaskDetail } from './tasks/task-detail.tsx';
import { useTaskSections } from './tasks/use-task-sections.ts';
import { useNow } from './use-now.ts';
import { UtilityPage } from './utility-page.tsx';

/** 原型 `.t-section` 与 `.tasks`。 */
const sectionTitle = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-600', margin: 0, marginTop: { default: 0, isLater: 28 } });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 });
const empty = style({ marginTop: 12 });
const older = style({ marginTop: 8 });

/**
 * 后台任务（原型 page-tasks.jsx、产品设计 §2.1 用户修订）：Agent 会话里的任务与转录、配音、生成这些 Job 合成一张表，
 * 分「进行中 / 已完成」两节；选一条看详情。任务属于会话或视频，这里只是汇总。已完成只列最近的，可以清空（§6.1）。
 */
export function TasksPage({ taskId }: { taskId?: Id }) {
  return taskId ? <TaskDetail taskId={taskId} /> : <TaskList />;
}

function TaskList() {
  // 历史按分钟重算：30 天的界线走得慢，不必跟着每秒的计时重排。
  const { ready, active, history, view } = useTaskSections(useNow(60_000));
  // 在跑的每秒刷新（「已进行」与进度）；都结束了只需让「多久前」慢慢走。
  const now = useNow(active.items.length ? 1000 : 30_000);
  const showAll = useTaskHistory((s) => s.showAll);
  const setShowAll = useTaskHistory((s) => s.setShowAll);

  // 清空历史（产品设计 §6.1）：不确认，提示里给撤销；只决定列表里显示什么。
  const clear = () => {
    const before = useTaskHistory.getState().clearedAt;
    const upTo = clearedUpTo(view.clearable);
    if (upTo === null) return;
    useTaskHistory.getState().setClearedAt(upTo);
    ToastQueue.neutral(TASK_VIEW_COPY.historyCleared(view.clearable.length), {
      timeout: 6000,
      actionLabel: TASK_VIEW_COPY.undo,
      shouldCloseOnAction: true,
      onAction: () => useTaskHistory.getState().setClearedAt(before),
    });
  };

  return (
    <UtilityPage
      kind="tasks"
      title={TASK_VIEW_COPY.pageTitle}
      actions={
        view.clearable.length ? (
          <ActionButton isQuiet size="S" onPress={clear}>
            {TASK_VIEW_COPY.clearHistory}
          </ActionButton>
        ) : null
      }
    >
      <h2 className={sectionTitle({})}>{TASK_VIEW_COPY.activeSection}</h2>
      {active.items.length ? (
        <div className={list}>
          {active.items.map((row) => (
            <TaskCard key={row.id} row={row} now={now} />
          ))}
        </div>
      ) : ready ? (
        <div className={empty}>
          <IllustratedMessage size="S">
            <Heading>{TASK_VIEW_COPY.emptyActive}</Heading>
            <Content>{TASK_VIEW_COPY.emptyActiveBody}</Content>
          </IllustratedMessage>
        </div>
      ) : null}
      <h2 className={sectionTitle({ isLater: true })}>{TASK_VIEW_COPY.historySection}</h2>
      {history.items.length ? (
        <div className={list}>
          {history.items.map((row) => (
            <TaskCard key={row.id} row={row} now={now} />
          ))}
        </div>
      ) : ready ? (
        <div className={empty}>
          <IllustratedMessage size="S">
            <Heading>{view.older ? TASK_VIEW_COPY.emptyRecentHistory : TASK_VIEW_COPY.emptyHistory}</Heading>
          </IllustratedMessage>
        </div>
      ) : null}
      {view.older ? (
        <div className={older}>
          <ActionButton isQuiet size="S" onPress={() => setShowAll(!showAll)}>
            {showAll ? TASK_VIEW_COPY.hideOlder : TASK_VIEW_COPY.showOlder(view.older)}
          </ActionButton>
        </div>
      ) : null}
    </UtilityPage>
  );
}
