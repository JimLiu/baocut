import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Id } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { homeBarBounds, itemKey, summaryInHead, workspaceKey, type WorkspaceItem } from '../../model/workspace.ts';
import { untitled } from '../../copy.ts';
import { sessionStatus } from '../../model/sidebar.ts';
import { useConversationMeta } from '../../state/directory-store.ts';
import { homeMode, useShell } from '../../state/shell-store.ts';
import { ConversationHeader, DraftConversationHeader, type ConversationHeaderEnd } from '../conversation-header.tsx';
import { usePaneRegions } from '../pane-edges.ts';
import { WorkspaceTabs } from './workspace-tabs.tsx';
import { SessionSummaryButton, WorkspaceViewControls } from './workspace-view-controls.tsx';

/** 原型 home-workspace.css `.tbar__conversation`。 */
const head = style({ position: 'absolute', top: 0, bottom: 0, display: 'flex', alignItems: 'center', minWidth: 0 });
/**
 * 原型 `.tbar__workspace`：右端让开右侧按钮组（量出来的，见 homeBarBounds）。
 * 空白继承标题栏的窗口拖动区；WorkspaceTabs 只让实际标签区域让开，保留标签拖动排序。
 * 会话头里的文字仍可拖窗口，按钮由 app.css 让开。
 */
const strip = style({ position: 'absolute', top: 0, bottom: 0, display: 'flex', minWidth: 0 });

const NO_TABS: WorkspaceItem[] = [];

/**
 * Home 的标题栏（产品设计 §2.5、§3.3 用户修订，原型 shell.jsx `Titlebar` 的 home 分支）：会话头从内容区左缘排到会话列的缝，
 * 右边是功能区的标签条，最右是视图按钮组 [会话摘要][完整视图][标签页]。
 * 功能区收起时会话头排到按钮组左缘前 4px，··· 与按钮组读作一组；分屏可见时摘要跟在会话头 ··· 后面。
 * 单条标签条（窄窗口或完整视图）：标题栏只放标签条，从内容区左缘开始，第一格是会话；会话头回到会话面板顶部（HomePage）。
 * 草稿工作区开了标签时，会话头的位置放「新会话」占位头。
 */
export function HomeTitleBar({
  conversationId,
  projectId,
  pane,
  bar,
  nav,
}: {
  conversationId: Id | null;
  projectId: Id | null;
  pane: WorkspaceItem | null;
  bar: RefObject<HTMLElement | null>;
  nav: RefObject<HTMLElement | null>;
}) {
  const tabs = useShell((s) => s.workspaces[workspaceKey(conversationId, projectId)]?.tabs ?? NO_TABS);
  const mode = useShell(useShallow(homeMode));
  const conversation = useConversationMeta(conversationId) ?? null;
  const regions = usePaneRegions();
  const controls = useRef<HTMLDivElement>(null);
  const [, setControlsLeft] = useState<number | null>(null);
  const hasPane = !!mode?.visible;
  const single = !!mode?.single;
  const inHead = summaryInHead({ visible: hasPane, single, count: tabs.length });
  const status = conversation ? sessionStatus(conversation) : null;
  const [bounds, setBounds] = useState<{ left: number; split: number; right: number } | null>(null);

  // 按钮组的按钮数随标签、会话与视图变化：尺寸一变就重画一次，下面的布局效果重新量它的左缘（没有按钮时当作没有这一组）。
  useLayoutEffect(() => {
    const element = controls.current;
    if (!element) {
      setControlsLeft(null);
      return;
    }
    const sync = () => {
      const rect = element.getBoundingClientRect();
      const next = rect.width ? Math.round(rect.left) : null;
      setControlsLeft((old) => (old === next ? old : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode?.key]);

  // 每次渲染后对一次：区域的左右缘由 usePaneRegions 推过来，标题栏、后退前进与按钮组的位置在这里量。
  useLayoutEffect(() => {
    const box = bar.current?.getBoundingClientRect();
    const navRight = nav.current?.getBoundingClientRect().right;
    if (!box || navRight === undefined) return;
    const rect = controls.current?.getBoundingClientRect();
    const left = rect && rect.width ? Math.round(rect.left) : null;
    const next = homeBarBounds({
      origin: box.left,
      width: box.width,
      navRight,
      content: regions['home-content'] ?? null,
      conversationRight: regions['home-conversation']?.right ?? null,
      controlsLeft: left,
      hasPane,
      single,
    });
    setBounds((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  });

  // 窄窗口与完整视图里功能区收起（或没有标签）就是选中了会话标签。
  const conversationSelected = single && !hasPane;
  const end: ConversationHeaderEnd | undefined = !hasPane ? 'joined' : inHead ? 'summary' : undefined;
  const showHead = !single && (conversation || tabs.length > 0);
  return (
    <>
      {showHead ? (
        <div className={head} style={bounds ? { left: bounds.left, width: Math.max(0, bounds.split - bounds.left) } : { left: 260, right: 88 }}>
          {conversation ? (
            <ConversationHeader conversation={conversation} end={end} trailing={inHead ? <SessionSummaryButton conversation={conversation} /> : null} />
          ) : (
            <DraftConversationHeader end={end} />
          )}
        </div>
      ) : null}
      {(hasPane || single) && bounds ? (
        <div className={strip} style={{ left: bounds.split, right: bounds.right }}>
          <WorkspaceTabs
            tabs={tabs}
            active={pane && !conversationSelected ? itemKey(pane) : null}
            conversation={
              single
                ? {
                    title: conversation?.title || untitled(),
                    status: status === 'running' || status === 'waiting' ? status : null,
                    selected: conversationSelected,
                  }
                : undefined
            }
          />
        </div>
      ) : null}
      <WorkspaceViewControls ref={controls} conversation={conversation} />
    </>
  );
}
