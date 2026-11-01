import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Id } from '@baocut/protocol';
import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import FileText from '@react-spectrum/s2/icons/FileText';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import ViewList from '@react-spectrum/s2/icons/ListBulleted';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Focusable } from 'react-aria-components';
import type { WorkItemStatusKey } from '../../model/bot.ts';
import type { BotSideTab, FixedSideTab } from '../../model/bot-side.ts';
import { tabKeyIndex } from '../../model/workspace.ts';
import { useWorkItem } from '../../state/work-items-store.ts';
import { ShellButton } from '../shell-button.tsx';
import { S } from '../shell-copy.ts';
import { ShellExitFullIcon, ShellFullIcon, ShellHideTabsIcon } from '../shell-icons.tsx';
import { workspaceTabStyles as T } from '../workspace/workspace-tabs.tsx';
import { BOT_COPY as C } from './bot-copy.ts';
import type { BotSide } from './bot-side-state.ts';
import { StatusIcon } from './status-badge.tsx';
import { workItemStatus } from './work-item-status.ts';

/** 标题栏里的页签条：页签让开拖动区，条两端的空白仍可拖窗口（同 Home 的 WorkspaceTabs）。 */
const bar = style({ display: 'flex', alignItems: 'center', flexGrow: 1, minWidth: 0 });
const controls = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginStart: 'auto' });
/** 「任务」有等你的事、「Make」有建议时名字后面的点：只表示有，数目在读屏名称里（原型 `.bot-side-tabs__dot`）。 */
const dot = style({ flexShrink: 0, size: 8, borderRadius: 'full', backgroundColor: 'blue-900' });

/** 页签与右栏内容互相指向；中间栏在窄时是最前面那个页签，面板 id 见 `BOT_MAIN_PANEL`。 */
export const botSideTabId = (key: string) => `bot-side-tab-${encodeURIComponent(key)}`;
export const BOT_SIDE_PANEL = 'bot-side-panel';
export const BOT_MAIN_PANEL = 'bot-main-panel';
/** 窄时最前面的那个页签（频道或「等你处理」）的键；它管的是中间栏。 */
export const BOT_HOME_TAB = 'home';

/** 窄时中间栏那个固定页签的样子。 */
export interface BotHomeTab {
  name: string;
  aria: string;
  icon: ReactNode;
}

interface Look {
  name: string;
  aria: string;
  icon: ReactNode;
  extra?: ReactNode;
}

type Entry =
  { key: string; kind: 'home' } | { key: string; kind: 'fixed'; fixed: FixedSideTab } | { key: string; kind: 'task'; tab: BotSideTab };

/** 任务页签上次看到的名字与状态：任务所在的频道退订后（收件箱里答完了）页签不至于变成「已删除」。 */
const seen = new Map<Id, { title: string; statusKey: WorkItemStatusKey; label: string }>();

/**
 * 右栏的页签条（需求 §11.1、§11.6 的修订稿，原型 page-bot-side.jsx `BotSideTabs`；样子是 Home 功能区页签条的那一套）：
 * 频道里最前面是「任务」（有等你的事时带点）与「Make」（有建议时带点），宽按内容；后面是打开的任务（状态图标 + 任务名）。
 * 都能关，关掉的固定页签由频道头的开关再打开。收件箱没有这两个。
 * 窄时中间栏是最前面一个固定页签（`home`：频道或「等你处理」，淡蓝底、不能关、后面一道分隔），选它就是收起右栏；这时没有完整视图与收起。
 * ✕、中键或选中时按 Delete 关页签；左右方向键、Home、End 在页签之间移动并选中。右端是完整视图与收起右栏。不拖动排序、不预览。
 */
export function BotSideTabs({ side, home }: { side: BotSide; home: BotHomeTab | null }) {
  const list = useRef<HTMLDivElement>(null);
  const selected = !side.shown ? BOT_HOME_TAB : (side.tabs.active ?? `fixed:${side.sideKind}`);
  const order: Entry[] = [
    ...(home ? [{ key: BOT_HOME_TAB, kind: 'home' as const }] : []),
    ...side.fixedOpen.map((fixed) => ({ key: `fixed:${fixed}`, kind: 'fixed' as const, fixed })),
    ...side.tabs.tabs.map((tab) => ({ key: tab.key, kind: 'task' as const, tab })),
  ];
  const pick = (entry: Entry) => {
    if (entry.kind === 'home') side.hide();
    else if (entry.kind === 'fixed') side.selectFixed(entry.fixed);
    else side.selectTab(entry.tab);
  };
  const focus = (key: string | undefined) => {
    if (key) requestAnimationFrame(() => document.getElementById(botSideTabId(key))?.focus());
  };
  const close = (entry: Entry) => {
    if (entry.kind === 'home') return;
    const at = order.findIndex((e) => e.key === entry.key);
    if (entry.kind === 'fixed') side.closeFixed(entry.fixed);
    else side.closeTab(entry.tab);
    const rest = order.filter((e) => e.key !== entry.key);
    focus(rest[Math.min(at, rest.length - 1)]?.key);
  };

  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected, side.tabs.tabs.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'tab') return;
    const at = order.findIndex((e) => botSideTabId(e.key) === target.id);
    const entry = order[at];
    if (!entry) return;
    const next = tabKeyIndex(event.key, at, order.length);
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      pick(order[next]!);
      focus(order[next]!.key);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      pick(entry);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && entry.kind !== 'home') {
      event.preventDefault();
      event.stopPropagation();
      close(entry);
    }
  };

  const fixedLook = (kind: FixedSideTab): Look =>
    kind === 'tasks'
      ? {
          name: C.panel.title,
          aria: C.channel.tasks(side.waiting),
          icon: <ViewList UNSAFE_style={T.icon} />,
          extra: side.waiting ? <span className={dot} aria-hidden="true" /> : null,
        }
      : {
          name: C.make.title,
          aria: C.make.toggle(side.suggestions),
          icon: <MagicWand UNSAFE_style={T.icon} />,
          extra: side.suggestions ? <span className={dot} aria-hidden="true" /> : null,
        };

  return (
    <div className={T.strip}>
      <div className={bar}>
        <div className={`${T.tablist} bc-no-drag`} role="tablist" aria-label={C.side.tablist} onKeyDownCapture={onKeyDown}>
          {home ? (
            <>
              <HomeTab look={home} selected={selected === BOT_HOME_TAB} onSelect={side.hide} />
              <span className={T.separator} aria-hidden="true" />
            </>
          ) : null}
          <div ref={list} className={T.list} role="presentation">
            {order.map((entry) =>
              entry.kind === 'home' ? null : entry.kind === 'fixed' ? (
                <SideTab
                  key={entry.key}
                  id={entry.key}
                  look={fixedLook(entry.fixed)}
                  fixed
                  selected={selected === entry.key}
                  onSelect={() => pick(entry)}
                  onClose={() => close(entry)}
                />
              ) : (
                <TaskTab
                  key={entry.key}
                  tab={entry.tab}
                  selected={selected === entry.key}
                  onSelect={() => pick(entry)}
                  onClose={() => close(entry)}
                />
              ),
            )}
          </div>
        </div>
        {home ? null : (
          <div className={`${controls} bc-no-drag`} role="group" aria-label={C.side.views}>
            <ShellButton label={side.full ? S.titleBar.exitFull : S.titleBar.enterFull} pressed={side.full} onPress={side.toggleFull}>
              {side.full ? <ShellExitFullIcon /> : <ShellFullIcon />}
            </ShellButton>
            <ShellButton label={C.side.hide} onPress={side.hide}>
              <ShellHideTabsIcon />
            </ShellButton>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskTab({ tab, selected, onSelect, onClose }: { tab: BotSideTab; selected: boolean; onSelect: () => void; onClose: () => void }) {
  const item = useWorkItem(tab.workItemId);
  if (item) {
    const status = workItemStatus(item);
    seen.set(item.id, { title: item.title, statusKey: status.key, label: status.label });
  }
  const last = seen.get(tab.workItemId);
  const look: Look = last
    ? { name: last.title, aria: C.side.taskTab(last.title, last.label), icon: <StatusIcon statusKey={last.statusKey} /> }
    : { name: C.side.missingTask, aria: C.side.missingTask, icon: <FileText UNSAFE_style={T.icon} /> };
  return <SideTab id={tab.key} look={look} selected={selected} onSelect={onSelect} onClose={onClose} />;
}

function HomeTab({ look, selected, onSelect }: { look: BotHomeTab; selected: boolean; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="presentation"
      className={T.conversationItem({ isActive: selected, isHovered: hovered && !selected })}
      style={T.inheritIcon}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <TooltipTrigger delay={500}>
        <Focusable>
          <div
            role="tab"
            id={botSideTabId(BOT_HOME_TAB)}
            aria-controls={BOT_MAIN_PANEL}
            aria-selected={selected}
            aria-label={look.aria}
            tabIndex={selected ? 0 : -1}
            className={T.tabTarget}
            onClick={onSelect}
          >
            <span className={T.glyph}>{look.icon}</span>
            <span className={T.conversationName}>{look.name}</span>
          </div>
        </Focusable>
        <Tooltip>{look.name}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}

function SideTab({
  id,
  look,
  fixed = false,
  selected,
  onSelect,
  onClose,
}: {
  id: string;
  look: Look;
  fixed?: boolean;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  return (
    <div
      role="presentation"
      className={T.tabItem({ isActive: selected, isHovered: hovered && !selected, isDragging: false, isFixed: fixed })}
      style={T.inheritIcon}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onMouseDown={(event) => {
        // 中键按下时不要进浏览器的自动滚动。
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <TooltipTrigger delay={500}>
        <Focusable>
          <div
            role="tab"
            id={botSideTabId(id)}
            aria-controls={BOT_SIDE_PANEL}
            aria-selected={selected}
            aria-label={look.aria}
            tabIndex={selected ? 0 : -1}
            className={T.tabTarget}
            onClick={onSelect}
          >
            {look.icon}
            <span className={T.tabName}>{look.name}</span>
            {look.extra}
          </div>
        </Focusable>
        <Tooltip>{look.name}</Tooltip>
      </TooltipTrigger>
      <span className={T.closeSlot({ isShown: selected || hovered || focusWithin })}>
        <ActionButton size="XS" isQuiet aria-label={C.side.close(look.name)} onPress={onClose}>
          <Close />
        </ActionButton>
      </span>
    </div>
  );
}

const seam = style({
  position: 'relative',
  flexShrink: 0,
  alignSelf: 'stretch',
  width: 8,
  marginX: -4,
  zIndex: 5,
  cursor: 'col-resize',
  touchAction: 'none',
});
/** 两栏之间那根 2px 的分界，悬停与拖动时变蓝（原型 `.bot__seam`）。 */
const seamBar = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetStart: '[3px]',
  width: 2,
  backgroundColor: { default: 'gray-100', isActive: 'blue-800' },
  transition: 'default',
});
const seamFocus = style({
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  outlineOffset: -2,
});
const dragShield = style({ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'col-resize', userSelect: 'none' });

/**
 * 两栏之间的分隔条（原型 page-bot-side.jsx `BotSideSeam`）：调的是它右边那一栏（中间 ∣ 右栏）时往左拖变宽；
 * `grows` 时调的是左边那一栏（占满时的左栏），往右拖变宽。方向键每次 16；双击回到默认宽。
 * 拖动时铺一层透明遮罩，指针一直是调宽的样子、也不会选中文字（同 Home 的 DockSeam）。
 */
export function BotSideSeam({
  width,
  min,
  max,
  grows = false,
  label,
  onResize,
  onReset,
}: {
  width: number;
  min: number;
  max: number;
  grows?: boolean;
  label: string;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const start = useRef<{ id: number; x: number; width: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sign = grows ? 1 : -1;
  const follow = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = start.current;
    if (from?.id === event.pointerId) onResize(from.width + sign * (event.clientX - from.x));
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current?.id !== event.pointerId) return;
    start.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <>
      <div
        className={`${seam} ${seamFocus}`}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width}
        title={C.side.resizeHint}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          if (event.button !== 0 || start.current) return;
          event.preventDefault();
          start.current = { id: event.pointerId, x: event.clientX, width };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) finish(event);
          else follow(event);
        }}
        onPointerUp={(event) => {
          // 快速拖动可能合并 pointermove，仍处理松手位置。
          follow(event);
          finish(event);
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={onReset}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          onResize(width + sign * (event.key === 'ArrowLeft' ? -16 : 16));
        }}
      >
        <div className={seamBar({ isActive: hovered || dragging })} />
      </div>
      {dragging ? createPortal(<div className={`${dragShield} bc-no-drag`} aria-hidden="true" />, document.body) : null}
    </>
  );
}
