import { useState } from 'react';
import {
  DEFAULT_AGENT_MODE,
  normalizeAgentMode,
  scheduleProblem,
  nextScheduleRun,
  type Conversation,
  type Schedule,
  type ScheduleCadenceType,
} from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  Heading,
  NumberField,
  Radio,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  TextArea,
  TextField,
  ToastQueue,
  ToggleButton,
  ToggleButtonGroup,
} from '@react-spectrum/s2';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACCESS_MODE_LABEL, untitled } from '../../copy.ts';
import {
  cadenceFor,
  describeCadence,
  draftOf,
  outcomeToast,
  problemText,
  WEEK_ORDER,
  whenLabel,
  type ScheduleDraft,
} from '../../model/agent-schedule.ts';
import { titleInSentence } from '../../model/agent-import.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDirectory, useProject } from '../../state/directory-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { S } from '../shell-copy.ts';
import { SCHEDULE_COPY as C } from './schedule-copy.ts';

/** 原型 agent-sessions.css 的 `.asch-*`。 */
const form = style({ display: 'flex', flexDirection: 'column', gap: 16 });
const field = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const label = style({ font: 'ui-xs', color: 'gray-700' });
const cadenceRow = style({ display: 'flex', alignItems: 'end', gap: 12, flexWrap: 'wrap' });
const time = style({ width: 96 });
const cron = style({ flexGrow: 1, flexShrink: 1, flexBasis: 240 });
const detail = style({ margin: 0, font: 'ui-xs', color: { default: 'gray-600', isError: 'negative-900' } });
const limitRow = style({ display: 'flex', alignItems: 'center', gap: 12 });
const max = style({ width: 96 });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600' });
const hint = style({ margin: 0, display: 'flex', alignItems: 'start', gap: 'text-to-visual', font: 'ui-xs', color: 'gray-700' });
const hintIcon = style({ display: 'flex', flexShrink: 0, color: 'blue-900' });

const CADENCES: readonly ScheduleCadenceType[] = ['hourly', 'daily', 'weekly', 'cron'];
const CADENCE_LABEL = (type: ScheduleCadenceType) =>
  type === 'hourly' ? C.hourly : type === 'daily' ? C.daily : type === 'weekly' ? C.weekly : C.custom;

/**
 * 建立或编辑定时任务（产品设计 §6.1「定时任务」，原型 agent-schedule.jsx `ScheduleDialog`）。从会话标题栏 ⋯「定时运行…」建立时
 * `conversation` 是那条会话；编辑时 `schedule` 是要改的那个（建它的会话可能已经删了）。访问模式不替你改：不是「完全访问」时写一行提示。
 * 放在 `DialogContainer` 里用。
 */
export function ScheduleDialog({
  conversation,
  schedule,
  onClose,
}: {
  conversation?: Conversation;
  schedule?: Schedule;
  onClose: () => void;
}) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const origin = useDirectory((s) => conversation ?? s.conversations.find((c) => c.id === schedule?.conversationId));
  const project = useProject(origin?.projectId ?? schedule?.projectId ?? null);
  const defaultMode = useSetting('agent.defaultAccessMode') ?? DEFAULT_AGENT_MODE;
  const [d, setD] = useState<ScheduleDraft>(() => draftOf(schedule ?? null));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ScheduleDraft>) => setD((x) => ({ ...x, ...patch }));

  const now = Date.now();
  const maxRuns = d.limit ? d.maxRuns : null;
  const problem = scheduleProblem({ name: d.name, prompt: d.prompt, cadence: d.cadence, maxRuns }, now);
  // 频率下面那一行只说频率与次数的问题：话还没写时照样给出下一次。
  const cadenceProblem = scheduleProblem({ name: d.name, prompt: d.prompt.trim() ? d.prompt : 'x', cadence: d.cadence, maxRuns }, now);
  const next = cadenceProblem ? null : nextScheduleRun(d.cadence, now);
  // 发给这条会话时看它现在的访问模式；新开会话用建立时记下的那一档（编辑时）或这条会话的（建立时）。
  const stored = d.target === 'new' && schedule ? schedule.agent.accessMode : origin?.accessMode;
  const mode = stored ? normalizeAgentMode(stored) : defaultMode;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      if (schedule) {
        await runtime.updateSchedule({
          scheduleId: schedule.id,
          name: d.name,
          prompt: d.prompt,
          cadence: d.cadence,
          target: d.target,
          maxRuns,
        });
        onClose();
        ToastQueue.positive(C.saved, { timeout: 4000 });
        return;
      }
      if (!origin) return;
      const { schedule: created, outcome } = await runtime.createSchedule({
        conversationId: origin.id,
        name: d.name,
        prompt: d.prompt,
        cadence: d.cadence,
        target: d.target,
        maxRuns,
        ...(d.runNow ? { runNow: true } : {}),
      });
      onClose();
      ToastQueue.positive(C.created(created.name, describeCadence(created.cadence)), {
        timeout: 6000,
        actionLabel: C.view,
        shouldCloseOnAction: true,
        onAction: () => go({ tab: 'tasks', scheduleId: created.id }),
      });
      if (outcome && outcome !== 'run') {
        const toast = outcomeToast(outcome, created);
        ToastQueue[toast.tone](toast.text, { timeout: 5000 });
      }
    } catch (error) {
      ToastQueue.negative(C.saveFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const cadence = d.cadence;
  return (
    <Dialog size="M">
      {({ close }) => (
        <>
          <Heading slot="title">{schedule ? C.titleEdit : C.titleCreate}</Heading>
          <Content>
            <div className={form}>
              <TextField label={C.name} description={C.nameHint} value={d.name} onChange={(name) => set({ name })} />
              <TextArea label={C.prompt} description={C.promptHint} isRequired value={d.prompt} onChange={(prompt) => set({ prompt })} />
              <div className={field}>
                <span className={label}>{C.cadence}</span>
                <SegmentedControl
                  aria-label={C.cadence}
                  selectedKey={cadence.type}
                  onSelectionChange={(key) => set({ cadence: cadenceFor(String(key) as ScheduleCadenceType, cadence) })}
                >
                  {CADENCES.map((type) => (
                    <SegmentedControlItem key={type} id={type}>
                      {CADENCE_LABEL(type)}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
                <div className={cadenceRow}>
                  {cadence.type === 'hourly' ? (
                    <NumberField
                      label={C.minute}
                      minValue={0}
                      maxValue={59}
                      value={cadence.minute}
                      onChange={(minute) => set({ cadence: { type: 'hourly', minute: Number.isFinite(minute) ? minute : 0 } })}
                      styles={max}
                    />
                  ) : null}
                  {cadence.type === 'weekly' ? (
                    <ToggleButtonGroup
                      aria-label={C.days}
                      selectionMode="multiple"
                      size="S"
                      selectedKeys={cadence.days.map(String)}
                      onSelectionChange={(keys) => set({ cadence: { ...cadence, days: [...keys].map(Number).sort((a, b) => a - b) } })}
                    >
                      {WEEK_ORDER.map((day) => (
                        <ToggleButton key={day} id={String(day)}>
                          {C.weekdays[day]}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  ) : null}
                  {cadence.type === 'daily' || cadence.type === 'weekly' ? (
                    <TextField
                      label={C.time}
                      value={cadence.time}
                      onChange={(value) => set({ cadence: { ...cadence, time: value.trim() } })}
                      styles={time}
                    />
                  ) : null}
                  {cadence.type === 'cron' ? (
                    <TextField
                      label={C.cron}
                      description={C.cronHint}
                      value={cadence.expr}
                      onChange={(expr) => set({ cadence: { type: 'cron', expr } })}
                      styles={cron}
                    />
                  ) : null}
                </div>
                <p className={detail({ isError: !!cadenceProblem })} aria-live="polite">
                  {next !== null
                    ? C.next(describeCadence(cadence), whenLabel(next, now))
                    : cadenceProblem
                      ? problemText(cadenceProblem)
                      : C.never}
                </p>
              </div>
              <RadioGroup label={C.target} value={d.target} onChange={(value) => set({ target: value === 'new' ? 'new' : 'conversation' })}>
                <Radio value="conversation" isDisabled={!origin}>
                  {origin ? C.targetConversation(titleInSentence(origin.title) || untitled()) : C.targetGone}
                </Radio>
                <Radio value="new" isDisabled={!project}>
                  {project ? C.targetNew(project.name) : C.targetNewNoProject}
                </Radio>
              </RadioGroup>
              <div className={limitRow}>
                <Checkbox isSelected={d.limit} onChange={(limit) => set({ limit })}>
                  {C.limit}
                </Checkbox>
                {d.limit ? (
                  <NumberField
                    aria-label={C.maxRuns}
                    minValue={1}
                    value={d.maxRuns}
                    onChange={(value) => set({ maxRuns: Number.isFinite(value) ? value : 1 })}
                    styles={max}
                  />
                ) : null}
              </div>
              <p className={note}>{C.note}</p>
              {mode !== 'fullAccess' ? (
                <p className={hint}>
                  <span className={hintIcon}>
                    <InfoCircle />
                  </span>
                  {C.accessHint(ACCESS_MODE_LABEL[mode])}
                </p>
              ) : null}
              {schedule ? null : (
                <Checkbox isSelected={d.runNow} onChange={(runNow) => set({ runNow })}>
                  {C.runNow}
                </Checkbox>
              )}
            </div>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={close}>
              {S.common.cancel}
            </Button>
            <Button variant="accent" isPending={busy} isDisabled={!!problem || (!schedule && !origin)} onPress={() => void save()}>
              {schedule ? S.common.save : C.create}
            </Button>
          </ButtonGroup>
        </>
      )}
    </Dialog>
  );
}
