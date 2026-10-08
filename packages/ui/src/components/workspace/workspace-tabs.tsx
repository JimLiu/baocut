import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { newId } from '@baocut/protocol';
import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Close from '@react-spectrum/s2/icons/Close';
import Comment from '@react-spectrum/s2/icons/Comment';
import FileText from '@react-spectrum/s2/icons/FileText';
import Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import Folder from '@react-spectrum/s2/icons/Folder';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Focusable, VisuallyHidden } from 'react-aria-components';
import { WORKSPACE_COPY } from '../../copy.ts';
import { TAB_PREVIEW_DELAY_MS, tabPreviewSubtitle } from '../../model/shell-peek.ts';
import {
  CONVERSATION_TAB,
  closeTab,
  dragOffsets,
  dragTarget,
  entryOfTarget,
  itemKey,
  tabKeyIndex,
  targetKey,
  webTitle,
  workspaceTitle,
  type TabRect,
  type WorkspaceItem,
} from '../../model/workspace.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { STATUS_WORD } from '../conversation-header.tsx';
import { useWorkspaceOverlay } from './workspace-overlay.ts';
import { WorkspaceTabPreview } from './workspace-tab-preview.tsx';

/** 标签与它的内容面板互相指向（role=tab 的 aria-controls / role=tabpanel 的 aria-labelledby）。 */
export const workspaceTabId = (key: string) => `workspace-tab-${encodeURIComponent(key)}`;
export const workspacePanelId = (key: string) => `workspace-panel-${encodeURIComponent(key)}`;
/** 单条标签条里会话那个固定的第一个标签；定义在 model/workspace.ts，这里转出给原来的引用方。 */
export { CONVERSATION_TAB };

/** 单条标签条（窄窗口或完整视图）的会话标签：标题、进行中 / 等待批准，以及它是不是当前选中的。 */
export interface ConversationTabInfo {
  title: string;
  status: 'running' | 'waiting' | null;
  selected: boolean;
}

/** 标签名：打开着的视频用它最新的名字，网页用页面标题，其余按 Space 条目，找不到时用路径末段。 */
export function useWorkspaceTitle(): (item: WorkspaceItem) => string {
  const entries = useSpace((s) => s.entries);
  const webTitles = useShell((s) => s.webTitles);
  const openKey = useVideo((s) => (s.video ? targetKey(s.video.target) : null));
  const openName = useVideo((s) => s.video?.state?.video.name ?? s.video?.ref?.name ?? null);
  return (item) => {
    if (item.kind === 'files') return workspaceTitle(item);
    if (item.kind === 'web') return workspaceTitle(item, webTitles[item.id]);
    const live = item.kind === 'video' && openKey === targetKey(item.target) ? openName : null;
    return workspaceTitle(item, live ?? entryOfTarget(entries, item.target)?.name);
  };
}

// Compact workflow canvas; independent of the tab label's font size.
const icon = { width: 'var(--bc-icon-compact)', height: 'var(--bc-icon-compact)' };

export function WorkspaceTabIcon({ item }: { item: WorkspaceItem }) {
  if (item.kind === 'video') return <Filmstrip UNSAFE_style={icon} />;
  if (item.kind === 'web') return <GlobeGrid UNSAFE_style={icon} />;
  if (item.kind === 'files') return <Folder UNSAFE_style={icon} />;
  return <FileText UNSAFE_style={icon} />;
}

const strip = style({ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, flexGrow: 1, minWidth: 0, paddingX: 8, paddingY: '[6px]' });
/** role=tablist：会话标签（单条标签条）、分隔线与可拖动的滚动列表。 */
const tablist = style({ display: 'flex', alignItems: 'stretch', gap: 4, flexGrow: 0, flexShrink: 1, minWidth: 0, height: 32 });
const list = style({
  display: 'flex',
  alignItems: 'stretch',
  gap: 4,
  flexGrow: 0,
  flexShrink: 1,
  minWidth: 0,
  height: 32,
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'none',
});
const tabItem = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: { default: 160, lg: 240 },
  minWidth: 120,
  maxWidth: 240,
  boxSizing: 'border-box',
  paddingStart: 8,
  paddingEnd: 4,
  borderRadius: 'default',
  touchAction: 'none',
  userSelect: 'none',
  transition: 'default',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isActive: 'gray-25', isDragging: 'gray-100' },
  color: { default: 'gray-600', isHovered: 'gray-800', isActive: 'gray-900' },
  outlineStyle: { default: 'none', isActive: 'solid', isDragging: 'dashed' },
  outlineWidth: { default: 1, isDragging: 2 },
  outlineColor: { default: 'gray-100', isDragging: 'blue-900' },
  outlineOffset: { default: -1, isDragging: -2 },
  opacity: { default: 1, isDragging: 0.35 },
});
const tabTarget = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexGrow: 1,
  minWidth: 0,
  height: 32,
  borderRadius: 'default',
  font: 'ui-sm',
  // `font` 会带上自己的文字颜色；跟着外层标签的灰阶走（原型 `.home-tabs__select { color: inherit }`）。
  color: '[inherit]',
  cursor: 'default',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  outlineOffset: 2,
});
const tabName = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/** 关闭钮一直占位，出现时不改变标题的截断；看不见时也点不到。 */
const closeSlot = style({
  display: 'flex',
  flexShrink: 0,
  opacity: { default: 0, isShown: 1 },
  pointerEvents: { default: 'none', isShown: 'auto' },
});
const closeIcon = iconStyle({ size: 'XS' });
const shield = style({ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'grabbing', userSelect: 'none' });
const ghost = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  paddingX: 8,
  boxSizing: 'border-box',
  borderRadius: 'default',
  backgroundColor: 'gray-25',
  font: 'ui-sm',
  color: 'gray-900',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'blue-900', isOutside: 'gray-500' },
  boxShadow: 'elevated',
  opacity: { default: 1, isOutside: 0.6 },
  pointerEvents: 'none',
});
/**
 * 单条标签条的会话标签（原型 home-workspace.css `.home-tabs__conversation`）：淡蓝底常驻，悬停加深，选中加一圈 blue-300；
 * 文字与图标沿用标签的灰阶。没有关闭钮，左右一样留 8。
 */
const conversationItem = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: '[180px]',
  minWidth: 120,
  maxWidth: '[220px]',
  boxSizing: 'border-box',
  paddingX: 8,
  borderRadius: 'default',
  userSelect: 'none',
  transition: 'default',
  backgroundColor: { default: 'blue-100', isHovered: 'blue-200' },
  color: { default: 'gray-600', isHovered: 'gray-800', isActive: 'gray-900' },
  outlineStyle: { default: 'none', isActive: 'solid' },
  outlineWidth: 1,
  outlineColor: 'blue-300',
  outlineOffset: -1,
});
const conversationName = style({
  flexGrow: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 'medium',
});
const glyph = style({ position: 'relative', display: 'flex', flexShrink: 0 });
/** 状态点：进行中蓝、等待批准橙，描一圈标签的底色把它和图标隔开；含义另由提示与读屏名称说出。 */
const statusDot = style({
  position: 'absolute',
  top: '[-2px]',
  insetEnd: '[-2px]',
  size: 8,
  borderRadius: 'full',
  backgroundColor: { default: 'blue-900', isWaiting: 'orange-900' },
  outlineStyle: 'solid',
  outlineWidth: 2,
  outlineColor: { default: 'blue-100', isHovered: 'blue-200' },
});
/** 会话标签与可拖动的标签之间的竖线：上下各留 8。 */
const separator = style({ flexShrink: 0, alignSelf: 'stretch', width: '[1px]', marginY: 8, marginX: 2, backgroundColor: 'gray-300' });
/** 让 S2 图标跟着标签的文字颜色（普通 / 悬停 / 当前）。 */
const inheritIcon = { '--iconPrimary': 'currentColor' } as CSSProperties;

interface Drag {
  key: string;
  item: WorkspaceItem;
  element: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  width: number;
  offsetX: number;
  offsetY: number;
  scrollLeft: number;
  rects: TabRect[];
  active: boolean;
  target: { key: string; after: boolean } | null;
}

/** 悬停缩略卡要显示的页签：会话页签的 `item` 是 'conversation'；`rect` 是进入页签时量的矩形。 */
interface HoverTab {
  key: string;
  item: WorkspaceItem | 'conversation';
  title: string;
  rect: { left: number; bottom: number };
}

/** 页签的悬停回调：进入时开始 500 ms 计时，离开、按下或开始拖动时取消。 */
interface HoverHandlers {
  onHoverStart: (rect: DOMRect) => void;
  onHoverEnd: () => void;
}

interface Preview {
  key: string;
  item: WorkspaceItem;
  width: number;
  x: number;
  y: number;
  offsets: Record<string, number>;
  valid: boolean;
}

/**
 * 功能区标签条（原型 home-workspace.jsx `WorkspaceTabs`）：浏览器式标签，选中与关闭分开。
 * 键盘：←/→ 循环、Home/End、Enter/空格选中、Delete 关闭、Alt+Shift+←/→ 挪位置；中键关闭；
 * 拖动排序：过 6px 才算拖、松手才落位，Esc / 失焦 / 切走窗口取消；读屏播报拖动过程。末尾的「+」打开新标签页（空白网页标签）。
 */
export function WorkspaceTabs({
  tabs,
  active,
  conversation,
}: {
  tabs: WorkspaceItem[];
  /** 选中的标签；单条标签条里选中会话标签时为 null。 */
  active: string | null;
  /** 只有单条标签条（窄窗口或完整视图）才传：会话是排在最前面的固定标签，不能拖动或关闭，别的标签也排不到它前面。 */
  conversation?: ConversationTabInfo;
}) {
  const title = useWorkspaceTitle();
  const selectPane = useShell((s) => s.selectPane);
  const showConversation = useShell((s) => s.showConversation);
  const closePane = useShell((s) => s.closePane);
  const openPane = useShell((s) => s.openPane);
  const movePane = useShell((s) => s.movePane);
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // 拖动标签期间登记为覆盖层：Electron 的网页视图暂时让开，免得盖住拖动的标签。
  useWorkspaceOverlay(!!preview);
  const [announcement, announce] = useState('');
  const entries = useSpace((s) => s.entries);
  // 悬停缩略卡（产品设计 §3.3）：指针停留 500 ms 显示；离开、按下或拖动时取消。
  const [hoverTab, setHoverTab] = useState<HoverTab | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const clearHover = () => {
    clearTimeout(hoverTimer.current);
    setHoverTab(null);
  };
  const hover = (key: string, item: WorkspaceItem | 'conversation', name: string): HoverHandlers => ({
    onHoverStart: (rect) => {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        if (!drag.current) setHoverTab({ key, item, title: name, rect: { left: rect.left, bottom: rect.bottom } });
      }, TAB_PREVIEW_DELAY_MS);
    },
    onHoverEnd: clearHover,
  });

  const narrow = !!conversation;
  useLayoutEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length, narrow]);

  // 没有标签可去时：单条标签条落到会话标签，并排时落到会话头的按钮。
  const focusTab = (key: string | null) => {
    const target = key
      ? document.getElementById(workspaceTabId(key))
      : narrow
        ? document.getElementById(workspaceTabId(CONVERSATION_TAB))
        : document.querySelector<HTMLElement>('[data-workspace-head] button');
    target?.focus();
  };

  const select = (item: WorkspaceItem) => selectPane(itemKey(item));
  const selectConversation = () => {
    showConversation();
    focusTab(CONVERSATION_TAB);
  };

  const close = (item: WorkspaceItem) => {
    const key = itemKey(item);
    const next = closeTab({ tabs, active }, key);
    closePane(key);
    // 选中的是会话标签时，关掉别的标签不把视图带走，焦点回到会话标签。
    requestAnimationFrame(() => focusTab(conversation?.selected ? CONVERSATION_TAB : next.active));
  };

  const finishDrag = () => {
    const current = drag.current;
    drag.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    setPreview(null);
  };

  useEffect(() => {
    const cancel = () => {
      if (drag.current?.active) announce(WORKSPACE_COPY.dragCancelled);
      finishDrag();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  const updatePreview = () => {
    const current = drag.current;
    const element = listRef.current;
    if (!current?.active || !element) return;
    const bounds = element.getBoundingClientRect();
    // 槽位按按下时量的，列表滚动了就整体平移。
    const shift = element.scrollLeft - current.scrollLeft;
    const rects = current.rects.map((r) => ({ ...r, left: r.left - shift }));
    const inside =
      current.cy >= bounds.top - 24 && current.cy <= bounds.bottom + 24 && current.cx >= bounds.left - 24 && current.cx <= bounds.right + 24;
    current.target = inside ? dragTarget(rects, current.key, current.cx) : null;
    setPreview({
      key: current.key,
      item: current.item,
      width: current.width,
      x: Math.max(0, Math.min(window.innerWidth - current.width, current.cx - current.offsetX)),
      y: Math.max(4, Math.min(window.innerHeight - 40, current.cy - current.offsetY)),
      offsets: dragOffsets(rects, current.key, current.target),
      valid: inside,
    });
  };

  const autoScroll = () => {
    const current = drag.current;
    const element = listRef.current;
    if (!current?.active || !element) return;
    const bounds = element.getBoundingClientRect();
    if (current.cy >= bounds.top - 24 && current.cy <= bounds.bottom + 24) {
      const speed = current.cx < bounds.left + 32 ? -8 : current.cx > bounds.right - 32 ? 8 : 0;
      const before = element.scrollLeft;
      element.scrollLeft += speed;
      if (element.scrollLeft !== before) updatePreview();
    }
    scrollFrame.current = requestAnimationFrame(autoScroll);
  };

  const onPointerDown = (item: WorkspaceItem) => (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    clearHover();
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-tab-close]') || !listRef.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    drag.current = {
      key: itemKey(item),
      item,
      element: event.currentTarget,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cx: event.clientX,
      cy: event.clientY,
      width: box.width,
      offsetX: event.clientX - box.left,
      offsetY: event.clientY - box.top,
      scrollLeft: listRef.current.scrollLeft,
      rects: [...listRef.current.querySelectorAll<HTMLElement>('[data-workspace-tab]')].map((el) => {
        const rect = el.getBoundingClientRect();
        return { key: el.dataset.workspaceTab ?? '', left: rect.left, width: rect.width };
      }),
      active: false,
      target: null,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (!(event.buttons & 1)) return finishDrag();
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.cx = event.clientX;
    current.cy = event.clientY;
    if (!current.active) {
      clearHover();
      current.element.setPointerCapture(event.pointerId);
      current.active = true;
      suppressClick.current = true;
      announce(WORKSPACE_COPY.dragging(title(current.item)));
      scrollFrame.current = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    updatePreview();
  };

  const onPointerUp = () => {
    const current = drag.current;
    if (current?.active && current.target) {
      movePane(current.key, current.target.key, current.target.after);
      announce(WORKSPACE_COPY.moved(title(current.item)));
    }
    finishDrag();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      if (drag.current.active) announce(WORKSPACE_COPY.dragCancelled);
      finishDrag();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'tab') return;
    const onConversation = narrow && target.id === workspaceTabId(CONVERSATION_TAB);
    const index = tabs.findIndex((t) => workspaceTabId(itemKey(t)) === target.id);
    const item = tabs[index];
    if (!item && !onConversation) return;
    if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      event.stopPropagation();
      // 会话标签不动；第一个真标签往左也不动（tabs[-1] 不存在），排不到会话前面。
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const neighbor = tabs[index + offset];
      if (item && neighbor) {
        movePane(itemKey(item), itemKey(neighbor), offset > 0);
        announce(WORKSPACE_COPY.moved(title(item)));
      }
      return;
    }
    // ←/→、Home/End 在「会话 + 标签」之间走：单条标签条里会话是第 0 个。
    const order = [...(narrow ? [CONVERSATION_TAB] : []), ...tabs.map(itemKey)];
    const next = tabKeyIndex(event.key, onConversation ? 0 : index + (narrow ? 1 : 0), order.length);
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      const key = order[next]!;
      if (key === CONVERSATION_TAB) showConversation();
      else selectPane(key);
      focusTab(key);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (item) select(item);
      else showConversation();
    } else if (item && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      event.stopPropagation();
      close(item);
    }
  };

  return (
    <div className={strip}>
      <div
        className={`${tablist} bc-no-drag`}
        role="tablist"
        aria-label={WORKSPACE_COPY.tablist}
        aria-description={WORKSPACE_COPY.tablistHint}
        onKeyDownCapture={onKeyDown}>
        {conversation ? (
          <>
            <ConversationTab
              info={conversation}
              onSelect={selectConversation}
              {...hover(CONVERSATION_TAB, 'conversation', conversation.title)}
              onPress={clearHover}
            />
            <span className={separator} aria-hidden="true" />
          </>
        ) : null}
        {/* 只有这一段可拖动、可滚动；拖动的槽位只量这里的 `data-workspace-tab`，会话标签天然不在其中。 */}
        <div ref={listRef} className={list} role="presentation">
          {tabs.map((item) => {
            const key = itemKey(item);
            return (
              <TabItem
                key={key}
                item={item}
                name={title(item)}
                tip={item.kind === 'web' && item.url ? item.url : title(item)}
                isActive={active === key}
                isDragging={preview?.key === key}
                offset={preview ? (preview.offsets[key] ?? 0) : null}
                onPointerDown={onPointerDown(item)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerEnd={finishDrag}
                suppressClick={suppressClick}
                onSelect={() => {
                  select(item);
                  focusTab(key);
                }}
                onClose={() => close(item)}
                {...hover(key, item, title(item))}
              />
            );
          })}
        </div>
      </div>
      <TooltipTrigger>
        <ActionButton isQuiet size="S" aria-label={WORKSPACE_COPY.add} onPress={() => openPane({ kind: 'web', id: newId('web'), url: '' })}>
          <Add />
        </ActionButton>
        <Tooltip>{WORKSPACE_COPY.add}</Tooltip>
      </TooltipTrigger>
      <VisuallyHidden>
        <span role="status">{announcement}</span>
      </VisuallyHidden>
      {hoverTab && !preview ? (
        <WorkspaceTabPreview
          key={hoverTab.key}
          panelId={workspacePanelId(hoverTab.key)}
          rect={hoverTab.rect}
          title={hoverTab.title}
          subtitle={tabPreviewSubtitle(hoverTab.item, {
            title: hoverTab.title,
            conversation: WORKSPACE_COPY.conversation,
            newTab: webTitle(''),
            entries,
          })}
        />
      ) : null}
      {/* 遮罩挂在 body 上（原型同）。 */}
      {preview
        ? createPortal(
            <div className={`${shield} bc-no-drag`} aria-hidden="true">
              <div className={ghost({ isOutside: !preview.valid })} style={{ left: preview.x, top: preview.y, width: preview.width, ...inheritIcon }}>
                <WorkspaceTabIcon item={preview.item} />
                <span className={tabName}>{title(preview.item)}</span>
                <Close styles={closeIcon} data-bc-icons="own" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * 单条标签条（窄窗口或完整视图）里会话那个固定的第一个标签（原型 home-workspace.jsx `ConversationTab`）：会话图标加会话标题。
 * 没有 `data-workspace-tab`、没有拖动处理，也没有关闭钮；提示语写明不能拖动或关闭。进行中 / 等待批准时图标右上角有点，
 * 状态也写进提示与读屏名称，不只靠颜色。
 */
function ConversationTab({
  info,
  onSelect,
  onHoverStart,
  onHoverEnd,
  onPress,
}: { info: ConversationTabInfo; onSelect: () => void; onPress: () => void } & HoverHandlers) {
  const [hovered, setHovered] = useState(false);
  const word = info.status ? STATUS_WORD[info.status] : null;
  return (
    <div
      role="presentation"
      className={conversationItem({ isActive: info.selected, isHovered: hovered && !info.selected })}
      style={inheritIcon}
      onPointerEnter={(event) => {
        setHovered(true);
        onHoverStart(event.currentTarget.getBoundingClientRect());
      }}
      onPointerLeave={() => {
        setHovered(false);
        onHoverEnd();
      }}
      onPointerDownCapture={onPress}>
      {/* 指针悬停时由缩略卡说明这个页签，自己的提示不出；键盘聚焦照旧有提示。 */}
      <TooltipTrigger delay={500} isDisabled={hovered}>
        <Focusable>
          <div
            role="tab"
            id={workspaceTabId(CONVERSATION_TAB)}
            aria-controls={workspacePanelId(CONVERSATION_TAB)}
            aria-selected={info.selected}
            aria-label={WORKSPACE_COPY.conversationTabLabel(info.title, word)}
            tabIndex={info.selected ? 0 : -1}
            className={tabTarget}
            onClick={onSelect}>
            <span className={glyph}>
              <Comment UNSAFE_style={icon} />
              {info.status ? (
                <span className={statusDot({ isWaiting: info.status === 'waiting', isHovered: hovered && !info.selected })} />
              ) : null}
            </span>
            <span className={conversationName}>{info.title}</span>
          </div>
        </Focusable>
        <Tooltip>{WORKSPACE_COPY.conversationTabTip(info.title, word)}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}

function TabItem({
  item,
  name,
  tip,
  isActive,
  isDragging,
  offset,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerEnd,
  suppressClick,
  onSelect,
  onClose,
  onHoverStart,
  onHoverEnd,
}: HoverHandlers & {
  item: WorkspaceItem;
  name: string;
  tip: string;
  isActive: boolean;
  isDragging: boolean;
  offset: number | null;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerEnd: () => void;
  suppressClick: { current: boolean };
  onSelect: () => void;
  onClose: () => void;
}) {
  const key = itemKey(item);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  return (
    <div
      role="presentation"
      data-workspace-tab={key}
      className={tabItem({ isActive, isHovered: hovered && !isActive, isDragging })}
      style={{ ...(offset !== null ? { transform: `translateX(${offset}px)` } : {}), ...inheritIcon }}
      onPointerEnter={(event) => {
        setHovered(true);
        onHoverStart(event.currentTarget.getBoundingClientRect());
      }}
      onPointerLeave={() => {
        setHovered(false);
        onHoverEnd();
      }}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onPointerDownCapture={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
        }
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
      }}>
      {/* 指针悬停时由缩略卡说明这个页签，自己的提示不出；键盘聚焦照旧有提示。 */}
      <TooltipTrigger delay={500} isDisabled={hovered}>
        <Focusable>
          <div
            role="tab"
            id={workspaceTabId(key)}
            aria-controls={workspacePanelId(key)}
            aria-selected={isActive}
            aria-label={name}
            tabIndex={isActive ? 0 : -1}
            className={tabTarget}
            onClick={onSelect}>
            <WorkspaceTabIcon item={item} />
            <span className={tabName}>{name}</span>
          </div>
        </Focusable>
        <Tooltip>{tip}</Tooltip>
      </TooltipTrigger>
      <span data-tab-close className={closeSlot({ isShown: isActive || hovered || focusWithin })}>
        <ActionButton size="XS" isQuiet aria-label={WORKSPACE_COPY.close(name)} onPress={onClose}>
          <Close />
        </ActionButton>
      </span>
    </div>
  );
}
