import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MAIN_CHANNEL_ID, type ChannelSummary, type Id } from '@baocut/protocol';
import { Button, ProgressCircle } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { wantedWorkItemChannels, type MakeScope } from '../../model/bot.ts';
import { BOT_NARROW, fullColumns, fullSplit, sideWidth, type BotSideTab, type FixedSideTab, type FullLeft } from '../../model/bot-side.ts';
import { narrowShowsConversation } from '../../model/workspace.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useBotLayout } from '../../state/bot-layout-store.ts';
import { useChannels } from '../../state/channels-store.ts';
import { useShell, type BotView } from '../../state/shell-store.ts';
import { syncWorkItemSubscriptions } from '../../state/work-items-store.ts';
import { botContentRegion, botMainRegion, botSideRegion } from '../pane-edges.ts';
import { errorText } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';
import { BotHead } from './bot-head.tsx';
import { useBotSide } from './bot-side-state.ts';
import { BOT_HOME_TAB, BOT_MAIN_PANEL, BOT_SIDE_PANEL, BotSideSeam, botSideTabId } from './bot-side-tabs.tsx';
import { ChannelDialog, DeleteChannelDialog } from './channel-dialog.tsx';
import { ChannelMemoryPage } from './channel-memory-page.tsx';
import { ChannelSidebar } from './channel-sidebar.tsx';
import { ChannelView } from './channel-view.tsx';
import { InboxView } from './inbox-view.tsx';
import { MakePanel } from './make-panel.tsx';
import { TaskDetail } from './task-detail.tsx';
import { TaskPanel } from './task-panel.tsx';

const layout = style({ display: 'flex', flexGrow: 1, minHeight: 0, minWidth: 0 });
const content = style({ position: 'relative', display: 'flex', flexGrow: 1, minWidth: 0, minHeight: 0 });
const main = style({ display: { default: 'flex', isHidden: 'none' }, flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
/** 右栏：宽时定宽（分隔条拖），占满或窄时铺满主区。分界由分隔条画，没有分隔条时（铺满）不要边。 */
const side = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: { default: 0, isFull: 1 },
  flexShrink: 0,
  maxWidth: 'full',
  minWidth: 0,
  minHeight: 0,
  boxSizing: 'border-box',
  backgroundColor: 'layer-1',
});
const panel = style({ display: 'flex', flexDirection: { default: 'column', isSplit: 'row' }, flexGrow: 1, minWidth: 0, minHeight: 0 });
const column = style({ display: 'flex', flexDirection: 'column', flexGrow: { default: 0, isMain: 1 }, flexShrink: { default: 0, isMain: 1 }, minWidth: 0, minHeight: 0 });
const hint = style({ maxWidth: 360, margin: 'auto', padding: 24, textAlign: 'center', font: 'body-sm', color: 'gray-600' });
/** 窄时中间栏的标题回到中间栏顶上（同 Home 窄时的会话头）：至少 56 高，下边 2px 的分隔。 */
const narrowHead = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  minHeight: 56,
  boxSizing: 'border-box',
  paddingX: 8,
  borderBottomWidth: 2,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const centered = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, flexGrow: 1, font: 'ui', color: 'gray-700' });

/** 中间栏与右栏的左右缘交给标题栏（pane-edges）：React 19 的 ref 回调带清理，不会拿 null 再调一次。 */
const mainRegionRef = (element: HTMLDivElement | null) => (element ? botMainRegion(element) : undefined);
const sideRegionRef = (element: HTMLElement | null) => (element ? botSideRegion(element) : undefined);

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
 * 任务镜像只订需要的频道（技术方案 §16.2）：打开的那个，加上有任务等你的（收件箱要在原地回答，得有任务本身）；
 * Make 面板看「全部频道」时（`everyChannel`）订所有没归档的频道。离开 Bot 页全部退订。
 */
function useWorkItemSubscriptions(openChannelId: Id | null, everyChannel: boolean) {
  const runtime = useRuntime();
  const channels = useChannels((s) => s.channels);
  const wanted = useMemo(() => wantedWorkItemChannels(channels, openChannelId, everyChannel), [channels, openChannelId, everyChannel]);
  const key = wanted.join(',');
  useEffect(() => {
    syncWorkItemSubscriptions(runtime.client, key ? key.split(',') : []);
  }, [runtime, key]);
  useEffect(() => () => syncWorkItemSubscriptions(runtime.client, []), [runtime]);
}

/**
 * 量主区的宽，写进 store（标题栏也要知道窄不窄）。宽窄切换照 Home（`narrowShowsConversation`）：变窄时焦点在中间栏、
 * 或右栏本来收着就选中间栏的页签，否则右栏选着的页签留着；变宽时窄里开着的右栏跟过去。第一次量到时只记下来，
 * 窄的窗口打开时右栏默认收起。
 */
function useMainWidth(): (element: HTMLDivElement | null) => (() => void) | void {
  const wasNarrow = useRef<boolean | null>(null);
  return useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const offRegion = botContentRegion(element);
    const sync = () => {
      const width = Math.round(element.getBoundingClientRect().width);
      if (!width) return;
      const narrow = width < BOT_NARROW;
      const before = wasNarrow.current;
      wasNarrow.current = narrow;
      const store = useBotLayout.getState();
      if (before !== null && before !== narrow) {
        if (narrow) store.setNarrowShown(!narrowShowsConversation(!!document.activeElement?.closest('[data-bot-main]'), !store.wideHidden));
        else if (store.narrowShown) store.setWideHidden(false);
      }
      store.setMainWidth(width);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => {
      observer.disconnect();
      offRegion();
    };
  }, []);
}

/**
 * Bot 页（技术方案 §17.1、需求 §11.1 的修订稿；原型 page-bot.jsx `BotPage`）：左边频道侧栏，中间频道对话（或收件箱、记忆页），
 * 右栏照 Home 的功能区是一组页签（产品设计 §3.3）：「任务」「Make」两个固定页签，后面是打开的任务。页签条与中间栏的标题在标题栏里
 * （BotTitleBar），右栏的状态与动作在 useBotSide，两边读同一份 store。
 * 宽时中间与右栏之间有分隔条，宽按当前页签的形态（任务面板 340、Make 380、任务更宽），拖过的各记各的。
 * 占满：中间收起，右栏占满主区并分成两栏——左边是当前页签的上一层，右边是当前页签；两栏之间也能拖。
 * 窄（主区窄于 880）：只剩一栏，中间栏变成页签条最前面的固定页签，它的标题放回中间栏顶上；记忆页没有右栏，窄时照旧。
 * 旧链接的 view: 'task'（任务详情占满主区）进来时换成占满。
 */
export function BotPage({ channelId: routeChannelId, workItemId, view }: { channelId: Id | null; workItemId: Id | null; view: BotView }) {
  const go = useShell((s) => s.go);
  const ready = useChannels((s) => s.ready);
  const { failed, retry } = useEnsureMain();
  const route = { channelId: routeChannelId, workItemId, view };
  const s = useBotSide(route);
  const { channel, active, inbox, shown, full, single } = s;
  const channelId = inbox ? null : (routeChannelId ?? MAIN_CHANNEL_ID);
  const contentRef = useMainWidth();
  const mainWidth = useBotLayout((st) => st.mainWidth);
  const widths = useBotLayout((st) => st.widths);
  const settingsFor = useBotLayout((st) => st.settingsFor);
  const [makeScope, setMakeScope] = useState<MakeScope>('channel');
  const [deleting, setDeleting] = useState<ChannelSummary | null>(null);

  // 路由里的任务没开就开一个页签（页签簿按频道各记一份，见 model/bot-side.ts）。
  useEffect(() => {
    if (s.tabs !== s.stored) useBotLayout.getState().setBook(s.bookKey, s.tabs);
  }, [s.tabs, s.stored, s.bookKey]);
  // 设置对话框只属于打开时的那个频道。
  useEffect(() => () => useBotLayout.getState().setSettingsFor(null), [channel?.id]);
  // 旧的展开链接：换成占满，路由回到频道。
  useEffect(() => {
    if (view !== 'task') return;
    useBotLayout.getState().setFull(s.bookKey, true);
    useShell.getState().replace({ tab: 'bot', channelId: routeChannelId, workItemId, view: 'channel' });
  }, [view]);

  const cols = shown && full ? fullColumns(active, s.sideKind ?? 'tasks', inbox) : null;
  const makeOn = shown && ((!cols && !active && s.sideKind === 'make') || cols?.left === 'make');
  useWorkItemSubscriptions(channelId ?? (workItemId ? (routeChannelId ?? null) : null), makeOn && makeScope === 'all');

  const setWidth = (key: string, width: number | null) => useBotLayout.getState().setWidth(key, width);
  const tabContent = (tab: BotSideTab) => (
    <TaskDetail key={tab.key} workItemId={tab.workItemId} channelId={inbox ? routeChannelId : (channel?.id ?? null)} onClose={() => s.closeTab(tab)} />
  );
  const fixedContent = (kind: FixedSideTab) =>
    !channel ? null : kind === 'make' ? (
      <MakePanel key={channel.id} channelId={channel.id} scope={makeScope} onScope={setMakeScope} />
    ) : (
      <TaskPanel key={channel.id} channelId={channel.id} selectedId={active?.workItemId ?? null} />
    );
  const leftContent = (left: FullLeft) => (left === 'inbox' ? <InboxView titled /> : fixedContent(left));

  let center: ReactNode;
  if (inbox) {
    center = <InboxView />;
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
  } else {
    // 按频道换实例：回复目标、「显示更早的」这类界面状态只属于一个频道，切频道时不能串过去。
    center = <ChannelView key={channel.id} channel={channel} />;
  }

  const sized = shown && !s.narrow && !full && mainWidth > 0 ? sideWidth(s.mode, widths[s.mode], mainWidth) : null;
  let body: ReactNode = null;
  if (cols) {
    const key = `full:${cols.left}`;
    const split = fullSplit(cols.left, widths[key], mainWidth);
    body = (
      <div className={panel({ isSplit: true })}>
        <div className={column({ isMain: false })} style={{ width: split.width }}>
          {leftContent(cols.left)}
        </div>
        <BotSideSeam
          {...split}
          grows
          label={C.side.resizeSplit}
          onResize={(w) => setWidth(key, fullSplit(cols.left, w, mainWidth).width)}
          onReset={() => setWidth(key, null)}
        />
        <div className={column({ isMain: true })}>
          {cols.right ? tabContent(cols.right) : <p className={hint}>{C.side.fullHint[cols.left === 'make' ? 'make' : 'tasks']}</p>}
        </div>
      </div>
    );
  } else if (shown) {
    body = active ? tabContent(active) : s.sideKind ? fixedContent(s.sideKind) : null;
  }
  const selectedTab = s.tabs.active ?? `fixed:${s.sideKind}`;

  return (
    <div className={layout}>
      <ChannelSidebar />
      <div ref={contentRef} className={content}>
        <div
          ref={mainRegionRef}
          className={main({ isHidden: shown && (full || single) })}
          data-bot-main=""
          {...(single ? { id: BOT_MAIN_PANEL, role: 'tabpanel', 'aria-labelledby': botSideTabId(BOT_HOME_TAB) } : {})}>
          {single ? (
            <div className={narrowHead}>
              <BotHead route={route} side={s} />
            </div>
          ) : null}
          {center}
        </div>
        {sized ? (
          <BotSideSeam {...sized} label={C.side.resize} onResize={(w) => setWidth(s.mode, sideWidth(s.mode, w, mainWidth).width)} onReset={() => setWidth(s.mode, null)} />
        ) : null}
        {shown ? (
          <aside ref={sideRegionRef} className={side({ isFull: !sized })} style={sized ? { width: sized.width } : undefined} aria-label={C.side.label}>
            <div id={BOT_SIDE_PANEL} role="tabpanel" className={panel({ isSplit: false })} aria-labelledby={botSideTabId(selectedTab)}>
              {body}
            </div>
          </aside>
        ) : null}
      </div>
      {settingsFor && channel?.id === settingsFor ? (
        <ChannelDialog
          state={{ mode: 'settings', channelId: settingsFor }}
          onClose={() => useBotLayout.getState().setSettingsFor(null)}
          onCreated={() => useBotLayout.getState().setSettingsFor(null)}
          onDelete={(target) => {
            useBotLayout.getState().setSettingsFor(null);
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
