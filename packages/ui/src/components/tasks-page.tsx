import type { Id } from '@baocut/protocol';
import { Content, Heading, IllustratedMessage } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TASK_VIEW_COPY } from '../copy.ts';
import { taskGroups } from '../model/task-list.ts';
import { TaskCard } from './tasks/task-card.tsx';
import { TaskDetail } from './tasks/task-detail.tsx';
import { useTaskRows } from './tasks/use-task-rows.ts';
import { useNow } from './use-now.ts';
import { UtilityPage } from './utility-page.tsx';

/** 原型 `.t-section` 与 `.tasks`。 */
const sectionTitle = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-600', margin: 0, marginTop: { default: 0, isLater: 28 } });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 });
const empty = style({ marginTop: 12 });

/**
 * 后台任务（原型 page-tasks.jsx、产品设计 §2.1 用户修订）：Agent 会话里的任务与转录、配音、生成这些 Job 合成一张表，
 * 分「进行中 / 已完成」两节；选一条看详情。任务属于会话或视频，这里只是汇总。
 */
export function TasksPage({ taskId }: { taskId?: Id }) {
  return taskId ? <TaskDetail taskId={taskId} /> : <TaskList />;
}

function TaskList() {
  const { rows, ready } = useTaskRows();
  const [active, history] = taskGroups(rows);
  // 在跑的每秒刷新（「已进行」与进度）；都结束了只需让「多久前」慢慢走。
  const now = useNow(active.items.length ? 1000 : 30_000);

  return (
    <UtilityPage kind="tasks" title={TASK_VIEW_COPY.pageTitle}>
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
            <Heading>{TASK_VIEW_COPY.emptyHistory}</Heading>
          </IllustratedMessage>
        </div>
      ) : null}
    </UtilityPage>
  );
}
