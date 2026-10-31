import { useEffect, useState, type ReactNode } from 'react';
import type { AwaySummary, Channel, Id } from '@baocut/protocol';
import { ActionButton, Button, Text } from '@react-spectrum/s2';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Settings from '@react-spectrum/s2/icons/Settings';
import ViewList from '@react-spectrum/s2/icons/ListBulleted';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTimeline, useTimelineItems } from '../../state/timeline-store.ts';
import { ConversationView } from '../conversation-view.tsx';
import { useBotCall } from './bot-actions.ts';
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
const emptyNote = style({ maxWidth: 420, margin: 'auto', padding: 24, textAlign: 'center', font: 'body-sm', color: 'gray-600' });

/** 频道对话里最后一条（「看到哪里」的位置）。 */
function lastItemId(conversationId: Id): Id | null {
  const items = useTimeline.getState().byConversationId[conversationId]?.items;
  return items?.length ? items[items.length - 1]!.id : null;
}

/** 往前翻页直到这一条载入（最多十页），再滚到它。线程里每条用户、智能体消息带 `data-find-item`，Bot 条目带 `data-bot-item`。 */
async function jumpTo(runtime: RuntimeSession, conversationId: Id, itemId: Id): Promise<void> {
  for (let page = 0; page < 10; page++) {
    const state = useTimeline.getState().byConversationId[conversationId];
    if (!state || state.items.some((item) => item.id === itemId)) break;
    const before = state.offset;
    await runtime.loadEarlier(conversationId);
    if (useTimeline.getState().byConversationId[conversationId]?.offset === before) break;
  }
  requestAnimationFrame(() => {
    const id = CSS.escape(itemId);
    const target = document.querySelector<HTMLElement>(`[data-find-item="${id}"], [data-bot-item="${id}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
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

/**
 * 「你不在时」的摘要条（BOT-BH-08、需求 §11.3）：进频道时取一次 `bot.awaySummary`，有做完、等你或停下的才显示；
 * 「跳到第一条未读」翻到上次看到之后的第一条。离开频道、窗口失焦或隐藏时 `channels.markSeen` 记下看到的位置。
 */
function useAwayAndSeen(channel: Channel) {
  const runtime = useRuntime();
  const [summary, setSummary] = useState<AwaySummary | null>(null);
  const { id, conversationId } = channel;

  useEffect(() => {
    let live = true;
    setSummary(null);
    runtime.client
      .request('bot.awaySummary', { channelId: id })
      .then((result) => {
        if (live && (result.done.length || result.needsYou.length || result.stopped.length)) setSummary(result);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, id]);

  useEffect(() => {
    const markSeen = () => void runtime.client.request('channels.markSeen', { id, itemId: lastItemId(conversationId) }).catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') markSeen();
    };
    window.addEventListener('blur', markSeen);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', markSeen);
      document.removeEventListener('visibilitychange', onVisibility);
      markSeen();
    };
  }, [runtime, id, conversationId]);

  return { summary, dismiss: () => setSummary(null), jump: (itemId: Id) => void jumpTo(runtime, conversationId, itemId) };
}

/** 频道的 Agent 用不了（没装、没登录、被关掉）：对话只读，给一个去设置的入口（需求 §11.3 边界）。 */
function useDriverUnavailable(channel: Channel): boolean {
  const drivers = useConnection((s) => s.drivers);
  if (!drivers) return false;
  const driver = drivers.find((d) => d.id === channel.driverId);
  return !driver || !driver.enabled || driver.state !== 'ready';
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
        <span className={bannerText}>{C.away.title(awayParts(away.summary))}</span>
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
      <BotTimeline channelId={channel.id}>
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
