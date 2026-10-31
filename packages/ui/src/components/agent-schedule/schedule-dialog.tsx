import { useMemo, useState } from 'react';
import {
  DEFAULT_AGENT_MODE,
  normalizeAgentMode,
  scheduleProblem,
  nextScheduleRun,
  BOT_LIMITS,
  type Conversation,
  type Id,
  type Schedule,
  type ScheduleCadenceType,
  type WorkItemTemplate,
} from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  Heading,
  NumberField,
  Picker,
  PickerItem,
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
import { useChannels } from '../../state/channels-store.ts';
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
const channelPicker = style({ marginStart: 32, maxWidth: 320 });

const CADENCES: readonly ScheduleCadenceType[] = ['hourly', 'daily', 'weekly', 'cron'];
const CADENCE_LABEL = (type: ScheduleCadenceType) =>
  type === 'hourly' ? C.hourly : type === 'daily' ? C.daily : type === 'weekly' ? C.weekly : C.custom;

/**
 * 频道任务的模板（Bot 技术方案 §14.1 `work-item` 目标）：每次到点在频道里建一条交给智能体的任务，标题用名字（没写就用指令的第一行），
 * 简报就是指令。
 */
export function workItemTemplate(name: string, prompt: string): WorkItemTemplate {
  const firstLine = prompt.trim().split('\n')[0]!.trim();
  const title = [...(name.trim() || firstLine)].slice(0, BOT_LIMITS.title).join('');
  return { title, description: '', owner: 'agent', prompt: prompt.trim(), resources: [] };
}

/**
 * 建立或编辑定时任务（产品设计 §6.1「定时任务」，原型 agent-schedule.jsx `ScheduleDialog`）。从会话标题栏 ⋯「定时运行…」建立时
 * `conversation` 是那条会话；编辑时 `schedule` 是要改的那个（建它的会话可能已经删了）。访问模式不替你改：不是「完全访问」时写一行提示。
 * 放在 `DialogContainer` 里用。
 */
export function ScheduleDialog({
  conversation,
  schedule,
  channelId: initialChannel,
  onClose,
}: {
  conversation?: Conversation;
  schedule?: Schedule;
  /** 从 Bot 频道头部打开：目标默认「每次在这个频道建一条任务」。 */
  channelId?: Id;
  onClose: () => void;
}) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const origin = useDirectory((s) => conversation ?? s.conversations.find((c) => c.id === schedule?.conversationId));
  const project = useProject(origin?.projectId ?? schedule?.projectId ?? null);
  const defaultMode = useSetting('agent.defaultAccessMode') ?? DEFAULT_AGENT_MODE;
  const [d, setD] = useState<ScheduleDraft>(() => (initialChannel && !schedule ? { ...draftOf(null), target: 'work-item' } : draftOf(schedule ?? null)));
  const summaries = useChannels((s) => s.channels);
  const channels = useMemo(() => summaries.filter((c) => !c.channel.archived).map((c) => c.channel), [summaries]);
  const [channelId, setChannelId] = useState<Id | null>(initialChannel ?? null);
  const channel = channels.find((c) => c.id === (channelId ?? channels[0]?.id)) ?? null;
  // 编辑时目标是频道任务的固定不变（改不成别的，别的也改不成它：Runtime 不收新的模板）。
  const workItemFixed = schedule?.target === 'work-item';
  const workItemChannel = useChannels((s) => (workItemFixed ? s.channels.find((c) => c.channel.id === schedule.workItem?.channelId)?.channel : undefined));
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
          ...(workItemFixed ? {} : { target: d.target }),
          maxRuns,
        });
        onClose();
        ToastQueue.positive(C.saved, { timeout: 4000 });
        return;
      }
      const toChannel = d.target === 'work-item';
      if (toChannel ? !channel : !origin) return;
      const { schedule: created, outcome } = await runtime.createSchedule({
        conversationId: toChannel ? channel!.conversationId : origin!.id,
        name: d.name,
        prompt: d.prompt,
        cadence: d.cadence,
        target: d.target,
        maxRuns,
        ...(toChannel ? { workItem: { channelId: channel!.id, template: workItemTemplate(d.name, d.prompt) } } : {}),
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
              {workItemFixed ? (
                <div className={field}>
                  <span className={label}>{C.target}</span>
                  <span>{C.targetWorkItem(workItemChannel?.name ?? untitled())}</span>
                </div>
              ) : (
                <RadioGroup
                  label={C.target}
                  value={d.target}
                  onChange={(value) => set({ target: value === 'new' ? 'new' : value === 'work-item' ? 'work-item' : 'conversation' })}>
                  <Radio value="conversation" isDisabled={!origin}>
                    {origin ? C.targetConversation(titleInSentence(origin.title) || untitled()) : C.targetGone}
                  </Radio>
                  <Radio value="new" isDisabled={!project}>
                    {project ? C.targetNew(project.name) : C.targetNewNoProject}
                  </Radio>
                  {/* 编辑时不能改成频道任务：Runtime 只在建立时收模板。 */}
                  {schedule ? null : (
                    <Radio value="work-item" isDisabled={!channels.length}>
                      {channels.length ? C.targetWorkItemPick : C.targetWorkItemNone}
                    </Radio>
                  )}
                </RadioGroup>
              )}
              {d.target === 'work-item' && !schedule && channels.length ? (
                <Picker label={C.channel} selectedKey={channel?.id ?? null} onSelectionChange={(key) => setChannelId(String(key))} styles={channelPicker}>
                  {channels.map((c) => (
                    <PickerItem key={c.id} id={c.id}>
                      {c.name}
                    </PickerItem>
                  ))}
                </Picker>
              ) : null}
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
              {mode !== 'fullAccess' && d.target !== 'work-item' ? (
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
            <Button variant="accent" isPending={busy} isDisabled={!!problem || (!schedule && (d.target === 'work-item' ? !channel : !origin))} onPress={() => void save()}>
              {schedule ? S.common.save : C.create}
            </Button>
          </ButtonGroup>
        </>
      )}
    </Dialog>
  );
}
