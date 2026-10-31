import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AwaySummary, AwaySummaryRow, Channel, Id } from '@baocut/protocol';
import { ActionButton, Button, Text } from '@react-spectrum/s2';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Settings from '@react-spectrum/s2/icons/Settings';
import ViewList from '@react-spectrum/s2/icons/ListBulleted';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useRuntime } from '../../runtime/context.tsx';
import { formatMoneyOne } from '../../model/usage-format.ts';
import { useChannels } from '../../state/channels-store.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTimeline, useTimelineItems } from '../../state/timeline-store.ts';
import { ConversationView } from '../conversation-view.tsx';
import { useBotCall } from './bot-actions.ts';
import { jumpTo } from './bot-jump.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { BotTimeline } from './timeline/bot-timeline.tsx';
import { SuggestionChips } from './timeline/suggestion-chips.tsx';

const column = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  paddingX: 24,
  paddingY: 12,
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  minWidth: 0,
});
const spendLine = style({ font: 'ui-xs', color: 'gray-600', whiteSpace: 'nowrap' });
const headText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const name = style({ margin: 0, font: 'title-sm', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const purpose = style({
  font: 'ui-sm',
  color: { default: 'gray-700', isEmpty: 'gray-500' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const banner = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  flexShrink: 0,
  marginX: 24,
  marginTop: 12,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  font: 'ui-sm',
  backgroundColor: { tone: { info: 'informative-subtle', attention: 'notice-subtle', neutral: 'gray-50' } },
  color: 'gray-900',
});
const bannerText = style({ flexGrow: 1, flexBasis: 200, minWidth: 0 });
const awayBox = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, flexBasis: 260, minWidth: 0 });
const awayTitle = style({ fontWeight: 'bold' });
const awayList = style({ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0, listStyleType: 'none' });
const awayRow = style({
  display: 'flex',
  gap: 8,
  width: 'full',
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  textAlign: 'start',
  font: 'ui-sm',
  color: { default: 'gray-900', ':hover': 'accent-900' },
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'sm',
});
const awayKind = style({ flexShrink: 0, color: 'gray-700' });
const awayLine = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const unreadLine = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-xs', color: 'accent-900' });
const unreadRule = style({ flexGrow: 1, height: 1, backgroundColor: 'accent-subtle' });
const emptyNote = style({ maxWidth: 420, margin: 'auto', padding: 24, textAlign: 'center', font: 'body-sm', color: 'gray-600' });

/** 频道对话里最后一条（「看到哪里」的位置）。 */
function lastItemId(conversationId: Id): Id | null {
  const items = useTimeline.getState().byConversationId[conversationId]?.items;
  return items?.length ? items[items.length - 1]!.id : null;
}

function awayParts(summary: AwaySummary): string {
  return [
    summary.done.length ? C.away.done(summary.done.length) : null,
    summary.needsYou.length ? C.away.needsYou(summary.needsYou.length) : null,
    summary.stopped.length ? C.away.stopped(summary.stopped.length) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 摘要里有没有要说的：做完、等你或停下的至少一件。 */
export function hasAwayNews(summary: AwaySummary): boolean {
  return summary.done.length > 0 || summary.needsYou.length > 0 || summary.stopped.length > 0;
}

/**
 * 「你不在时」的摘要条（BOT-BH-08、需求 §11.4）：进频道时取 `bot.awaySummary`，有做完、等你或停下的才显示；
 * 人一直停在这个频道、只是切走了窗口，回到窗口（获得焦点或重新可见）时再取一次——离开时已经 `markSeen`，摘要只算离开之后的。
 * 「跳到第一条未读」翻到上次看到之后的第一条，那一条前面画「以下是新消息」细线。离开频道、窗口失焦或隐藏时 `channels.markSeen`
 * 记下看到的位置。
 */
export function useAwayAndSeen(channel: Pick<Channel, 'id' | 'conversationId'>) {
  const runtime = useRuntime();
  const [summary, setSummary] = useState<AwaySummary | null>(null);
  const [firstUnread, setFirstUnread] = useState<Id | null>(null);
  const { id, conversationId } = channel;

  useEffect(() => {
    let live = true;
    let away = false;
    setSummary(null);
    setFirstUnread(null);
    const load = () =>
      runtime.client
        .request('bot.awaySummary', { channelId: id })
        .then((result) => {
          if (!live) return;
          if (hasAwayNews(result)) setSummary(result);
          if (result.firstUnreadItemId) setFirstUnread(result.firstUnreadItemId);
        })
        .catch(() => {});
    const markSeen = () => void runtime.client.request('channels.markSeen', { id, itemId: lastItemId(conversationId) }).catch(() => {});
    const leave = () => {
      away = true;
      markSeen();
    };
    const back = () => {
      if (!away) return;
      away = false;
      void load();
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? leave() : back());
    void load();
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', onVisibility);
      markSeen();
    };
  }, [runtime, id, conversationId]);

  return { summary, firstUnread, dismiss: () => setSummary(null), jump: (itemId: Id) => void jumpTo(runtime, conversationId, itemId) };
}

/** 摘要条：标题一行计数，下面每件一行「状态 · 标题：结论」，点了打开那条任务。 */
export function AwayBanner({ summary, onOpen }: { summary: AwaySummary; onOpen: (row: AwaySummaryRow) => void }) {
  const groups: [string, AwaySummaryRow[]][] = [
    [C.status.done, summary.done],
    [C.panel.needsYou, summary.needsYou],
    [C.status.blocked, summary.stopped],
  ];
  return (
    <div className={awayBox}>
      <span className={awayTitle}>{C.away.title(awayParts(summary))}</span>
      <ul className={awayList}>
        {groups.flatMap(([kind, rows]) =>
          rows.map((row) => (
            <li key={`${kind}:${row.id}`}>
              <button type="button" className={awayRow} onClick={() => onOpen(row)}>
                <span className={awayKind}>{kind}</span>
                <span className={awayLine}>{row.headline ? C.away.row(row.title, row.headline) : row.title}</span>
              </button>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

/** 频道的 Agent 用不了（没装、没登录、被关掉）：对话只读，给一个去设置的入口（需求 §11.3 边界）。 */
function useDriverUnavailable(channel: Channel): boolean {
  const drivers = useConnection((s) => s.drivers);
  if (!drivers) return false;
  const driver = drivers.find((d) => d.id === channel.driverId);
  return !driver || !driver.enabled || driver.state !== 'ready';
}

/** 频道的花费（BOT-NF-04）：今天与本月，来自频道摘要；没有账本或这个月还没花钱时不显示。 */
export function ChannelSpend({ channelId }: { channelId: Id }) {
  const spend = useChannels((s) => s.channels.find((c) => c.channel.id === channelId)?.spend ?? null);
  const month = spend?.month;
  if (!month || !(Number(month.amount) > 0)) return null;
  const today = spend.today ?? { amount: '0', currency: month.currency };
  const text = C.channel.spend(formatMoneyOne(today), formatMoneyOne(month));
  return (
    <span className={spendLine} aria-label={text}>
      {text}
    </span>
  );
}

/**
 * 频道对话（BOT-CV-01…05、需求 §11.3）：头部是频道名与用途；时间线就是普通会话的时间线，Bot 条目（线程卡、报告行、提议卡）
 * 由 `BotTimeline` 画；输入框上方是提示芯片。换 Agent 改的是频道（`channels.update`），不是这一条会话。
 */
export function ChannelView({
  channel,
  onSettings,
  tasksToggle,
}: {
  channel: Channel;
  onSettings: () => void;
  /** 窄屏时任务面板收起，头部给一个开关。 */
  tasksToggle: { shown: boolean; onToggle: () => void } | null;
}) {
  const go = useShell((s) => s.go);
  const call = useBotCall();
  const items = useTimelineItems(channel.conversationId);
  const away = useAwayAndSeen(channel);
  const unavailable = useDriverUnavailable(channel);
  const firstUnread = away.summary?.firstUnreadItemId ?? null;
  const extras = useMemo(
    () => ({
      unread: away.firstUnread
        ? {
            itemId: away.firstUnread,
            node: (
              <div className={unreadLine} role="separator" aria-label={C.away.newMessages}>
                <span className={unreadRule} />
                <span>{C.away.newMessages}</span>
                <span className={unreadRule} />
              </div>
            ),
          }
        : null,
      userMessage: null,
      agentMessage: null,
    }),
    [away.firstUnread],
  );
  const banners: ReactNode[] = [];

  if (channel.archived)
    banners.push(
      <div key="archived" className={banner({ tone: 'neutral' })} role="status">
        <span className={bannerText}>{C.channel.archivedNote}</span>
        <Button size="S" variant="secondary" onPress={() => void call('channels.unarchive', { id: channel.id })}>
          {C.dialog.unarchive}
        </Button>
      </div>,
    );
  if (unavailable)
    banners.push(
      <div key="driver" className={banner({ tone: 'attention' })} role="status">
        <span className={bannerText}>{C.channel.readOnly}</span>
        <Button size="S" variant="secondary" onPress={() => go({ tab: 'settings', section: 'agent' })}>
          {C.channel.openAgentSettings}
        </Button>
      </div>,
    );
  if (away.summary)
    banners.push(
      <div key="away" className={banner({ tone: 'info' })} role="status">
        <AwayBanner summary={away.summary} onOpen={(row) => go({ tab: 'bot', channelId: channel.id, workItemId: row.id, view: 'channel' })} />
        {firstUnread ? (
          <Button size="S" variant="secondary" onPress={() => away.jump(firstUnread)}>
            {C.away.jump}
          </Button>
        ) : null}
        <Button size="S" variant="secondary" fillStyle="outline" onPress={away.dismiss}>
          {C.away.dismiss}
        </Button>
      </div>,
    );

  return (
    <section className={column} aria-label={channel.name}>
      <header className={header}>
        <div className={headText}>
          <h2 className={name}>{channel.name}</h2>
          <span className={purpose({ isEmpty: !channel.purpose })} title={channel.purpose || undefined}>
            {channel.purpose || C.channel.noPurpose}
          </span>
        </div>
        <ChannelSpend channelId={channel.id} />
        <ActionButton isQuiet size="S" onPress={() => go({ tab: 'bot', channelId: channel.id, workItemId: null, view: 'memory' })}>
          <Bookmark />
          <Text>{C.channel.memory}</Text>
        </ActionButton>
        <ActionButton isQuiet size="S" aria-label={C.sidebar.settings} onPress={onSettings}>
          <Settings />
        </ActionButton>
        {tasksToggle ? (
          <ActionButton isQuiet size="S" aria-expanded={tasksToggle.shown} onPress={tasksToggle.onToggle}>
            <ViewList />
            <Text>{tasksToggle.shown ? C.channel.hideTasks : C.channel.showTasks}</Text>
          </ActionButton>
        ) : null}
      </header>
      {banners}
      <BotTimeline channelId={channel.id} extras={extras}>
        <ConversationView
          conversationId={channel.conversationId}
          placeholder={C.channel.placeholder}
          empty={<p className={emptyNote}>{C.channel.empty}</p>}
          onAgentChange={(change) =>
            void call('channels.update', { id: channel.id, patch: { driverId: change.driverId, model: change.model ?? null, effort: change.effort ?? null } })
          }
          aboveComposer={<SuggestionChips conversationId={channel.conversationId} items={items} disabled={channel.archived || unavailable} />}
        />
      </BotTimeline>
    </section>
  );
}
