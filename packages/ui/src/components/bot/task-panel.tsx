import { useMemo, useState, type ReactNode } from 'react';
import { BOT_LIMITS, newId, type Id, type WorkItem, type WorkItemOwner } from '@baocut/protocol';
import {
  ActionButton,
  ActionMenu,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Form,
  Heading,
  MenuItem,
  ProgressCircle,
  Radio,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  Text,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { isOverdue, loadResolvedWorkItems, localDate, mayHaveOlderResolved, taskSections, type TaskFilter } from '../../model/bot.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useChannels } from '../../state/channels-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useChannelWorkItems, useWorkItems, useWorkItemsLoaded } from '../../state/work-items-store.ts';
import { useNow } from '../use-now.ts';
import { errorText, nextLine, transitionWorkItem, useBotCall } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { formatDay, formatWhen } from './bot-format.ts';
import { StatusIcon } from './status-badge.tsx';
import { SuggestionButtons } from './timeline/proposal-card.tsx';
import { workItemStatus } from './work-item-status.ts';

const panel = style({ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flexGrow: 1 });
const head = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingX: 16, paddingTop: 12, paddingBottom: 8 });
const headTitle = style({ margin: 0, flexGrow: 1, font: 'title-sm', color: 'gray-900' });
const filterRow = style({ flexShrink: 0, paddingX: 16, paddingBottom: 8 });
const scroller = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 8, paddingBottom: 16 });
const section = style({ marginTop: 12 });
const sectionTitle = style({ marginX: 8, marginY: 4, font: 'ui-sm', fontWeight: 'bold', color: 'gray-700' });
const list = style({ display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyleType: 'none' });
const row = style({
  display: 'flex',
  alignItems: 'start',
  gap: 4,
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', isSelected: 'gray-100', ':hover': 'gray-75' },
});
const rowMain = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  flexGrow: 1,
  minWidth: 0,
  paddingX: 8,
  paddingY: 4,
  borderWidth: 0,
  backgroundColor: 'transparent',
  textAlign: 'start',
  cursor: 'default',
  font: 'ui',
  color: 'gray-900',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'default',
});
const rowText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 });
const rowTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textDecoration: { default: 'none', isStruck: 'line-through' },
  color: { default: 'gray-900', isStruck: 'gray-600' },
});
const rowSub = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const overdue = style({ font: 'ui-xs', fontWeight: 'medium', color: 'negative-900' });
const rowEnd = style({ display: 'flex', alignItems: 'center', paddingTop: 2, paddingEnd: 4, flexShrink: 0 });
const suggestion = style({ display: 'flex', flexDirection: 'column', gap: 8, paddingX: 8, paddingY: 8, borderRadius: 'default', backgroundColor: 'gray-50', marginBottom: 8 });
const suggestionReason = style({ font: 'ui-xs', color: 'gray-600' });
const empty = style({ marginX: 8, marginY: 16, font: 'body-sm', color: 'gray-600' });
const loading = style({ display: 'flex', justifyContent: 'center', padding: 24 });

/** 新任务的默认值（需求 §4.4 第 2 步）：「我来做」，不马上开始。 */
export const NEW_TASK_DEFAULTS: { owner: WorkItemOwner; start: boolean } = { owner: 'user', start: false };

type QuickAction = 'start' | 'markDone' | 'dismiss' | 'stop' | 'refresh' | 'reopen';

function quickActions(item: WorkItem): QuickAction[] {
  if (item.status === 'upNext' || item.status === 'scheduled') return item.owner === 'agent' ? ['start', 'markDone', 'dismiss'] : ['markDone', 'dismiss'];
  if (item.status === 'active') {
    if (item.owner === 'user') return ['markDone', 'dismiss'];
    return item.active?.state === 'blocked' ? ['refresh', 'markDone', 'dismiss'] : ['stop', 'refresh', 'markDone'];
  }
  if (item.status === 'resolved') return ['reopen'];
  return [];
}

const QUICK_LABEL: Record<QuickAction, () => string> = {
  start: () => C.panel.start,
  markDone: () => C.panel.markDone,
  dismiss: () => C.panel.dismiss,
  stop: () => C.detail.stop,
  refresh: () => C.panel.refresh,
  reopen: () => C.detail.reopen,
};

/** 任务面板里的一行：状态图标、标题（解决了划掉）、下一步或截止日；行尾「⋯」是快捷操作（需求 §11.5）。 */
function TaskRow({ item, today, timeZone, selected, onOpen }: { item: WorkItem; today: string; timeZone: string | null; selected: boolean; onOpen: () => void }) {
  const call = useBotCall();
  const status = workItemStatus(item);
  const late = isOverdue(item, today);
  const sub =
    item.status === 'scheduled' && item.startAt ? C.panel.starts(formatWhen(item.startAt, timeZone)) : (nextLine(item) ?? (item.dueOn ? C.panel.due(formatDay(item.dueOn)) : null));
  const actions = quickActions(item);
  const run = (action: QuickAction) => {
    if (action === 'start') void transitionWorkItem(call, item.id, { type: 'start' });
    else if (action === 'markDone') void transitionWorkItem(call, item.id, { type: 'resolve', evidence: null });
    else if (action === 'dismiss') void transitionWorkItem(call, item.id, { type: 'dismiss' });
    else if (action === 'reopen') void transitionWorkItem(call, item.id, { type: 'reopen' });
    else if (action === 'stop') void call('workItems.stop', { id: item.id });
    else void call('workItems.refresh', { id: item.id });
  };
  return (
    <li className={row({ isSelected: selected })}>
      <button type="button" className={rowMain} aria-current={selected || undefined} onClick={onOpen} aria-label={C.card.label(item.title, status.label, sub)}>
        <StatusIcon statusKey={status.key} />
        <span className={rowText}>
          <span className={rowTitle({ isStruck: status.strike })}>{item.title}</span>
          {late ? <span className={overdue}>{`${C.panel.overdue} · ${C.panel.due(formatDay(item.dueOn!))}`}</span> : sub ? <span className={rowSub}>{sub}</span> : null}
        </span>
      </button>
      {actions.length ? (
        <span className={rowEnd}>
          <ActionMenu aria-label={C.common.more} isQuiet size="S" onAction={(key) => run(key as QuickAction)}>
            {actions.map((action) => (
              <MenuItem key={action} id={action} textValue={QUICK_LABEL[action]()}>
                <Text>{QUICK_LABEL[action]()}</Text>
              </MenuItem>
            ))}
          </ActionMenu>
        </span>
      ) : null}
    </li>
  );
}

function SuggestionItem({ item, onOpen }: { item: WorkItem; onOpen: () => void }) {
  const call = useBotCall();
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    await fn();
    setPending(false);
  };
  return (
    <li className={suggestion}>
      <button type="button" className={rowMain} onClick={onOpen}>
        <StatusIcon statusKey="suggested" />
        <span className={rowText}>
          <span className={rowTitle({ isStruck: false })}>{item.title}</span>
          {item.suggestion?.reason ? <span className={suggestionReason}>{item.suggestion.reason}</span> : null}
        </span>
      </button>
      <SuggestionButtons item={item} pending={pending} run={run} call={call} />
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={section} aria-label={title}>
      <h3 className={sectionTitle}>{title}</h3>
      <ul className={list}>{children}</ul>
    </section>
  );
}

/**
 * 频道右侧的任务面板（BOT-TK-01…05、BOT-SG-05…07、需求 §11.5）：顶上筛选（全部、我的、智能体的）、新建任务与「给点建议」；
 * 建议另放一块（最多 3 条，现在做、加入、忽略），下面依次是等你、工作中、接下来（含定时）、已完成（最近 20 条、30 天内）。
 */
export function TaskPanel({ channelId, selectedId }: { channelId: Id; selectedId: Id | null }) {
  const items = useChannelWorkItems(channelId);
  const loaded = useWorkItemsLoaded(channelId);
  const timeZone = useChannels((s) => s.settings.timeZone);
  const go = useShell((s) => s.go);
  const call = useBotCall();
  const now = useNow(60_000);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [allDone, setAllDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const resolvedTail = useWorkItems((s) => s.byChannel[channelId]?.resolvedTail);
  const runtime = useRuntime();
  const [creating, setCreating] = useState(false);
  const [making, setMaking] = useState(false);
  const sections = useMemo(() => taskSections(items, filter, now, allDone), [items, filter, now, allDone]);
  const today = localDate(now, timeZone);
  const open = (id: Id) => go({ tab: 'bot', channelId, workItemId: id, view: 'channel' });
  const rows = (list: readonly WorkItem[]) =>
    list.map((item) => <TaskRow key={item.id} item={item} today={today} timeZone={timeZone} selected={item.id === selectedId} onOpen={() => open(item.id)} />);
  const nothing = !sections.suggested.length && !sections.needsYou.length && !sections.working.length && !sections.upNext.length && !sections.done.length;

  // 「显示更早的」（I19）：快照里已解决的条数到了上限时，Runtime 可能还有更早的，取回来补进快照再全部列出。
  const older = !allDone && mayHaveOlderResolved(items, resolvedTail);
  const showMore = async () => {
    if (older) {
      setLoadingOlder(true);
      try {
        useWorkItems.getState().merge(channelId, await loadResolvedWorkItems(runtime.client, channelId));
      } catch (error) {
        ToastQueue.negative(C.common.failed(errorText(error)), { timeout: 5000 });
        setLoadingOlder(false);
        return;
      }
      setLoadingOlder(false);
    }
    setAllDone(true);
  };

  const make = async () => {
    setMaking(true);
    const result = await call('bot.make.run', { channelId });
    setMaking(false);
    if (result && result.shown === 0) ToastQueue.neutral(C.panel.madeNone, { timeout: 4000 });
  };

  return (
    <section className={panel} aria-label={C.panel.title}>
      <div className={head}>
        <h2 className={headTitle}>{C.panel.title}</h2>
        <ActionButton isQuiet size="S" aria-label={C.panel.make} isPending={making} onPress={() => void make()}>
          <MagicWand />
        </ActionButton>
        <ActionButton isQuiet size="S" onPress={() => setCreating(true)}>
          <Add />
          <Text>{C.panel.newTask}</Text>
        </ActionButton>
      </div>
      <div className={filterRow}>
        <SegmentedControl aria-label={C.panel.filter} selectedKey={filter} onSelectionChange={(key) => setFilter(key as TaskFilter)}>
          <SegmentedControlItem id="all">{C.panel.all}</SegmentedControlItem>
          <SegmentedControlItem id="mine">{C.panel.mine}</SegmentedControlItem>
          <SegmentedControlItem id="agent">{C.panel.agent}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className={`${scroller} bc-scroll`}>
        {!loaded ? (
          <div className={loading}>
            <ProgressCircle size="S" isIndeterminate aria-label={C.common.loading} />
          </div>
        ) : nothing ? (
          <p className={empty}>{C.panel.empty}</p>
        ) : (
          <>
            {sections.suggested.length ? (
              <Section title={C.panel.suggestions}>
                {sections.suggested.map((item) => (
                  <SuggestionItem key={item.id} item={item} onOpen={() => open(item.id)} />
                ))}
              </Section>
            ) : null}
            {sections.needsYou.length ? <Section title={C.panel.needsYou}>{rows(sections.needsYou)}</Section> : null}
            {sections.working.length ? <Section title={C.panel.working}>{rows(sections.working)}</Section> : null}
            {sections.upNext.length ? <Section title={C.panel.upNext}>{rows(sections.upNext)}</Section> : null}
            {sections.done.length || sections.moreDone ? (
              <Section title={C.panel.done}>
                {rows(sections.done)}
                {(sections.moreDone || older) && !allDone ? (
                  <li>
                    <ActionButton isQuiet size="S" isPending={loadingOlder} onPress={() => void showMore()}>
                      {older ? C.panel.showOlder : C.panel.showMore(sections.moreDone)}
                    </ActionButton>
                  </li>
                ) : null}
              </Section>
            ) : null}
          </>
        )}
      </div>
      {creating ? <NewTaskDialog channelId={channelId} onClose={() => setCreating(false)} onCreated={open} /> : null}
    </section>
  );
}

/**
 * 新建任务（BOT-TK-02、需求 §4.4）：标题、谁来做。默认「我来做」、进「接下来」；改成交给智能体时可以勾「马上开始」，
 * 默认不勾，也进「接下来」。
 */
export function NewTaskDialog({ channelId, onClose, onCreated }: { channelId: Id; onClose: () => void; onCreated: (id: Id) => void }) {
  const call = useBotCall();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<WorkItemOwner>(NEW_TASK_DEFAULTS.owner);
  const [start, setStart] = useState(NEW_TASK_DEFAULTS.start);
  const [busy, setBusy] = useState(false);
  const valid = title.trim() !== '' && title.trim().length <= BOT_LIMITS.title;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const result = await call('workItems.create', { channelId, title: title.trim(), owner, start: owner === 'agent' && start, commandId: newId('cmd') });
    setBusy(false);
    if (result) {
      onClose();
      onCreated(result.item.id);
    }
  };
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="S">
        {({ close }) => (
          <>
            <Heading slot="title">{C.panel.newTask}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}>
                <TextField label={C.panel.taskTitle} value={title} onChange={setTitle} autoFocus isRequired maxLength={BOT_LIMITS.title} />
                <RadioGroup label={C.panel.owner} value={owner} onChange={(value) => setOwner(value as WorkItemOwner)}>
                  <Radio value="user">{C.panel.ownerUser}</Radio>
                  <Radio value="agent">{C.panel.ownerAgent}</Radio>
                </RadioGroup>
                {owner === 'agent' ? (
                  <Switch isSelected={start} onChange={setStart}>
                    {C.panel.startNow}
                  </Switch>
                ) : null}
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {C.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!valid} isPending={busy} onPress={() => void submit()}>
                {C.panel.add}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}
