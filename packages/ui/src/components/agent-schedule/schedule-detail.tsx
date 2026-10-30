import { useState, type ReactNode } from 'react';
import { DEFAULT_AGENT_MODE, localizeText, normalizeAgentMode, type Id, type Schedule } from '@baocut/protocol';
import {
  ActionButton,
  ActionMenu,
  AlertDialog,
  Button,
  DialogContainer,
  Link,
  MenuItem,
  StatusLight,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACCESS_MODE_LABEL, TASK_VIEW_COPY, untitled } from '../../copy.ts';
import {
  describeCadence,
  nextAtOf,
  outcomeToast,
  resumable,
  runStatus,
  runTimeLabel,
  scheduleStatus,
  tookLabel,
  whenLabel,
} from '../../model/agent-schedule.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory } from '../../state/directory-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { hrefFor, useShell } from '../../state/shell-store.ts';
import { useTasks } from '../../state/tasks-store.ts';
import { useNow } from '../use-now.ts';
import { UtilityPage } from '../utility-page.tsx';
import { ScheduleDialog } from './schedule-dialog.tsx';
import { SCHEDULE_COPY as C } from './schedule-copy.ts';

/** 原型 agent-sessions.css 的 `.asch-*`。 */
const back = style({ alignSelf: 'start', marginBottom: 12 });
/** 标题下的状态（UtilityPage 的标题下留 24，这里收回去，同任务详情的状态行）。 */
const statusRow = style({ marginTop: -20 });
const actions = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' });
const why = style({ marginTop: 8, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
const props = style({
  marginTop: 20,
  marginBottom: 12,
  display: 'grid',
  gridTemplateColumns: '[max-content minmax(0, 1fr)]',
  columnGap: 20,
  rowGap: 8,
  font: 'ui',
});
const term = style({ color: 'gray-600' });
const value = style({ margin: 0, minWidth: 0, color: 'gray-900', overflowWrap: 'anywhere' });
const quiet = style({ color: 'gray-600' });
const prompt = style({ margin: 0, minWidth: 0, color: 'gray-900', whiteSpace: 'pre-wrap', userSelect: 'text', overflowWrap: 'anywhere' });
const hint = style({ margin: 0, display: 'flex', alignItems: 'start', gap: 'text-to-visual', font: 'ui-xs', color: 'gray-700' });
const hintIcon = style({ display: 'flex', flexShrink: 0, color: 'blue-900' });
const sub = style({ marginTop: 24, marginBottom: 8, font: 'title-sm', color: 'gray-900' });
const runs = style({ listStyleType: 'none', margin: 0, padding: 0, borderTopWidth: 1, borderTopStyle: 'solid', borderColor: 'gray-200' });
const run = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: 12,
  minHeight: 40,
  paddingY: 4,
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-sm',
});
const runAt = style({ flexShrink: 0, width: 128, color: 'gray-700', fontVariantNumeric: 'tabular-nums' });
const runError = style({ color: 'gray-600', minWidth: 0, overflowWrap: 'anywhere' });
const grow = style({ flexGrow: 1 });
const runLink = style({ minWidth: 0, maxWidth: '[50%]', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const empty = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });

/**
 * 定时任务的详情（产品设计 §6.1「定时任务」，原型 agent-schedule.jsx `ScheduleDetailPage`）：状态、设置、运行记录；
 * 立即运行一次、暂停 / 继续、编辑、删除。列在后台任务侧栏的「定时」一段。
 */
export function ScheduleDetail({ scheduleId }: { scheduleId: Id }) {
  const schedule = useTasks((s) => s.schedules.find((x) => x.id === scheduleId));
  const ready = useTasks((s) => s.ready);
  const go = useShell((s) => s.go);
  const backButton = (
    <ActionButton isQuiet size="S" styles={back} onPress={() => go({ tab: 'tasks' })}>
      <ChevronLeft />
      <Text>{TASK_VIEW_COPY.back}</Text>
    </ActionButton>
  );
  if (!schedule) {
    return (
      <UtilityPage kind="tasks" before={backButton} title={ready ? C.notFound : undefined}>
        {null}
      </UtilityPage>
    );
  }
  return <ScheduleBody key={schedule.id} schedule={schedule} backButton={backButton} />;
}

function ScheduleBody({ schedule, backButton }: { schedule: Schedule; backButton: ReactNode }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const conversations = useDirectory((s) => s.conversations);
  const projects = useDirectory((s) => s.projects);
  const defaultMode = useSetting('agent.defaultAccessMode') ?? DEFAULT_AGENT_MODE;
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);

  const target = conversations.find((c) => c.id === schedule.conversationId);
  const project = schedule.projectId ? projects.find((p) => p.id === schedule.projectId) : undefined;
  const status = scheduleStatus(schedule, now);
  const canResume = resumable(schedule, target, !!project);
  const stored = schedule.target === 'conversation' ? target?.accessMode : schedule.agent.accessMode;
  const mode = stored ? normalizeAgentMode(stored) : defaultMode;
  const conversationOf = (id: Id | null) => (id ? conversations.find((c) => c.id === id) : undefined);

  const runOnce = async () => {
    setBusy(true);
    try {
      const { schedule: after, outcome } = await runtime.runSchedule(schedule.id);
      const toast = outcomeToast(outcome, after);
      ToastQueue[toast.tone](toast.text, { timeout: 5000 });
    } catch (error) {
      ToastQueue.negative(C.runFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };
  const toggle = () =>
    runtime
      .updateSchedule({ scheduleId: schedule.id, paused: schedule.status === 'active' })
      .catch((error: Error) => ToastQueue.negative(C.saveFailed(error.message), { timeout: 5000 }));
  const remove = async () => {
    try {
      await runtime.removeSchedule(schedule.id);
      go({ tab: 'tasks' });
    } catch (error) {
      ToastQueue.negative(C.removeFailed((error as Error).message), { timeout: 5000 });
    }
  };

  const head = (
    <div className={actions}>
      <Button variant="secondary" size="S" isDisabled={schedule.status !== 'active'} isPending={busy} onPress={() => void runOnce()}>
        <Play />
        <Text>{C.runOnce}</Text>
      </Button>
      {schedule.status === 'active' ? (
        <Button variant="secondary" size="S" onPress={() => void toggle()}>
          <Pause />
          <Text>{C.pause}</Text>
        </Button>
      ) : (
        <Button variant="secondary" size="S" isDisabled={!canResume} onPress={() => void toggle()}>
          <Play />
          <Text>{C.resume}</Text>
        </Button>
      )}
      <ActionMenu aria-label={C.actions} isQuiet onAction={(key) => setDialog(key === 'edit' ? 'edit' : 'delete')}>
        <MenuItem id="edit" textValue={C.edit}>
          <Edit />
          <Text slot="label">{C.edit}</Text>
        </MenuItem>
        <MenuItem id="delete" textValue={C.remove}>
          <Delete />
          <Text slot="label">{C.remove}</Text>
        </MenuItem>
      </ActionMenu>
    </div>
  );

  return (
    <UtilityPage kind="tasks" before={backButton} title={schedule.name} actions={head}>
      <div className={statusRow}>
        <StatusLight variant={status.tone} size="S">
          {status.label}
        </StatusLight>
      </div>
      {schedule.status === 'paused' && schedule.pauseReason && !canResume ? (
        <p className={why}>{schedule.pauseReason === 'conversation-archived' ? C.whyArchived : C.whyOther}</p>
      ) : null}

      <dl className={props}>
        <dt className={term}>{C.cadence}</dt>
        <dd className={value}>
          {describeCadence(schedule.cadence)}
          <span className={quiet}> · {C.localTime}</span>
        </dd>
        <dt className={term}>{C.target}</dt>
        <dd className={value}>
          {schedule.target === 'new' ? (
            C.targetNew(project?.name ?? C.projectGone)
          ) : target ? (
            <Link variant="secondary" href={hrefFor({ tab: 'home', conversationId: target.id, projectId: target.projectId })}>
              {target.title || untitled()}
            </Link>
          ) : (
            C.sessionGone
          )}
        </dd>
        <dt className={term}>{C.runs}</dt>
        <dd className={value}>
          {schedule.maxRuns === null ? C.runsUnlimited(schedule.runCount) : C.runsLimited(schedule.maxRuns, schedule.runCount)}
        </dd>
        <dt className={term}>{C.promptEach}</dt>
        <dd className={prompt}>{schedule.prompt}</dd>
      </dl>
      {mode !== 'fullAccess' ? (
        <p className={hint}>
          <span className={hintIcon}>
            <InfoCircle />
          </span>
          {C.accessHint(ACCESS_MODE_LABEL[mode])}
        </p>
      ) : null}

      <h3 className={sub}>{C.history}</h3>
      {schedule.runs.length ? (
        <ul className={runs} aria-label={C.history}>
          {schedule.runs.map((r) => {
            const light = runStatus(r);
            const took = tookLabel(r);
            const session = conversationOf(r.conversationId);
            const error = r.status === 'failed' && r.error ? localizeText(r.error, r.errorRef) : null;
            return (
              <li key={r.id} className={run}>
                <span className={runAt}>{runTimeLabel(r.startedAt ?? r.at, now)}</span>
                <StatusLight variant={light.tone} size="S">
                  {light.label}
                </StatusLight>
                {took ? <span className={quiet}>{took}</span> : null}
                {error ? <span className={runError}>{error}</span> : null}
                <span className={grow} />
                {session ? (
                  <span className={runLink}>
                    <Link variant="secondary" href={hrefFor({ tab: 'home', conversationId: session.id, projectId: session.projectId })}>
                      {session.title || C.openSession}
                    </Link>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={empty}>{schedule.status === 'active' ? C.noRunsNext(whenLabel(nextAtOf(schedule, now), now)) : C.noRuns}</p>
      )}

      <DialogContainer onDismiss={() => setDialog(null)}>
        {dialog === 'edit' ? (
          <ScheduleDialog schedule={schedule} onClose={() => setDialog(null)} />
        ) : dialog === 'delete' ? (
          <AlertDialog
            variant="destructive"
            title={C.removeTitle(schedule.name)}
            primaryActionLabel={C.removeConfirm}
            cancelLabel={TASK_VIEW_COPY.cancel}
            onPrimaryAction={() => void remove()}
          >
            {C.removeBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </UtilityPage>
  );
}
