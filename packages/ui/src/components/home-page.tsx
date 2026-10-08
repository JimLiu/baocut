import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Id } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { WORKSPACE_COPY } from '../copy.ts';
import {
  CONVERSATION_TAB,
  DEFAULT_VIEW,
  DOCK_DEFAULT,
  DOCK_MIN,
  PANE_MIN_WIDTH,
  dockFor,
  isNarrow,
  itemKey,
  workspaceKey,
  workspaceMode,
  type WorkspaceItem,
} from '../model/workspace.ts';
import { useConversationMeta } from '../state/directory-store.ts';
import { useShell } from '../state/shell-store.ts';
import { ConversationHeader } from './conversation-header.tsx';
import { ConversationView } from './conversation-view.tsx';
import { HomeSidebar } from './home-sidebar.tsx';
import { homeContentRegion, homeConversationRegion, paneEdge } from './pane-edges.ts';
import { StartPage } from './start-page.tsx';
import { useWorkspaceOverlay } from './workspace/workspace-overlay.ts';
import { WorkspacePanes } from './workspace/workspace-panes.tsx';
import { workspacePanelId, workspaceTabId } from './workspace/workspace-tabs.tsx';

const layout = style({ display: 'flex', flexGrow: 1, minHeight: 0 });
/** 原型 home-workspace.css `.home-workspace`。 */
const content = style({ position: 'relative', display: 'flex', flexGrow: 1, minWidth: 0, minHeight: 0 });
/**
 * 原型 `.home-workspace__conversation`：没有右侧区域时占满；旁边有右侧区域时宽度可拖（至少 320，右侧正常显示时保留至少 320），
 * 右沿那根 2px 的线连到标题栏；单条标签条（窄窗口或完整视图）里选中了别的标签时隐藏但不卸载（草稿与滚动位置都在）。
 */
const column = style({
  display: { default: 'flex', isHidden: 'none' },
  flexDirection: 'column',
  minHeight: 0,
  boxSizing: 'border-box',
  backgroundColor: 'gray-25',
  flexGrow: { default: 1, isDocked: 0 },
  flexShrink: { default: 1, isDocked: 0 },
  minWidth: { default: 0, isDocked: 320 },
  maxWidth: { default: '[100%]', isDocked: '[calc(100% - 320px)]' },
  position: 'relative',
  borderEndWidth: { default: 0, isDocked: 2 },
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
/** 单条标签条（窄窗口或完整视图）里会话头在会话面板顶部（原型 apprail.css `.hhd`）：至少 56 高，左右 20（会话头自带 12），下边 2px 的分隔。 */
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
/** 原型 ui.css `.seam--dock`：骑在会话列右沿上的 8px 拖动热区，悬停或拖动时那根线变成蓝色。 */
const seam = style({
  position: 'relative',
  flexShrink: 0,
  alignSelf: 'stretch',
  width: 8,
  marginStart: -4,
  marginEnd: -4,
  zIndex: 5,
  cursor: 'col-resize',
  touchAction: 'none',
});
const dragShield = style({ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'col-resize', userSelect: 'none' });
const seamBar = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetStart: 2,
  width: 2,
  backgroundColor: { default: 'transparent', isActive: 'blue-800' },
  transition: 'default',
});

const NO_TABS: WorkspaceItem[] = [];

/** 停靠着的会话列：右沿是标题栏里的一根分界，也是标题栏会话头的右界。 */
function dockedColumn(element: HTMLElement) {
  const offEdge = paneEdge(element);
  const offRegion = homeConversationRegion(element);
  return () => {
    offEdge();
    offRegion();
  };
}

/**
 * Home：左边会话侧栏，中间是当前会话或新会话的起始页，右边是功能区（产品设计 §3，原型 home-workspace.jsx `HomeWorkspace`）。
 * 功能区是一组标签（视频、文件、项目文件、网页），按会话记住；当前标签跟着路由走（§2.5、§3.3 用户修订）。
 * 标签条、会话头与视图控件在标题栏里（HomeTitleBar）；会话列与右侧标签共用一个宽度。
 * 窄窗口（放不下会话列与编辑器）与完整视图都是单条标签条：会话是标签条的第一格，会话头移到会话面板顶部，同一时间只显示会话
 * 或一个标签；没显示的一侧不卸载（产品设计 §2.5、§3.3）。视图（收起、完整视图）按工作区记住。
 */
export function HomePage({ conversationId, projectId, pane }: { conversationId: Id | null; projectId: Id | null; pane: WorkspaceItem | null }) {
  const book = workspaceKey(conversationId, projectId);
  const tabs = useShell((s) => s.workspaces[book]?.tabs ?? NO_TABS);
  const view = useShell((s) => s.views[book] ?? DEFAULT_VIEW);
  const narrow = useShell((s) => s.workspaceNarrow);
  const dockWidth = useShell((s) => s.dockWidth);
  const meta = useConversationMeta(conversationId);
  const columnRef = useRef<HTMLElement | null>(null);
  const measured = useRef(false);
  const [contentWidth, setContentWidth] = useState(0);
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);

  const { visible, single } = workspaceMode({ active: pane ? itemKey(pane) : null, count: tabs.length, view, narrow });
  const docked = visible && !single;
  // 单条标签条里显示着标签就是没选会话标签。
  const conversationHidden = visible && single;

  // 两个 ref 回调都是稳定的：只在停靠状态变了时挂上或卸下，不会每次渲染都重新量。
  const dockRef = useCallback((element: HTMLElement) => {
    columnRef.current = element;
    const off = dockedColumn(element);
    return () => {
      off();
      columnRef.current = null;
    };
  }, []);
  const contentRef = useCallback((element: HTMLDivElement) => {
    setContentElement(element);
    const off = homeContentRegion(element);
    return () => {
      off();
      setContentElement(null);
    };
  }, []);

  // 容器放不下最窄会话列与编辑器时是窄窗口。第一次量只记录模式（窄窗口深链仍显示标签）；
  // 之后从并排切到单列时，焦点在会话区里就选会话标签。
  useLayoutEffect(() => {
    if (!contentElement) return;
    const sync = () => {
      const initial = !measured.current;
      measured.current = true;
      const width = contentElement.getBoundingClientRect().width;
      setContentWidth(width);
      useShell.getState().setWorkspaceNarrow(isNarrow(width), {
        initial,
        focusInConversation: !!document.activeElement?.closest('[data-home-conversation]'),
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(contentElement);
    return () => observer.disconnect();
  }, [contentElement]);

  const conversation = conversationId ? (
    <ConversationView key={conversationId} conversationId={conversationId} />
  ) : (
    <StartPage key={projectId ?? 'none'} projectId={projectId} />
  );

  return (
    <div className={layout}>
      <HomeSidebar />
      <div ref={contentRef} className={content}>
        <section
          ref={docked ? dockRef : undefined}
          className={column({ isDocked: docked, isHidden: conversationHidden })}
          style={docked ? { width: dockWidth } : undefined}
          data-home-conversation
          {...(single
            ? { id: workspacePanelId(CONVERSATION_TAB), role: 'tabpanel', 'aria-labelledby': workspaceTabId(CONVERSATION_TAB) }
            : { 'aria-label': WORKSPACE_COPY.conversation })}>
          {single && meta ? (
            <div className={narrowHead}>
              <ConversationHeader conversation={meta} />
            </div>
          ) : null}
          {conversation}
        </section>
        <DockSeam key={book} column={columnRef} width={dockWidth} contentWidth={contentWidth} enabled={docked} />
        <WorkspacePanes conversationId={conversationId} book={book} tabs={tabs} active={pane ? itemKey(pane) : null} visible={visible} />
      </div>
    </div>
  );
}

/** 保持手柄挂载直到手势结束：收起后同一次拖动回拉仍可展开；双击恢复默认宽度。 */
function DockSeam({ column, width, contentWidth, enabled }: {
  column: { current: HTMLElement | null }; width: number; contentWidth: number; enabled: boolean;
}) {
  const start = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  // 拖动期间登记为覆盖层：Electron 原生网页暂时让开，免得吞掉拖动事件。
  useWorkspaceOverlay(dragging);
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = start.current;
    if (from?.pointerId === event.pointerId) useShell.getState().resizeWorkspace(from.width + event.clientX - from.x, contentWidth);
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current?.pointerId !== event.pointerId) return;
    start.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  if (!enabled && !dragging) return null;
  return <>
    <div
      className={seam}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={WORKSPACE_COPY.resize}
      aria-valuemin={DOCK_MIN}
      aria-valuemax={Math.max(DOCK_MIN, contentWidth - PANE_MIN_WIDTH)}
      aria-valuenow={dockFor(contentWidth, width)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(event) => {
        if (event.button !== 0 || start.current) return;
        event.preventDefault();
        start.current = { x: event.clientX, width: column.current?.getBoundingClientRect().width ?? dockFor(contentWidth, width), pointerId: event.pointerId };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0) end(event);
        else resize(event);
      }}
      onPointerUp={(event) => {
        // 快速拖动可能合并 pointermove，仍处理松手位置。
        resize(event);
        end(event);
      }}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        useShell.getState().resizeWorkspace(dockFor(contentWidth, width) + (event.key === 'ArrowRight' ? 10 : -10), contentWidth);
      }}
      onDoubleClick={() => useShell.getState().setDockWidth(DOCK_DEFAULT)}>
      <div className={seamBar({ isActive: hovered || dragging })} />
    </div>
    {dragging ? createPortal(<div className={`${dragShield} bc-no-drag`} aria-hidden="true" />, document.body) : null}
  </>;
}
