import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { BOT_LIMITS, newId, type Id, type WorkItem, type WorkItemOwner } from '@baocut/protocol';
import {
  ActionButton,
  ActionMenu,
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  ProgressCircle,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Filter from '@react-spectrum/s2/icons/Filter';
import User from '@react-spectrum/s2/icons/User';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  TASK_TABS,
  defaultTab,
  isOverdue,
  loadResolvedWorkItems,
  localDate,
  mayHaveOlderResolved,
  tabCounts,
  tabOf,
  taskSections,
  type TaskFilter,
  type TaskTab,
} from '../../model/bot.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useChannels } from '../../state/channels-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useChannelWorkItems, useWorkItems, useWorkItemsLoaded } from '../../state/work-items-store.ts';
import { AgentIcon } from '../agent-icon.tsx';
import { useNow } from '../use-now.ts';
import { errorText, nextLine, transitionWorkItem, useBotCall, useScopedState } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { formatDay, formatWhen } from './bot-format.ts';
import { useTaskSpend } from './task-spend.ts';
import { StatusIcon } from './status-badge.tsx';
import { workItemStatus } from './work-item-status.ts';

/** 右栏面板的外框与头部；Make 面板（make-panel.tsx）共用。 */
export const panel = style({ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flexGrow: 1 });
/** 面板顶上只有工具，靠右（原型 page-bot.css `.bot-panel__head--tools`）：名字在页签上。 */
const head = style({ display: 'flex', alignItems: 'center', justifyContent: 'end', gap: 4, flexShrink: 0, paddingStart: 16, paddingEnd: 12, paddingTop: 8, paddingBottom: 4 });
const addForm = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flexShrink: 0,
  marginX: 8,
  marginTop: 4,
  marginBottom: 8,
  padding: 8,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
});
const addField = style({ width: 'full' });
const addBar = style({ display: 'flex', alignItems: 'center', gap: 8 });
const grow = style({ flexGrow: 1 });
const tabsBox = style({ flexGrow: 1, minHeight: 0 });
const tabList = style({ marginX: 16 });
const tabPanel = style({ height: 'full' });
const scroller = style({ height: 'full', boxSizing: 'border-box', overflowY: 'auto', paddingX: 8, paddingBottom: 16 });
const section = style({ marginTop: 12 });
const sectionTitle = style({ display: 'flex', alignItems: 'baseline', gap: 4, marginX: 8, marginY: 4, font: 'ui-sm', fontWeight: 'bold', color: 'gray-700' });
const sectionCount = style({ font: 'ui-xs', fontWeight: 'normal', color: 'gray-600' });
export const list = style({ display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyleType: 'none' });
export const row = style({
  display: 'flex',
  alignItems: 'start',
  gap: 4,
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', isSelected: 'gray-100', ':hover': 'gray-75' },
});
export const rowMain = style({
  display: 'flex',
  alignItems: 'center',
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
export const rowText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 });
export const rowTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textDecoration: { default: 'none', isStruck: 'line-through' },
  color: { default: 'gray-900', isStruck: 'gray-600' },
});
export const rowSub = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const overdue = style({ font: 'ui-xs', fontWeight: 'medium', color: 'negative-900' });
export const rowEnd = style({ display: 'flex', alignItems: 'center', paddingTop: 2, paddingEnd: 4, flexShrink: 0 });
export const empty = style({ marginX: 8, marginY: 16, font: 'body-sm', color: 'gray-600' });
export const loading = style({ display: 'flex', justifyContent: 'center', padding: 24 });

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
  const spent = useTaskSpend(item.channelId, item.id);
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
        <StatusIcon statusKey={status.key} chip />
        <span className={rowText}>
          <span className={rowTitle({ isStruck: status.strike })}>{item.title}</span>
          {late ? <span className={overdue}>{`${C.panel.overdue} · ${C.panel.due(formatDay(item.dueOn!))}`}</span> : sub ? <span className={rowSub}>{sub}</span> : null}
          {spent ? <span className={rowSub}>{spent}</span> : null}
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

export function Section({ title, count = 0, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className={section} aria-label={count ? C.panel.sectionCount(title, count) : title}>
      <h3 className={sectionTitle}>
        {title}
        {count ? <span className={sectionCount}>{count}</span> : null}
      </h3>
      <ul className={list}>{children}</ul>
    </section>
  );
}

/** 新任务「谁来做」（BOT-TK-02、需求 §4.4）：默认我来做、进接下来；交给智能体时默认也先排着，选「并现在开始」才直接开始。 */
type AddOwner = 'user' | 'agent' | 'agentNow';
const ADD_OWNERS: Record<AddOwner, { owner: WorkItemOwner; start: boolean; label: () => string }> = {
  user: { owner: 'user', start: false, label: () => C.panel.ownerUser },
  agent: { owner: 'agent', start: false, label: () => C.panel.ownerAgent },
  agentNow: { owner: 'agent', start: true, label: () => C.panel.ownerAgentNow },
};
const DEFAULT_ADD_OWNER: AddOwner = NEW_TASK_DEFAULTS.owner === 'agent' ? (NEW_TASK_DEFAULTS.start ? 'agentNow' : 'agent') : 'user';

/**
 * 面板头下面的新任务输入行（BOT-TK-02、需求 §4.4）：回车添加，Esc 收起。添加后切到新任务所在的页签，
 * 输入行与「谁来做」留着，可以接着加。
 */
function AddTaskRow({ channelId, onAdded, onClose }: { channelId: Id; onAdded: (item: WorkItem) => void; onClose: () => void }) {
  const call = useBotCall();
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState<AddOwner>(DEFAULT_ADD_OWNER);
  const [busy, setBusy] = useState(false);
  const pick = ADD_OWNERS[ownerId];
  const valid = title.trim() !== '' && title.trim().length <= BOT_LIMITS.title;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const result = await call('workItems.create', { channelId, title: title.trim(), owner: pick.owner, start: pick.start, commandId: newId('cmd') });
    setBusy(false);
    if (result) {
      setTitle('');
      onAdded(result.item);
    }
  };
  return (
    <form className={addForm} aria-label={C.panel.newTask} onSubmit={(event) => void submit(event)}>
      <TextField
        aria-label={C.panel.taskTitle}
        placeholder={C.panel.addPlaceholder}
        value={title}
        onChange={setTitle}
        maxLength={BOT_LIMITS.title}
        autoFocus
        styles={addField}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          else event.continuePropagation();
        }}
      />
      <div className={addBar}>
        <MenuTrigger>
          <ActionButton isQuiet size="S" aria-label={C.panel.ownerPick(pick.label())}>
            {pick.owner === 'user' ? <User /> : <AgentIcon />}
            <Text>{pick.label()}</Text>
            <ChevronDown />
          </ActionButton>
          <Menu
            aria-label={C.panel.owner}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[ownerId]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setOwnerId(next as AddOwner);
            }}>
            {(Object.keys(ADD_OWNERS) as AddOwner[]).map((id) => (
              <MenuItem key={id} id={id} textValue={ADD_OWNERS[id].label()}>
                <Text>{ADD_OWNERS[id].label()}</Text>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        <span className={grow} />
        <Button size="S" variant="secondary" fillStyle="outline" onPress={onClose}>
          {C.common.cancel}
        </Button>
        <Button size="S" variant="accent" type="submit" isDisabled={!valid} isPending={busy}>
          {C.panel.add}
        </Button>
      </div>
    </form>
  );
}

const FILTER_LABEL: Record<TaskFilter, () => string> = { all: () => C.panel.all, mine: () => C.panel.mine, agent: () => C.panel.agent };

/**
 * 频道右侧的任务面板（BOT-TK-01…05、BOT-SG-05…07、需求 §11.5）：右栏的「任务」页签。顶上是「显示哪些任务」菜单与新任务，
 * 收起与关闭在页签条上；新任务在头部下面直接输入；建议在 Make 面板（make-panel.tsx）。四个页签：进行中（按子状态分组，组头带条数）、
 * 接下来、定时、已解决（最近 20 条、30 天内）。没选过页签时显示第一个有任务的。
 */
export function TaskPanel({ channelId, selectedId }: { channelId: Id; selectedId: Id | null }) {
  const items = useChannelWorkItems(channelId);
  const loaded = useWorkItemsLoaded(channelId);
  const timeZone = useChannels((s) => s.settings.timeZone);
  const go = useShell((s) => s.go);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [picked, setPicked] = useScopedState<TaskTab | null>(channelId, null);
  const [allDone, setAllDone] = useScopedState(channelId, false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const resolvedTail = useWorkItems((s) => s.byChannel[channelId]?.resolvedTail);
  const runtime = useRuntime();
  const [adding, setAdding] = useState(false);
  const sections = useMemo(() => taskSections(items, filter, now, allDone), [items, filter, now, allDone]);
  const counts = tabCounts(sections);
  const tab = picked ?? defaultTab(sections);
  const today = localDate(now, timeZone);
  const open = (id: Id) => go({ tab: 'bot', channelId, workItemId: id, view: 'channel' });
  const rows = (list: readonly WorkItem[]) =>
    list.map((item) => <TaskRow key={item.id} item={item} today={today} timeZone={timeZone} selected={item.id === selectedId} onOpen={() => open(item.id)} />);

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

  const body = (key: TaskTab): ReactNode => {
    if (key === 'active')
      return sections.active.length
        ? sections.active.map((group) => (
            <Section key={group.state} title={C.status[group.state]} count={group.items.length}>
              {rows(group.items)}
            </Section>
          ))
        : null;
    if (key === 'resolved')
      return sections.done.length || sections.moreDone || older ? (
        <ul className={list}>
          {rows(sections.done)}
          {(sections.moreDone || older) && !allDone ? (
            <li>
              <ActionButton isQuiet size="S" isPending={loadingOlder} onPress={() => void showMore()}>
                {older ? C.panel.showOlder : C.panel.showMore(sections.moreDone)}
              </ActionButton>
            </li>
          ) : null}
        </ul>
      ) : null;
    const list_ = key === 'upNext' ? sections.upNext : sections.scheduled;
    return list_.length ? <ul className={list}>{rows(list_)}</ul> : null;
  };
  const emptyText = (key: TaskTab) => (key === 'active' && !items.length ? C.panel.empty : C.panel.tabEmpty[key]);

  return (
    <section className={panel} aria-label={C.panel.title}>
      <div className={head}>
        <MenuTrigger>
          <ActionButton isQuiet size="S" aria-label={C.panel.filterPick(FILTER_LABEL[filter]())}>
            <Filter />
            {filter === 'all' ? null : <Text>{FILTER_LABEL[filter]()}</Text>}
          </ActionButton>
          <Menu
            aria-label={C.panel.filter}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[filter]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setFilter(next as TaskFilter);
            }}>
            {(Object.keys(FILTER_LABEL) as TaskFilter[]).map((key) => (
              <MenuItem key={key} id={key} textValue={FILTER_LABEL[key]()}>
                <Text>{FILTER_LABEL[key]()}</Text>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        <ActionButton isQuiet size="S" aria-label={C.panel.newTask} aria-expanded={adding} onPress={() => setAdding(!adding)}>
          <Add />
        </ActionButton>
      </div>
      {adding ? (
        <AddTaskRow
          channelId={channelId}
          onAdded={(item) => {
            const next = tabOf(item);
            if (next) setPicked(next);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {!loaded ? (
        <div className={loading}>
          <ProgressCircle size="S" isIndeterminate aria-label={C.common.loading} />
        </div>
      ) : (
        <Tabs aria-label={C.panel.title} density="compact" selectedKey={tab} onSelectionChange={(key) => setPicked(key as TaskTab)} styles={tabsBox}>
          <TabList aria-label={C.panel.title} styles={tabList}>
            {TASK_TABS.map((key) => (
              <Tab key={key} id={key}>
                {counts[key] ? `${C.panel.tabs[key]} ${counts[key]}` : C.panel.tabs[key]}
              </Tab>
            ))}
          </TabList>
          {TASK_TABS.map((key) => (
            <TabPanel key={key} id={key} styles={tabPanel}>
              <div className={`${scroller} bc-scroll`}>{body(key) ?? <p className={empty}>{emptyText(key)}</p>}</div>
            </TabPanel>
          ))}
        </Tabs>
      )}
    </section>
  );
}
