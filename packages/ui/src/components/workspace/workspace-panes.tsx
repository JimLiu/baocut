import { Activity, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FileTarget, Id } from '@baocut/protocol';
import { ProgressCircle } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { WORKSPACE_COPY } from '../../copy.ts';
import { itemKey, targetKey, type WorkspaceItem } from '../../model/workspace.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { VideoEditor } from '../editor/video-editor.tsx';
import { FilePane } from '../file-pane.tsx';
import { ProjectFiles } from './project-files.tsx';
import { WebTab } from './web-tab.tsx';
import { WORKSPACE_OVERLAY_ATTRIBUTE } from './workspace-overlay.ts';
import { workspacePanelId, workspaceTabId } from './workspace-tabs.tsx';

/** 原型 home-workspace.css `.home-workspace__panes` / `.home-workspace__pane`：隐藏的用 display none（样式宏的 flex 会盖过 [hidden]）。 */
const panes = style({
  position: 'relative',
  display: { default: 'flex', isHidden: 'none' },
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
  minHeight: 0,
});
const pane = style({
  display: { default: 'flex', isHidden: 'none' },
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
  minHeight: 0,
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  outlineOffset: -2,
});
const centered = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  flexGrow: 1,
  padding: 24,
  font: 'ui',
  color: 'gray-600',
  textAlign: 'center',
});

/**
 * 功能区的内容（产品设计 §3.3，原型 home-workspace.jsx `HomeWorkspace` 的 panes）：每个标签一块 role=tabpanel，
 * 不是当前标签时隐藏但不卸载。视频只有一个编辑器：它不跟着某个标签或某条会话走，而是跟着打开的视频走——
 * 换标签、换会话都不关视频，编辑器用 React 19 的 `<Activity>` 收起（暂停播放、停掉效果与快捷键，保留选区、播放头与撤销栈）。
 * 网页标签常驻挂载（原生视图挂上时建、卸下时销毁），隐藏时只传 `active={false}`。
 * 浏览器预览里实测过：视频标签与文件标签来回切，编辑器是同一个 DOM 节点、播放头不变，也不发 videos.open / close；
 * 关掉视频标签才发 videos.close。桌面端（Electron）未实测。
 */
export function WorkspacePanes({
  conversationId,
  book,
  tabs,
  active,
  visible,
}: {
  conversationId: Id | null;
  /** 这组标签的键（`workspaceKey`）：换会话时整组换掉。 */
  book: string;
  tabs: WorkspaceItem[];
  active: string | null;
  /** 右侧区域显示着（有当前标签且没有收起）。 */
  visible: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const covered = useCovered(rootRef);
  const openKey = useVideo((s) => (s.video ? targetKey(s.video.target) : null));
  const current = visible ? tabs.find((t) => itemKey(t) === active) : undefined;
  // 当前标签就是打开着的视频：编辑器那一格接管这个标签的面板 id。
  const editorKey = current?.kind === 'video' && targetKey(current.target) === openKey ? itemKey(current) : null;

  return (
    <div ref={rootRef} className={panes({ isHidden: !visible })}>
      {tabs.map((item) => {
        const key = itemKey(item);
        if (key === editorKey) return null;
        const shown = visible && key === active;
        return (
          <Pane key={`${book}:${key}`} paneKey={key} shown={shown}>
            <PaneContent item={item} conversationId={conversationId} book={book} shown={shown} webVisible={!covered} />
          </Pane>
        );
      })}
      {openKey ? <EditorPane paneKey={editorKey} /> : null}
    </div>
  );
}

/** 一个标签的面板。隐藏时把里面的播放器停下（网页视图由 WebTab 按 `active` 自己隐藏）。 */
function Pane({ paneKey, shown, children }: { paneKey: string; shown: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown) return;
    ref.current?.querySelectorAll<HTMLMediaElement>('video, audio').forEach((media) => media.pause());
  }, [shown]);
  return (
    <div
      ref={ref}
      id={workspacePanelId(paneKey)}
      role="tabpanel"
      aria-labelledby={workspaceTabId(paneKey)}
      tabIndex={0}
      className={pane({ isHidden: !shown })}>
      {children}
    </div>
  );
}

/** 编辑器那一格：打开着视频就一直挂着；不是当前标签时 Activity 收起，并把播放状态归位。 */
function EditorPane({ paneKey }: { paneKey: string | null }) {
  const shown = paneKey !== null;
  useEffect(() => {
    // 收起时引擎的效果清理会停下播放（dispose → pause）；store 里的播放状态跟着归位，回来时不显示成在播。
    if (!shown) useEditor.getState().setPlaying(false);
  }, [shown]);
  const panel = paneKey !== null ? { id: workspacePanelId(paneKey), role: 'tabpanel', 'aria-labelledby': workspaceTabId(paneKey), tabIndex: 0 } : {};
  return (
    <div {...panel} className={pane({ isHidden: !shown })}>
      <Activity mode={shown ? 'visible' : 'hidden'}>
        <VideoEditor />
      </Activity>
    </div>
  );
}

function PaneContent({
  item,
  conversationId,
  book,
  shown,
  webVisible,
}: {
  item: WorkspaceItem;
  conversationId: Id | null;
  book: string;
  shown: boolean;
  webVisible: boolean;
}) {
  const setWebUrl = useShell((s) => s.setWebUrl);
  const setWebTitle = useShell((s) => s.setWebTitle);
  switch (item.kind) {
    case 'video':
      // 视频标签刚切过来、编辑器还没换上这个视频（打开在下一拍发出）。
      return shown ? <Opening /> : null;
    case 'file':
      return <FilePane active={shown} fileNameHint={item.name} target={item.target} conversationId={conversationId} />;
    case 'files':
      return conversationId ? <ConversationFiles conversationId={conversationId} /> : <div className={centered}>{WORKSPACE_COPY.filesNoConversation}</div>;
    case 'web':
      return (
        <WebTab
          item={item}
          active={shown}
          visible={webVisible}
          onUrlChange={(url) => setWebUrl(book, item.id, url)}
          onTitleChange={(title) => setWebTitle(item.id, title)}
        />
      );
  }
}

function Opening() {
  return (
    <div className={centered}>
      <ProgressCircle isIndeterminate aria-label={WORKSPACE_COPY.opening} />
      <span>{WORKSPACE_COPY.opening}</span>
    </div>
  );
}

/**
 * 项目文件：点文件开单文件标签，点视频开视频标签。属于项目的会话改按项目定位（`{projectId, path}`）——
 * 列表的根就是项目目录，和 Space 打开的是同一个标签，Agent 上下文也按项目算。
 */
function ConversationFiles({ conversationId }: { conversationId: Id }) {
  const projectId = useDirectory((s) => s.conversations.find((c) => c.id === conversationId)?.projectId ?? null);
  const scoped = (target: FileTarget): FileTarget => (projectId && 'conversationId' in target ? { projectId, path: target.path } : target);
  return (
    <ProjectFiles
      conversationId={conversationId}
      onOpenFile={(target) => useShell.getState().openPane({ kind: 'file', target: scoped(target) })}
      onOpenVideo={(target) => useShell.getState().openVideo(scoped(target))}
    />
  );
}

/**
 * 原生网页视图永远盖在界面之上：有覆盖层压到功能区时让它暂时让开（整块隐藏，不做局部裁切）。React Aria 打开模态框、
 * 菜单、Popover 时会给 body 下其余的节点加 aria-hidden（或 inert），功能区在其中就算被盖住；提示框不加，不算。
 * 不加这些属性的覆盖层（标签与分栏的拖动遮罩、侧栏浮出、页签缩略卡）经 `workspace-overlay.ts` 登记，显示期间 body 带
 * `data-workspace-overlay`。侧栏浮层 100 ms、缩略卡 500 ms 后才出现，划过 Rail、普通地悬停页签不会让网页视图闪烁。
 * 未验证：浏览器预览里没有网页视图（显示「这个环境不能内嵌网页」），这条路径只在桌面端起作用。
 */
function useCovered(ref: RefObject<HTMLElement | null>): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    const check = () => {
      const element = ref.current;
      const hidden = !!element?.closest('[aria-hidden="true"], [inert]');
      setCovered(hidden || document.body.hasAttribute(WORKSPACE_OVERLAY_ATTRIBUTE));
    };
    // body 的直接子节点（弹层）进出；任意节点的 aria-hidden / inert 变化；body 上覆盖层登记的变化。
    const portals = new MutationObserver(check);
    portals.observe(document.body, { childList: true });
    const hiding = new MutationObserver(check);
    hiding.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'inert', WORKSPACE_OVERLAY_ATTRIBUTE],
    });
    check();
    return () => {
      portals.disconnect();
      hiding.disconnect();
    };
  }, [ref]);
  return covered;
}
