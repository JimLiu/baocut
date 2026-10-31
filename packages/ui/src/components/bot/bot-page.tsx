import { useCallback, useEffect, useMemo, useState } from 'react';
import { MAIN_CHANNEL_ID, type ChannelSummary, type Id } from '@baocut/protocol';
import { Button, ProgressCircle } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { wantedWorkItemChannels } from '../../model/bot.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useChannelSummary, useChannels } from '../../state/channels-store.ts';
import { useShell, type BotView } from '../../state/shell-store.ts';
import { syncWorkItemSubscriptions } from '../../state/work-items-store.ts';
import { errorText } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { ChannelDialog, DeleteChannelDialog } from './channel-dialog.tsx';
import { ChannelMemoryPage } from './channel-memory-page.tsx';
import { ChannelSidebar } from './channel-sidebar.tsx';
import { ChannelView } from './channel-view.tsx';
import { InboxView } from './inbox-view.tsx';
import { TaskDetail } from './task-detail.tsx';
import { TaskPanel } from './task-panel.tsx';

const layout = style({ display: 'flex', flexGrow: 1, minHeight: 0, minWidth: 0 });
const content = style({ position: 'relative', display: 'flex', flexGrow: 1, minWidth: 0, minHeight: 0 });
const main = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
const side = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  width: { default: 340, isDetail: 420 },
  maxWidth: 'full',
  minHeight: 0,
  boxSizing: 'border-box',
  backgroundColor: 'layer-1',
  borderStartWidth: 1,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  position: { default: 'static', isOverlay: 'absolute' },
  top: 0,
  bottom: 0,
  insetEnd: 0,
  zIndex: { default: 0, isOverlay: 2 },
  boxShadow: { default: 'none', isOverlay: 'elevated' },
});
const centered = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, flexGrow: 1, font: 'ui', color: 'gray-700' });

/** 主区窄于这个宽度时任务面板收起，从头部的开关浮出（需求 §11.1「窄窗口时折叠」）。 */
const NARROW = 880;

/**
 * 第一次进 Bot 时确保主频道存在（BOT-CH-01）：每个会话（连接）只调一次 `channels.ensureMain`，失败了可以重试。
 */
const ensured = new WeakMap<RuntimeSession, Promise<void>>();

function useEnsureMain(): { failed: string | null; retry: () => void } {
  const runtime = useRuntime();
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let pending = ensured.get(runtime);
    if (!pending) {
      pending = runtime.client.request('channels.ensureMain', {}).then(() => undefined);
      ensured.set(runtime, pending);
      pending.catch(() => ensured.delete(runtime));
    }
    setFailed(null);
    pending.catch((error: unknown) => live && setFailed(errorText(error)));
    return () => {
      live = false;
    };
  }, [runtime, attempt]);
  return { failed, retry: () => setAttempt((n) => n + 1) };
}

/**
 * 任务镜像只订需要的频道（技术方案 §16.2）：打开的那个，加上有任务等你的（收件箱要在原地回答，得有任务本身）。离开 Bot 页全部退订。
 */
function useWorkItemSubscriptions(openChannelId: Id | null) {
  const runtime = useRuntime();
  const channels = useChannels((s) => s.channels);
  const wanted = useMemo(() => wantedWorkItemChannels(channels, openChannelId), [channels, openChannelId]);
  const key = wanted.join(',');
  useEffect(() => {
    syncWorkItemSubscriptions(runtime.client, key ? key.split(',') : []);
  }, [runtime, key]);
  useEffect(() => () => syncWorkItemSubscriptions(runtime.client, []), [runtime]);
}

/** 量主区宽度：窄了任务面板改成浮层。 */
function useNarrow(): [(element: HTMLDivElement | null) => void, boolean] {
  const [narrow, setNarrow] = useState(false);
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? NARROW) < NARROW));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, narrow];
}

/**
 * Bot 页（技术方案 §17.1、需求 §11.1）：左边频道侧栏，中间频道对话（或收件箱、记忆页、展开的任务详情），右边任务面板或任务详情。
 * 主区变窄时右栏收起，从频道头部的开关浮出；打开任务详情时总是显示。
 */
export function BotPage({ channelId: routeChannelId, workItemId, view }: { channelId: Id | null; workItemId: Id | null; view: BotView }) {
  const go = useShell((s) => s.go);
  const ready = useChannels((s) => s.ready);
  const { failed, retry } = useEnsureMain();
  const channelId = view === 'inbox' ? null : (routeChannelId ?? MAIN_CHANNEL_ID);
  const summary = useChannelSummary(channelId);
  const channel = summary?.channel;
  const [contentRef, narrow] = useNarrow();
  const [tasksShown, setTasksShown] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState<ChannelSummary | null>(null);
  useWorkItemSubscriptions(channelId ?? (workItemId ? (routeChannelId ?? null) : null));

  const routeTo = (next: { channelId?: Id | null; workItemId?: Id | null; view?: BotView }) =>
    go({ tab: 'bot', channelId: next.channelId !== undefined ? next.channelId : routeChannelId, workItemId: next.workItemId !== undefined ? next.workItemId : workItemId, view: next.view ?? view });
  const closeDetail = () => routeTo({ workItemId: null, view: view === 'task' ? 'channel' : view });

  let center;
  let right = null;
  if (view === 'inbox') {
    center = <InboxView />;
    if (workItemId)
      right = <TaskDetail workItemId={workItemId} channelId={routeChannelId} wide={false} onToggleWide={null} onClose={closeDetail} />;
  } else if (!channel) {
    center =
      failed && channelId === MAIN_CHANNEL_ID ? (
        <div className={centered} role="alert">
          <span>{C.channel.setupFailed(failed)}</span>
          <Button variant="secondary" onPress={retry}>
            {C.channel.retry}
          </Button>
        </div>
      ) : !ready || channelId === MAIN_CHANNEL_ID ? (
        <div className={centered}>
          <ProgressCircle isIndeterminate aria-label={C.channel.settingUp} />
          <span>{C.channel.settingUp}</span>
        </div>
      ) : (
        <div className={centered}>
          <span>{C.channel.missing}</span>
          <Button variant="secondary" onPress={() => go({ tab: 'bot', channelId: null, workItemId: null, view: 'channel' })}>
            {C.channel.goMain}
          </Button>
        </div>
      );
  } else if (view === 'memory') {
    center = <ChannelMemoryPage channel={channel} />;
  } else if (view === 'task' && workItemId) {
    center = <TaskDetail workItemId={workItemId} channelId={channel.id} wide onToggleWide={() => routeTo({ view: 'channel' })} onClose={closeDetail} />;
  } else {
    center = (
      <ChannelView
        channel={channel}
        onSettings={() => setSettingsOpen(true)}
        tasksToggle={narrow && !workItemId ? { shown: tasksShown, onToggle: () => setTasksShown(!tasksShown) } : null}
      />
    );
    if (workItemId)
      right = (
        <TaskDetail workItemId={workItemId} channelId={channel.id} wide={false} onToggleWide={() => routeTo({ view: 'task' })} onClose={closeDetail} />
      );
    else if (!narrow || tasksShown) right = <TaskPanel channelId={channel.id} selectedId={null} />;
  }

  return (
    <div className={layout}>
      <ChannelSidebar />
      <div ref={contentRef} className={content}>
        <div className={main}>{center}</div>
        {right ? <aside className={side({ isOverlay: narrow, isDetail: !!workItemId })}>{right}</aside> : null}
      </div>
      {settingsOpen && channel ? (
        <ChannelDialog
          state={{ mode: 'settings', channelId: channel.id }}
          onClose={() => setSettingsOpen(false)}
          onCreated={() => setSettingsOpen(false)}
          onDelete={(target) => {
            setSettingsOpen(false);
            setDeleting(target);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteChannelDialog
          summary={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            go({ tab: 'bot', channelId: null, workItemId: null, view: 'channel' });
          }}
        />
      ) : null}
    </div>
  );
}
