import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Conversation } from '@baocut/protocol';
import { DialogTrigger, Popover } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { WORKSPACE_COPY, untitled } from '../../copy.ts';
import { conversationOutputs } from '../../model/conversation-outputs.ts';
import { sessionStatus } from '../../model/sidebar.ts';
import { conversationVideoJobs } from '../../model/video-cards.ts';
import { itemKey, summaryInHead, tabsButton, type TabsButtonAction, type WorkspaceItem } from '../../model/workspace.ts';
import { homeMode, useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useTimelineItems } from '../../state/timeline-store.ts';
import { STATUS_WORD } from '../conversation-header.tsx';
import { ShellButton } from '../shell-button.tsx';
import { S } from '../shell-copy.ts';
import { ShellExitFullIcon, ShellFullIcon, ShellHideTabsIcon, ShellSummaryIcon, TabStackIcon } from '../shell-icons.tsx';
import { OutputCard } from '../thread/output-card.tsx';
import { useJobsForPlacement } from '../thread/video-card-rows.tsx';
import { WorkspaceTabIcon, useWorkspaceTitle } from './workspace-tabs.tsx';

/** 原型 home-workspace.css `.home-workspace-controls`：贴着标题栏右缘，按钮间隔 4。 */
const group = style({ position: 'absolute', top: 0, bottom: 0, insetEnd: 8, display: 'flex', alignItems: 'center', gap: 4 });

const NO_TABS: WorkspaceItem[] = [];

/**
 * 工作区视图按钮组（产品设计 §2.5、§3.3 用户修订；原型 home-shell-chrome.jsx `ShellViewControls`）：
 * [会话摘要][完整视图][标签页]，标签页按钮总在最右。分屏可见时摘要跟着会话列挂在会话头里（`summaryInHead`），这里不再放；
 * 窄窗口本来就是单条标签条，只留摘要。标题栏量这一组的实际左缘来定会话头与标签条的右端（HomeTitleBar）。
 */
export const WorkspaceViewControls = forwardRef<HTMLDivElement, { conversation: Conversation | null }>(function WorkspaceViewControls(
  { conversation },
  ref,
) {
  const mode = useShell(useShallow(homeMode));
  const narrow = useShell((s) => s.workspaceNarrow);
  const toggleWorkspaceFull = useShell((s) => s.toggleWorkspaceFull);
  if (!mode) return null;
  const inHead = summaryInHead({ visible: mode.visible, single: mode.single, count: mode.count });
  return (
    <div ref={ref} className={`${group} bc-no-drag`} role="group" aria-label={WORKSPACE_COPY.viewGroup}>
      {conversation && !inHead ? <SessionSummaryButton conversation={conversation} /> : null}
      {!narrow && mode.count > 0 ? (
        <ShellButton label={mode.full ? S.titleBar.exitFull : S.titleBar.enterFull} pressed={mode.full} onPress={toggleWorkspaceFull}>
          {mode.full ? <ShellExitFullIcon /> : <ShellFullIcon />}
        </ShellButton>
      ) : null}
      {!narrow ? <TabsButton /> : null}
    </div>
  );
});

const TABS_LABEL: Record<TabsButtonAction, () => string> = {
  open: () => S.titleBar.openTab,
  split: () => S.titleBar.enterSplit,
  hide: () => S.titleBar.hideTabs,
  show: () => S.titleBar.showTabs,
};

const tabsList = style({ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 480, padding: 8, overflowY: 'auto', boxSizing: 'border-box' });
const tabsHead = style({ margin: 0, paddingX: 8, paddingY: '[6px]', font: 'ui-xs', fontWeight: 'normal', color: 'gray-600' });
const tabsRow = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  height: 32,
  borderRadius: '[8px]',
  color: { default: 'gray-800', isActive: 'gray-900' },
  backgroundColor: { default: 'transparent', ':hover': 'gray-100', isActive: 'gray-100' },
  transition: 'default',
});
const tabsOpen = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexGrow: 1,
  minWidth: 0,
  height: 32,
  paddingStart: 8,
  paddingEnd: 40,
  borderStyle: 'none',
  borderRadius: '[8px]',
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: 'inherit',
  fontWeight: { default: 'normal', isActive: 'bold' },
  textAlign: 'start',
  cursor: 'default',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  outlineOffset: -2,
});
const tabsName = style({ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' });

/**
 * 标签页按钮（原型 home-shell-chrome.jsx `ShellTabsButton`）：没有标签时打开第一个（空白网页标签）并显示分屏；
 * 分屏可见时隐藏标签页；完整视图里回到分屏；功能区收起时显示标签页数，再按一下显示分屏（各状态见 model/workspace.ts `tabsButton`）。
 * 只有显示标签页数时，悬停 300ms（或按 ↓）列出已打开的标签页：点一行在分屏里打开，行尾按钮在完整视图里打开。
 * 列表不抢焦点、不挡别处（非模态），指针离开 150ms、Esc、点到别处或按钮离开这个状态时收起。
 */
function TabsButton() {
  const mode = useShell(useShallow(homeMode));
  const tabs = useShell((s) => (mode ? (s.workspaces[mode.key]?.tabs ?? NO_TABS) : NO_TABS));
  const routeActive = useShell((s) => (s.route.tab === 'home' && s.route.pane ? itemKey(s.route.pane) : null));
  const { toggleWorkspace, showWorkspaceTab } = useShell.getState();
  const title = useWorkspaceTitle();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const state = tabsButton({ count: mode?.count ?? 0, visible: !!mode?.visible, full: !!mode?.full });
  const listed = state.listed;

  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  const enter = () => {
    clearTimeout(timer.current);
    if (listed && !open) timer.current = setTimeout(() => setOpen(true), 300);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!listed) close();
  }, [listed]);
  useEffect(() => {
    if (!open) return undefined;
    // 捕获阶段：先于弹层自己的 Esc 处理决定焦点回到哪里。
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const inside = !!list.current?.contains(document.activeElement);
      close();
      if (inside) requestAnimationFrame(() => anchor.current?.querySelector('button')?.focus());
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (anchor.current?.contains(target) || list.current?.contains(target))) return;
      close();
    };
    window.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open]);

  // ↓ 打开列表并把焦点移到第一行。
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'ArrowDown' || !listed || list.current?.contains(event.target as Node)) return;
    event.preventDefault();
    clearTimeout(timer.current);
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[data-tabs-open]')?.focus()));
  };
  const run = (fn: () => void) => {
    close();
    fn();
  };
  const active = mode?.conversation ? null : routeActive;

  return (
    <span ref={anchor} className={style({ display: 'inline-flex' })} onPointerEnter={enter} onPointerLeave={leave} onKeyDown={onKeyDown}>
      <ShellButton
        label={TABS_LABEL[state.action]()}
        tooltip={!open}
        onPress={() => run(toggleWorkspace)}
        description={listed ? S.titleBar.openTabsCount(tabs.length) : undefined}
        aria-haspopup={listed ? 'dialog' : undefined}
        aria-expanded={listed ? open : undefined}>
        {state.glyph === 'hide-tabs' ? <ShellHideTabsIcon /> : <TabStackIcon badge={state.badge} />}
      </ShellButton>
      {listed ? (
        <Popover
          isNonModal
          isOpen={open}
          onOpenChange={(next) => (next ? setOpen(true) : close())}
          triggerRef={anchor}
          placement="bottom end"
          hideArrow
          padding="none"
          UNSAFE_className="bc-no-drag"
          styles={style({ width: 280 })}>
          <div ref={list} className={tabsList} role="dialog" aria-label={S.titleBar.openTabs} onPointerEnter={enter} onPointerLeave={leave}>
            <h2 className={tabsHead}>{S.titleBar.openTabs}</h2>
            {tabs.map((item) => {
              const key = itemKey(item);
              const name = title(item);
              const isActive = active === key;
              return (
                <div key={key} className={`${tabsRow({ isActive })} bc-tabs-row`}>
                  <button
                    type="button"
                    data-tabs-open
                    className={tabsOpen({ isActive })}
                    aria-current={isActive ? 'true' : undefined}
                    title={name}
                    onClick={() => run(() => showWorkspaceTab(key, false))}>
                    <WorkspaceTabIcon item={item} />
                    <span className={tabsName}>{name}</span>
                  </button>
                  <span className="bc-tabs-row-full">
                    <ShellButton small label={S.titleBar.openInFull(name)} tooltip={false} onPress={() => run(() => showWorkspaceTab(key, true))}>
                      <ShellFullIcon />
                    </ShellButton>
                  </span>
                </div>
              );
            })}
          </div>
        </Popover>
      ) : null}
    </span>
  );
}

const summary = style({ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, padding: 16, overflowY: 'auto', boxSizing: 'border-box' });
const summaryTitle = style({ margin: 0, font: 'title', color: 'gray-900', overflowWrap: 'anywhere' });
const summaryStatus = style({
  alignSelf: 'start',
  margin: 0,
  paddingX: 8,
  borderRadius: 'full',
  backgroundColor: { default: 'informative-subtle', isWaiting: 'notice-subtle' },
  font: 'ui-xs',
  color: 'gray-900',
  lineHeight: '[20px]',
});
const summarySection = style({ marginTop: 8, marginBottom: 0, font: 'ui-xs', fontWeight: 'bold', color: 'gray-600' });
const summaryEmpty = style({ margin: 0, font: 'ui-xs', color: 'gray-600' });

/**
 * 会话摘要（产品设计 §3.2 用户修订；原型 home-shell-chrome.jsx `ShellSummaryButton`）：标题、进行中 / 待允许，
 * 以及这条会话的产物（与线程里同一张卡片，thread/output-card.tsx）。分屏可见时它挂在会话头 ··· 后面，否则在右侧按钮组最前。
 */
export function SessionSummaryButton({ conversation }: { conversation: Conversation }) {
  const items = useTimelineItems(conversation.id);
  const entries = useSpace((s) => s.entries);
  const jobs = useJobsForPlacement();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [conversation.id]);
  const outputs = conversationOutputs(conversation, items, entries, undefined, jobs);
  const status = sessionStatus(conversation);
  const word = status === 'running' || status === 'waiting' ? STATUS_WORD[status] : null;
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <ShellButton label={S.titleBar.summary} tooltip={!open} pressed={open}>
        <ShellSummaryIcon />
      </ShellButton>
      <Popover placement="bottom end" hideArrow padding="none" UNSAFE_className="bc-no-drag" styles={style({ width: 360 })}>
        <section className={summary} aria-label={S.titleBar.summary}>
          <h2 className={summaryTitle}>{conversation.title || untitled()}</h2>
          {word ? (
            <p className={summaryStatus({ isWaiting: status === 'waiting' })} role="status">
              {word}
            </p>
          ) : null}
          <h3 className={summarySection}>{S.titleBar.summaryOutputs(outputs.length)}</h3>
          {outputs.map((output) => (
            <OutputCard
              key={output.id}
              output={output}
              conversationId={conversation.id}
              placement="popover"
              jobIds={output.kind === 'video' ? conversationVideoJobs(output.id, jobs, conversation.id) : undefined}
              onOpen={() => setOpen(false)}
            />
          ))}
          {!outputs.length ? <p className={summaryEmpty}>{S.titleBar.summaryEmpty}</p> : null}
        </section>
      </Popover>
    </DialogTrigger>
  );
}
