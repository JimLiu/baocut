import { useState, type ReactNode } from 'react';
import type { Id, JobReconcileDecision, JobRecord, TaskSummary } from '@baocut/protocol';
import { ActionButton, Button, Heading, IllustratedMessage, ProgressBar, Text, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TASK_VIEW_COPY } from '../../copy.ts';
import { exportSpeedParts } from '../../model/export-job.ts';
import { agoLabel } from '../../model/format.ts';
import { isLinkImport } from '../../model/link-import.ts';
import { jobRemedy, taskFacts } from '../../model/task-facts.ts';
import type { TaskRow } from '../../model/task-list.ts';
import { chargesOnRetry, reconcileOptions } from '../../model/task-reconcile.ts';
import { rerunOf, toolOfTask } from '../../model/tool-rerun.ts';
import { toolRunOf } from '../../model/tool-runs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useExportSpeed, useJobs } from '../../state/jobs-store.ts';
import { useLegacyImport } from '../../state/legacy-import-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTasks } from '../../state/tasks-store.ts';
import { AgentIcon } from '../agent-icon.tsx';
import { LegacyImportDetail } from '../legacy-import/legacy-import-task.tsx';
import { useNow } from '../use-now.ts';
import { UtilityPage } from '../utility-page.tsx';
import { LinkImportDetail } from './link-import-detail.tsx';
import { useOpenConversation } from './task-card.tsx';
import { TaskFacts, TaskImages, TaskOutputs, TaskSource } from './task-sections.tsx';
import { TK } from './tasks-copy.ts';
import { ToolRunPanel } from './tool-run-panel.tsx';
import { ToolTaskOutputs, ToolTaskRerun } from './tool-task-outputs.tsx';
import { useTaskRows } from './use-task-rows.ts';
import { actionTitle, useTaskAction } from './use-task-actions.ts';

const back = style({ alignSelf: 'start', marginBottom: 12 });
/** 标题下的状态行（原型 `[k.label, t.sub, t.started]`，与标题空 4）。UtilityPage 的标题下留 24，这里收回去。 */
const statusLine = style({ font: 'ui-sm', color: 'gray-600', marginTop: -20, marginBottom: 0 });
const progress = style({ maxWidth: 420, marginTop: 16 });
const phaseLine = style({ font: 'ui-sm', color: 'gray-600', marginTop: '[6px]', marginBottom: 0 });
const actionRow = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 });
const hint = style({ font: 'ui-sm', color: 'gray-600' });
const note = style({
  marginTop: 16,
  padding: 16,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isError: 'red-300' },
  backgroundColor: { default: 'gray-50', isError: 'red-100' },
});
const noteHead = style({ display: 'flex', alignItems: 'center', gap: 8 });
const noteIcon = style({ display: 'flex', flexShrink: 0, color: { default: 'gray-700', isError: 'red-900' } });
const noteTitle = style({ font: 'title-sm', color: { default: 'gray-900', isError: 'negative' }, overflowWrap: 'anywhere', minWidth: 0 });
const noteBody = style({ font: 'ui-sm', color: 'gray-600', marginTop: '[6px]' });
const noteActions = style({ display: 'flex', gap: 8, marginTop: 12 });

/** 任务详情（原型 page-tasks.jsx `TaskDetailPage`）：Agent 任务与 Job 共用一页，按 ID 先找任务再找 Job。 */
export function TaskDetail({ taskId }: { taskId: Id }) {
  const { rows, ready } = useTaskRows({ fold: false });
  const row = rows.find((r) => r.id === taskId);
  const job = useJobs((s) => s.jobs.find((j) => j.jobId === taskId));
  const task = useTasks((s) => s.tasks.find((t) => t.taskId === taskId));
  const legacyRun = useLegacyImport((s) => s.run);
  const go = useShell((s) => s.go);
  const backButton = (
    <ActionButton isQuiet size="S" styles={back} onPress={() => go({ tab: 'tasks' })}>
      <ChevronLeft />
      <Text>{TASK_VIEW_COPY.back}</Text>
    </ActionButton>
  );
  if (!row) {
    return (
      <UtilityPage kind="tasks" before={backButton} title={ready ? TASK_VIEW_COPY.notFound : undefined}>
        {ready ? (
          <IllustratedMessage size="S">
            <Heading>{TASK_VIEW_COPY.notFoundBody}</Heading>
          </IllustratedMessage>
        ) : null}
      </UtilityPage>
    );
  }
  // 导入旧版项目有自己的一页（计数、没导入的原因与补救、已导入 / 已跳过）。
  if (row.origin === 'legacy-import' && legacyRun) return <LegacyImportDetail row={row} run={legacyRun} backButton={backButton} />;
  // 从链接导入有自己的一页（三步、补救、下载工具）。
  if (job && isLinkImport(job) && !toolRunOf(job)) return <LinkImportDetail row={row} job={job} backButton={backButton} />;
  return <TaskDetailBody row={row} job={job} task={task} backButton={backButton} />;
}

function TaskDetailBody({ row, job, task, backButton }: { row: TaskRow; job?: JobRecord; task?: TaskSummary; backButton: ReactNode }) {
  const go = useShell((s) => s.go);
  const act = useTaskAction();
  const openConversation = useOpenConversation(row);
  const now = useNow(1000, row.live);
  const speed = exportSpeedParts(useExportSpeed(job?.jobId));
  const remedy = job ? jobRemedy(job) : null;
  const failed = job ? job.state === 'failed' : task?.status === 'failed';
  // 视频工具的运行（转录、翻译字幕、翻译配音）：步骤、停住的说明与重试都在 ToolRunPanel 里，不再另写一段失败说明。
  const toolRun = job ? toolRunOf(job) : null;
  // 工具页的直接任务与文件转码：失败原因写在「重试」上面，「重试 / 再做一次」回到参数已经填好的工具页（产品设计 §2.7）。
  const rerun = job ? rerunOf(job) : null;
  const refill = rerun?.mode === 'refill' ? rerun : null;
  const actionHint =
    row.action?.type === 'stop' ? TASK_VIEW_COPY.stopHint : row.kind === 'export' ? TASK_VIEW_COPY.cancelExportHint : null;

  return (
    <UtilityPage kind="tasks" before={backButton} title={row.title}>
      <p className={statusLine}>{[row.kindText, row.where, agoLabel(row.startedAt, now)].filter(Boolean).join(' · ')}</p>
      {row.live && !row.queued && row.progress !== null ? (
        <div className={progress}>
          <ProgressBar
            size="S"
            aria-label={TK.progress(row.title, row.label)}
            isIndeterminate={row.progress === 'indet'}
            value={row.progress === 'indet' ? undefined : row.progress}
          />
        </div>
      ) : null}
      {row.live && row.phase ? <p className={phaseLine}>{[row.phase, ...speed].join(' · ')}</p> : null}
      {job && toolRun ? <ToolRunPanel job={job} tool={toolRun} /> : null}
      {row.action ? (
        <div className={actionRow}>
          <Button variant="negative" fillStyle="outline" size="M" onPress={() => act(row.action!)}>
            {actionTitle(row.action, row.kind)}
          </Button>
          {actionHint ? <span className={hint}>{actionHint}</span> : null}
        </div>
      ) : null}
      {openConversation ? (
        <div className={actionRow}>
          <Button variant="secondary" size="S" onPress={openConversation}>
            <AgentIcon />
            <Text>{TASK_VIEW_COPY.openConversation}</Text>
          </Button>
          <span className={hint}>{row.origin === 'job' ? TASK_VIEW_COPY.conversationHint : TASK_VIEW_COPY.agentTaskHint}</span>
        </div>
      ) : null}

      {job?.state === 'cancelled' || job?.state === 'interrupted' || job?.state === 'needs-reconciliation' ? (
        <div className={note({})}>
          <div className={noteHead}>
            <span className={noteIcon({})}>
              <InfoCircle />
            </span>
            <span className={noteTitle({})}>{row.label}</span>
          </div>
          <div className={noteBody}>
            {job.state === 'cancelled'
              ? TASK_VIEW_COPY.cancelledBody
              : job.state === 'interrupted'
                ? TASK_VIEW_COPY.interruptedBody
                : TASK_VIEW_COPY.needsReconciliationBody}
          </div>
        </div>
      ) : null}
      {failed && row.error && !toolRun && !refill ? (
        <div className={note({ isError: true })}>
          <div className={noteHead}>
            <span className={noteIcon({ isError: true })}>
              <AlertTriangle />
            </span>
            <span className={noteTitle({ isError: true })}>{row.error}</span>
          </div>
          {remedy ? (
            <>
              <div className={noteBody}>{remedy.hint}</div>
              <div className={noteActions}>
                <Button variant="accent" size="S" onPress={() => go(remedy.target)}>
                  {remedy.label}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {job && refill ? <ToolTaskRerun job={job} rerun={refill} error={failed ? row.error : null} remedy={failed ? remedy : null} /> : null}
      {job ? <ReconcileActions job={job} /> : null}

      <TaskSource job={job} task={task} />
      {job ? <TaskImages job={job} now={now} /> : null}
      <TaskFacts rows={taskFacts(row, { job, task }, now)} />
      {job && toolOfTask(job) ? (
        <ToolTaskOutputs job={job} fallback={<TaskOutputs job={job} />} />
      ) : job ? (
        <TaskOutputs job={job} />
      ) : null}
    </UtilityPage>
  );
}

const RECONCILE_LABEL: Record<JobReconcileDecision, string> = {
  retry: TASK_VIEW_COPY.reconcileRetry,
  discard: TASK_VIEW_COPY.reconcileDiscard,
  apply: TASK_VIEW_COPY.reconcileApply,
};

/** 对账的几个决定（`jobs.reconcile`，架构设计 §7.5）：每个一行，按钮旁写清后果。结果经 `jobs` 主题回来。 */
function ReconcileActions({ job }: { job: JobRecord }) {
  const runtime = useRuntime();
  const [busy, setBusy] = useState(false);
  const options = reconcileOptions(job);
  if (options.length === 0) return null;
  const decide = (decision: JobReconcileDecision) => {
    setBusy(true);
    runtime
      .reconcileJob(job.jobId, decision)
      .catch((e: Error) => ToastQueue.negative(TASK_VIEW_COPY.reconcileFailed(e.message), { timeout: 5000 }))
      .finally(() => setBusy(false));
  };
  const hintOf = (decision: JobReconcileDecision) =>
    decision === 'retry'
      ? TASK_VIEW_COPY.reconcileRetryHint(chargesOnRetry(job))
      : decision === 'discard'
        ? TASK_VIEW_COPY.reconcileDiscardHint
        : TASK_VIEW_COPY.reconcileApplyHint;
  return (
    <>
      {options.map((decision) => (
        <div key={decision} className={actionRow}>
          <Button variant="secondary" size="S" isPending={busy} onPress={() => decide(decision)}>
            {RECONCILE_LABEL[decision]}
          </Button>
          <span className={hint}>{hintOf(decision)}</span>
        </div>
      ))}
    </>
  );
}
