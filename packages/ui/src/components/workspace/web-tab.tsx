import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActionButton,
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  ProgressCircle,
  TextField,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
  type TextFieldRef,
} from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import More from '@react-spectrum/s2/icons/More';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import Search from '@react-spectrum/s2/icons/Search';
import DeviceMultiscreen from '@react-spectrum/s2/icons/DeviceMultiscreen';
import Close from '@react-spectrum/s2/icons/Close';
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import Code from '@react-spectrum/s2/icons/Code';
import Folder from '@react-spectrum/s2/icons/Folder';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { getLocale } from '@baocut/protocol';
import { WEB_TAB_COPY as COPY } from '../../copy.ts';
import type { WebHost, WebTabError, WebTabState } from '../../host.ts';
import { DEVICE_PRESETS, deviceFrame, type DeviceSize, WEB_SLOW_MS, WEB_ZOOM_STEPS, displayUrl, resolveAddress, webShortcut, zoomStep } from '../../model/web-address.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { PANEL as M } from '../panel-copy.ts';
import { WebFindBar, WebDeviceBar } from './web-view-controls.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { itemKey } from '../../model/workspace.ts';
import './web-tab.css';

const ZOOM_MIN = Math.min(...WEB_ZOOM_STEPS);
const ZOOM_MAX = Math.max(...WEB_ZOOM_STEPS);
/** 视图位置变了而大小没变时（ResizeObserver 不报），隔这么久再量一次。 */
const BOUNDS_POLL_MS = 500;

const root = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  paddingX: 12,
  paddingY: 8,
  minHeight: 56,
  boxSizing: 'border-box',
  flexShrink: 0,
  borderBottomWidth: 2,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const addressField = style({ flexGrow: 1, minWidth: 0 });
const invalidNote = style({ font: 'ui', color: 'negative', paddingX: 16, paddingY: 8, margin: 0, flexShrink: 0 });
const loadingRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingX: 16,
  paddingY: 8,
  font: 'ui-sm',
  color: 'gray-600',
  flexShrink: 0,
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const viewport = style({ position: 'relative', display: 'flex', flexGrow: 1, minHeight: 0, overflow: 'hidden' });
const placeholder = style({ flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: 'gray-25' });
const centered = style({ display: 'flex', flexGrow: 1, minWidth: 0, minHeight: 0, overflow: 'auto' });
/** 原型 `.home-browser__start`：起始、停止、失败、拒绝、不支持都是这一块。放在新标签页起始页里时（`isNested`）由外层排版。 */
const start = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  margin: { default: 'auto', isNested: 0 },
  padding: { default: 32, isNested: 0 },
  textAlign: 'center',
  font: 'ui',
  color: 'gray-600',
});
/** 原型 `.home-browser__newtab`：新标签页起始页，提示在上、「工具」在下。 */
const newtab = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 32,
  width: 'full',
  maxWidth: 560,
  margin: 'auto',
  paddingX: 24,
  paddingY: 32,
  boxSizing: 'border-box',
});
/** 原型 `.home-browser__tools` / `__tool*`：卡片网格，悬停换底色。 */
const tools = style({ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 8 });
const toolsTitle = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-600', margin: 0 });
const toolCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: 'full',
  padding: 12,
  boxSizing: 'border-box',
  textAlign: 'start',
  borderStyle: 'none',
  borderRadius: 'lg',
  cursor: { default: 'pointer', isDisabled: 'default' },
  opacity: { default: 1, isDisabled: 0.6 },
  backgroundColor: { default: 'gray-75', ':hover': 'gray-100', isDisabled: 'gray-75' },
  color: 'gray-900',
  transition: 'default',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: 2,
  outlineColor: 'focus-ring',
});
const toolIcon = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 40,
  borderRadius: 'default',
  backgroundColor: 'gray-25',
});
const toolIconGlyph = iconStyle({ color: 'neutral' });
const toolText = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const toolName = style({ font: 'ui', fontWeight: 'bold' });
const toolBody = style({ font: 'ui-sm', color: 'gray-600' });
const toolError = style({ font: 'ui-sm', color: 'negative', margin: 0, overflowWrap: 'anywhere' });
const startIcon = iconStyle({ size: 'XL', color: 'gray' });
const startTitle = style({ font: 'heading', color: 'gray-900', margin: 0 });
const startBody = style({ margin: 0, overflowWrap: 'anywhere' });
const startActions = style({ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 });
const footer = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingX: 16,
  paddingY: 8,
  font: 'ui-xs',
  color: 'gray-600',
  flexShrink: 0,
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const footerText = style({ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' });

export interface WebTabProps {
  /** 工作区里的网页标签（`WorkspaceItem` 的 `{ kind: 'web', id, url }`）。`url` 为空是新标签页。 */
  item: { id: string; url: string };
  /** 是不是当前标签：不是时原生视图隐藏，⌘L / ⌘R 也不响应。 */
  active: boolean;
  /**
   * 原生网页视图永远盖在界面之上：有对话框、菜单、命令面板之类的覆盖层压到功能区时传 false，视图暂时隐藏。默认 true。
   */
  visible?: boolean;
  /** 页面地址变了（地址栏前往、站内跳转、后退前进、重定向）：用它更新路由里的 `item.url`。 */
  onUrlChange?: (url: string) => void;
  /** 页面标题变了：用作标签名。 */
  onTitleChange?: (title: string) => void;
}

/**
 * 功能区的网页标签（产品设计 §3.3，原型 home-browser.jsx `WorkspaceBrowser`；架构设计 §12.10）。
 * 网页在宿主的独立视图里（`host.web`）：这里画工具栏、地址栏与各种状态，内容区是一块占位，
 * 把它在窗口里的矩形报给宿主。没有 `host.web` 的环境（浏览器预览）显示「这个环境不能内嵌网页」。
 */
export function WebTab(props: WebTabProps) {
  const runtime = useRuntime();
  const web = runtime.host.web;
  return web ? <WebView {...props} web={web} /> : <Unsupported url={props.item.url} tabId={props.item.id} />;
}

/** 交给系统浏览器：桌面端走宿主（只收 http/https），浏览器预览直接开新窗口。 */
function useOpenOutside(): (url: string) => void {
  const runtime = useRuntime();
  return (url: string) => {
    const open = runtime.host.openExternal;
    if (open) void open(url).catch((error: Error) => ToastQueue.negative(error.message, { timeout: 5000 }));
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
}

/**
 * 没有内嵌网页宿主（Web 客户端、浏览器预览）：说明不能内嵌网页。新标签页（还没有地址）照样显示「工具」卡片（产品设计 §3.3）。
 */
function Unsupported({ url, tabId }: { url: string; tabId: string }) {
  const openOutside = useOpenOutside();
  if (!url) {
    return (
      <div className={root}>
        <div className={centered}>
          <NewTabStart tabId={tabId}>
            <StartBlock nested title={COPY.unsupportedTitle} body={[COPY.unsupportedBody]} actions={[]} />
          </NewTabStart>
        </div>
      </div>
    );
  }
  return (
    <div className={root}>
      <div className={centered}>
        <StartBlock
          title={COPY.unsupportedTitle}
          body={[COPY.unsupportedBody, displayUrl(url)]}
          actions={[{ label: COPY.openInBrowser, onPress: () => openOutside(url) }]}
        />
      </div>
    </div>
  );
}

/**
 * 新标签页起始页（产品设计 §3.3「新标签页起始页」，原型 home-browser.jsx `NewTabStart`）：上面是提示（`children`），
 * 下面是「工具」——「新建网页」在项目目录（没有项目时是会话工作目录）里新建一个 HTML 文件，「浏览项目文件」看项目目录；
 * 两者都把这个起始页签原地换成对应的标签。还没有会话也没有项目的空白草稿不显示「新建网页」。
 */
function NewTabStart({ tabId, children }: { tabId: string; children: ReactNode }) {
  const runtime = useRuntime();
  const route = useShell((s) => s.route);
  const conversationId = route.tab === 'home' ? route.conversationId : null;
  const conversation = useDirectory((s) => (conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined));
  const projectId = (route.tab === 'home' ? route.projectId : null) ?? conversation?.projectId ?? null;
  const project = useDirectory((s) => (projectId ? s.projects.find((p) => p.id === projectId) : undefined));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const tabKey = itemKey({ kind: 'web', id: tabId, url: '' });

  const createPage = () => {
    if (pending) return;
    const scope = conversationId ? { conversationId } : projectId ? { projectId } : null;
    if (!scope) return;
    setPending(true);
    setFailure(null);
    const title = project?.name || conversation?.title || COPY.newPageFileName;
    runtime
      .createProjectFile({ ...scope, name: `${COPY.newPageFileName}.html`, content: pageSkeleton(title) })
      .then(({ target, entry }) => useShell.getState().replaceWorkspaceTab(tabKey, { kind: 'file', target, name: entry.name }))
      .catch((error: Error) => setFailure(error.message))
      .finally(() => setPending(false));
  };

  return (
    <div className={newtab}>
      {children}
      <section className={tools} aria-labelledby={`${tabId}-tools`}>
        <h3 id={`${tabId}-tools`} className={toolsTitle}>
          {COPY.toolsTitle}
        </h3>
        <div className="bc-web-tools">
          {conversationId || projectId ? (
            <button type="button" className={toolCard({ isDisabled: pending })} aria-disabled={pending || undefined} onClick={createPage}>
              <span className={toolIcon}>
                <Code styles={toolIconGlyph} />
              </span>
              <span className={toolText}>
                <span className={toolName}>{COPY.newPageTitle}</span>
                <span className={toolBody}>{COPY.newPageBody}</span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className={toolCard({ isDisabled: false })}
            onClick={() => useShell.getState().replaceWorkspaceTab(tabKey, { kind: 'files' })}>
            <span className={toolIcon}>
              <Folder styles={toolIconGlyph} />
            </span>
            <span className={toolText}>
              <span className={toolName}>{COPY.browseFilesTitle}</span>
              <span className={toolBody}>{COPY.browseFilesBody}</span>
            </span>
          </button>
        </div>
        {failure ? (
          <p className={toolError} role="alert">
            {COPY.newPageFailed}
            {' · '}
            {failure}
          </p>
        ) : null}
      </section>
    </div>
  );
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 「新建网页」写入的最小网页骨架：标题用项目名（没有时用会话名），语言跟随界面语言。 */
function pageSkeleton(title: string): string {
  const t = escapeHtml(title);
  return [
    '<!doctype html>',
    `<html lang="${getLocale()}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${t}</title>`,
    '<style>body { font-family: system-ui, sans-serif; margin: 32px; line-height: 1.6; }</style>',
    '</head>',
    '<body>',
    `<h1>${t}</h1>`,
    `<p>${escapeHtml(COPY.newPageHint)}</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** 原型 `.home-browser__start`：图标、标题、说明（可多行）、按钮。 */
function StartBlock({
  title,
  body,
  actions,
  nested = false,
}: {
  title: string;
  body: string[];
  actions: { label: string; onPress: () => void }[];
  nested?: boolean;
}) {
  return (
    <div className={start({ isNested: nested })}>
      <GlobeGrid styles={startIcon} data-bc-icons="own" />
      <h2 className={startTitle}>{title}</h2>
      {body.filter(Boolean).map((line, i) => (
        <p key={i} className={startBody}>
          {line}
        </p>
      ))}
      {actions.length ? (
        <div className={startActions}>
          {actions.map((action) => (
            <ActionButton key={action.label} onPress={action.onPress}>
              {action.label}
            </ActionButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function IconButton({ label, isDisabled, onPress, children }: { label: string; isDisabled?: boolean; onPress: () => void; children: ReactNode }) {
  // 提示放在上方：下方是原生网页视图，会盖住它。
  return (
    <TooltipTrigger placement="top">
      <ActionButton isQuiet aria-label={label} isDisabled={isDisabled} onPress={onPress}>
        {children}
      </ActionButton>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

const errorKey = (error: WebTabError | null | undefined) => (error ? JSON.stringify(error) : '');
const isWebUrl = (url: string | undefined): url is string => !!url && /^https?:/i.test(url);

type Mode = { kind: 'page' } | { kind: 'start' } | { kind: 'stopped' } | { kind: 'error'; error: WebTabError };

function WebView({ item, active, visible = true, onUrlChange, onTitleChange, web }: WebTabProps & { web: WebHost }) {
  const runtime = useRuntime();
  const openOutside = useOpenOutside();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<DeviceSize | null>(null);
  const [stage, setStage] = useState<DeviceSize>({ width: 0, height: 0 });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findFocus, setFindFocus] = useState(0);
  const [dismissedNotice, setDismissedNotice] = useState(0);
  const openFind = () => { setFindOpen(true); setFindFocus(n => n + 1); };
  const fieldRef = useRef<TextFieldRef>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [page, setPage] = useState<WebTabState | null>(null);
  const [address, setAddress] = useState(item.url);
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [slow, setSlow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [dismissed, setDismissed] = useState('');
  /** 视图正在显示或正在打开的网址：外面改 `item.url` 时据此判断要不要导航。 */
  const target = useRef('');
  const reported = useRef({ url: item.url, title: '' });
  const callbacks = useRef({ onUrlChange, onTitleChange });
  callbacks.current = { onUrlChange, onTitleChange };

  // 每个标签一个原生视图：挂上时建，卸下时销毁。
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    web.create().then(
      (id) => {
        if (!alive) return web.destroy(id);
        created = id;
        setViewId(id);
      },
      (error: Error) => alive && setViewError(error.message),
    );
    return () => {
      alive = false;
      if (created) web.destroy(created);
    };
  }, [web]);

  useEffect(() => {
    if (!viewId) return;
    return web.onState((state) => {
      if (state.id === viewId) setPage(state);
    });
  }, [web, viewId]);

  const hasPage = isWebUrl(page?.url);
  const currentUrl = hasPage ? page!.url : target.current || item.url;

  // 视图的状态推回来：地址栏（不在编辑时）、路由里的网址、标签名。
  // 只在页面地址真的变了时改：开始加载时推回来的还是旧地址，不能把刚提交的新地址冲掉。
  const lastPageUrl = useRef('');
  useEffect(() => {
    if (!page) return;
    if (isWebUrl(page.url) && page.url !== lastPageUrl.current) {
      lastPageUrl.current = page.url;
      target.current = page.url;
      if (!editing) setAddress(page.url);
      if (page.url !== reported.current.url) {
        reported.current.url = page.url;
        callbacks.current.onUrlChange?.(page.url);
      }
      setStopped(false);
    }
    if (page.title && page.title !== reported.current.title) {
      reported.current.title = page.title;
      callbacks.current.onTitleChange?.(page.title);
    }
    if (!page.error) setDismissed('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // 外面改了 `item.url`（路由恢复、从别处打开）：视图没在显示它就打开它。
  useEffect(() => {
    if (!editing) setAddress(item.url);
    if (!viewId || !item.url || item.url === target.current) return;
    target.current = item.url;
    reported.current.url = item.url;
    setStopped(false);
    setDismissed('');
    web.navigate(viewId, item.url).catch((error: Error) => setViewError(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [web, viewId, item.url]);

  const loading = !!page?.loading;
  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), WEB_SLOW_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (viewId) web.setZoom(viewId, zoom);
  }, [web, viewId, zoom]);

  const error = page?.error && errorKey(page.error) !== dismissed ? page.error : null;
  const mode: Mode = viewError
    ? { kind: 'error', error: { kind: 'failed', code: 0, description: viewError, url: item.url } }
    : error
      ? { kind: 'error', error }
      : stopped && !hasPage
        ? { kind: 'stopped' }
        : !hasPage && !item.url && !target.current
          ? { kind: 'start' }
          : { kind: 'page' };
  const showView = !!viewId && active && visible && !menuOpen && mode.kind === 'page';

  // 先报位置再显示：占位块的屏幕矩形（CSS 像素，主窗口不缩放时等于宿主的 DIP）交给宿主。
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!viewId || !showView || !el) return;
    let last = '';
    const sync = () => {
      const r = el.getBoundingClientRect();
      const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
      if (key === last) return;
      last = key;
      web.setBounds(viewId, { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener('resize', sync);
    const timer = setInterval(sync, BOUNDS_POLL_MS);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
      clearInterval(timer);
    };
  }, [web, viewId, showView]);

  useEffect(() => {
    if (viewId) web.setVisible(viewId, showView);
  }, [web, viewId, showView]);

  const navigate = (url: string) => {
    if (!viewId) return;
    target.current = url;
    setStopped(false);
    setDismissed('');
    web.navigate(viewId, url).catch((error: Error) => setViewError(error.message));
  };

  const reload = (ignoreCache = false) => {
    if (!viewId) return;
    setStopped(false);
    setDismissed('');
    const failed = page?.error?.kind === 'failed' ? page.error.url : null;
    const pending = !hasPage ? target.current || item.url : null;
    if (failed || pending) navigate((failed || pending)!);
    else web.reload(viewId, ignoreCache);
  };

  const stop = () => {
    if (!viewId) return;
    web.stop(viewId);
    if (!hasPage) setStopped(true);
  };

  const go = (raw: string) => {
    const url = resolveAddress(raw);
    if (!url) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    setAddress(url);
    fieldRef.current?.getInputElement()?.blur();
    if (url === target.current && hasPage && !page?.error) reload();
    else navigate(url);
  };

  const focusAddress = () => {
    setEditing(true);
    setAddress(currentUrl);
    requestAnimationFrame(() => {
      const input = fieldRef.current?.getInputElement();
      input?.focus();
      input?.select();
    });
  };

  // 工具栏与原生网页里的快捷键都由当前标签处理。
  const keys = useRef({ focusAddress, reload, openFind });
  keys.current = { focusAddress, reload, openFind };
  useEffect(() => web.onShortcut(event => {
    if (event.id !== viewId || !active) return;
    if (event.action === 'focus-address') keys.current.focusAddress();
    else if (event.action === 'find') keys.current.openFind();
    else keys.current.reload(event.action === 'force-reload');
  }), [web, viewId, active]);
  useEffect(() => {
    if (!active) return;
    const mac = runtime.host.platform === 'darwin';
    const onKey = (event: KeyboardEvent) => {
      const action = webShortcut(event, mac);
      if (action === 'focus-address') {
        event.preventDefault();
        event.stopPropagation();
        keys.current.focusAddress();
      } else if (action && rootRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        if (action === 'find') keys.current.openFind();
        else keys.current.reload(action === 'force-reload');
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [active, runtime]);

  useEffect(() => {
    if (!viewId) return;
    web.setViewport(viewId, device);
  }, [web, viewId, device]);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStage({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!viewId) return;
    if (findOpen && findQuery && !loading) web.find(viewId, findQuery);
    else web.stopFind(viewId);
  }, [web, viewId, findOpen, findQuery, currentUrl, loading]);
  const size = device ? deviceFrame(device, stage) : null;
  const find = page?.find?.query === findQuery ? page.find : { active: 0, matches: 0 };

  const copyUrl = () => {
    navigator.clipboard.writeText(currentUrl).then(
      () => ToastQueue.neutral(COPY.copied, { timeout: 3000 }),
      () => ToastQueue.negative(COPY.copyFailed, { timeout: 5000 }),
    );
  };

  const disabledKeys = [
    ...(!currentUrl ? ['copy', 'external', 'reload', 'force-reload', 'duplicate', 'find'] : []),
    ...(zoom >= ZOOM_MAX ? ['zoom-in'] : []),
    ...(zoom <= ZOOM_MIN ? ['zoom-out'] : []),
  ];

  return (
    <div className={root} ref={rootRef}>
      <form
        className={toolbar}
        onSubmit={(event) => {
          event.preventDefault();
          go(address);
        }}>
        <IconButton label={COPY.back} isDisabled={!page?.canGoBack} onPress={() => viewId && web.back(viewId)}>
          <ChevronLeft />
        </IconButton>
        <IconButton label={COPY.forward} isDisabled={!page?.canGoForward} onPress={() => viewId && web.forward(viewId)}>
          <ChevronRight />
        </IconButton>
        <IconButton label={loading ? COPY.stop : COPY.reload} isDisabled={!currentUrl} onPress={loading ? stop : () => reload()}>
          {loading ? <StopProcessing /> : <Refresh />}
        </IconButton>
        <TextField
          ref={fieldRef}
          aria-label={COPY.address}
          placeholder={COPY.placeholder}
          value={address}
          onChange={(value) => {
            setAddress(value);
            setInvalid(false);
          }}
          onFocus={(event) => {
            setEditing(true);
            (event.target as HTMLInputElement).select();
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return event.continuePropagation();
            event.preventDefault();
            setInvalid(false);
            setAddress(currentUrl);
            (event.target as HTMLInputElement).blur();
          }}
          isInvalid={invalid}
          styles={addressField}
          UNSAFE_className={editing ? 'bc-web-address' : 'bc-web-address is-resting'}
        />
        <ActionButton type="submit" isDisabled={!address.trim()}>
          {COPY.go}
        </ActionButton>
        <IconButton label={M.find} isDisabled={!currentUrl} onPress={openFind}><Search /></IconButton>
        <IconButton label={M.device} onPress={() => setDevice(d => d ? null : DEVICE_PRESETS.phone)}><DeviceMultiscreen /></IconButton>
        <MenuTrigger onOpenChange={setMenuOpen}>
          <ActionButton isQuiet aria-label={COPY.menu}>
            <More />
          </ActionButton>
          <Menu
            disabledKeys={disabledKeys}
            onAction={(key) => {
              if (key === 'copy') copyUrl();
              else if (key === 'external') openOutside(currentUrl);
              else if (key === 'reload') reload();
              else if (key === 'force-reload') reload(true);
              else if (key === 'find') openFind();
              else if (key === 'duplicate') useShell.getState().openPane({ kind: 'web', id: crypto.randomUUID(), url: currentUrl });
              else if (key === 'zoom-in') setZoom((z) => zoomStep(z, 1));
              else if (key === 'zoom-out') setZoom((z) => zoomStep(z, -1));
              else if (key === 'zoom-reset') setZoom(100);
            }}>
            <MenuItem id="copy">{COPY.copy}</MenuItem>
            <MenuItem id="external">{COPY.external}</MenuItem>
            <MenuItem id="reload">{COPY.reload}</MenuItem>
            <MenuItem id="force-reload">{M.forceReload}</MenuItem>
            <MenuItem id="find">{M.find}</MenuItem>
            <MenuItem id="duplicate">{M.duplicate}</MenuItem>
            <MenuItem id="zoom-in">{COPY.zoomIn}</MenuItem>
            <MenuItem id="zoom-out">{COPY.zoomOut}</MenuItem>
            <MenuItem id="zoom-reset">{COPY.zoomReset}</MenuItem>
          </Menu>
        </MenuTrigger>
      </form>
      {device && <WebDeviceBar size={device} onChange={setDevice} onClose={() => setDevice(null)} onMenu={setMenuOpen} />}
      {findOpen && <WebFindBar query={findQuery} onQuery={setFindQuery} active={find.active} matches={find.matches}
        focusTick={findFocus} onClose={() => setFindOpen(false)} onStep={forward => { if (viewId && findQuery) web.find(viewId, findQuery, { forward, next: true }); }} />}
      {page?.notice && page.notice.serial !== dismissedNotice && <div className={loadingRow} role="status">
        <span>{page.notice.kind === 'popup' ? M.popupBlocked : page.notice.kind === 'download' ? M.downloadExternal : M.permissionBlocked}</span>
        <ActionButton isQuiet aria-label={M.dismiss} onPress={() => setDismissedNotice(page.notice!.serial)}><Close /></ActionButton>
      </div>}
      {invalid ? (
        <p className={invalidNote} role="alert">
          {COPY.invalid}
        </p>
      ) : null}
      {loading && mode.kind === 'page' ? (
        <div className={loadingRow} role="status">
          <ProgressCircle aria-label={COPY.loading} isIndeterminate size="S" />
          <span>{slow ? COPY.slow : COPY.loading}</span>
        </div>
      ) : null}
      <div className={viewport} ref={stageRef} style={device ? { alignItems: 'center', justifyContent: 'center' } : undefined}>
        {mode.kind === 'page' ? (
          <div className={placeholder} ref={viewportRef} style={size ? { flex: '0 0 auto', width: size.width, height: size.height } : undefined} />
        ) : (
          <div className={centered}>
            <StateMessage
              tabId={item.id}
              mode={mode}
              url={currentUrl}
              hasPage={hasPage}
              onRetry={() => reload()}
              onEnterUrl={focusAddress}
              onBack={() => {
                setDismissed(errorKey(page?.error));
                setAddress(page?.url ?? '');
              }}
              onOpenOutside={openOutside}
            />
          </div>
        )}
      </div>
      {currentUrl ? (
        <footer className={footer}>
          <span className={footerText}>{COPY.footer}</span>
          {zoom !== 100 ? (
            <ActionButton size="XS" isQuiet aria-label={COPY.zoomReset} onPress={() => setZoom(100)}>
              {`${zoom}%`}
            </ActionButton>
          ) : null}
          <Button variant="secondary" size="S" onPress={() => openOutside(currentUrl)}>
            {COPY.externalShort}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

function StateMessage({
  tabId,
  mode,
  url,
  hasPage,
  onRetry,
  onEnterUrl,
  onBack,
  onOpenOutside,
}: {
  tabId: string;
  mode: Exclude<Mode, { kind: 'page' }>;
  url: string;
  hasPage: boolean;
  onRetry: () => void;
  onEnterUrl: () => void;
  onBack: () => void;
  onOpenOutside: (url: string) => void;
}) {
  if (mode.kind === 'start') {
    return (
      <NewTabStart tabId={tabId}>
        <StartBlock nested title={COPY.startTitle} body={[COPY.startBody]} actions={[{ label: COPY.enterUrl, onPress: onEnterUrl }]} />
      </NewTabStart>
    );
  }
  if (mode.kind === 'stopped') {
    return <StartBlock title={COPY.stoppedTitle} body={[displayUrl(url)]} actions={[{ label: COPY.retry, onPress: onRetry }]} />;
  }
  const { error } = mode;
  if (error.kind === 'blocked') {
    // 回环与应用自己的地址不进内嵌视图，但可以交给系统浏览器（宿主只收 http/https）。
    const outside = isWebUrl(error.url) ? error.url : null;
    return (
      <StartBlock
        title={COPY.blockedTitle[error.reason]}
        body={[COPY.blockedBody[error.reason], outside ? displayUrl(outside) : '']}
        actions={[
          ...(outside ? [{ label: COPY.openInBrowser, onPress: () => onOpenOutside(outside) }] : []),
          ...(hasPage ? [{ label: COPY.backToPage, onPress: onBack }] : []),
        ]}
      />
    );
  }
  if (error.kind === 'crashed') {
    return <StartBlock title={COPY.crashedTitle} body={[COPY.crashedBody]} actions={[{ label: COPY.retry, onPress: onRetry }]} />;
  }
  return (
    <StartBlock
      title={COPY.failedTitle}
      body={[displayUrl(error.url), error.code ? COPY.failedDetail(error.description, error.code) : error.description]}
      actions={[{ label: COPY.retry, onPress: onRetry }, ...(isWebUrl(error.url) ? [{ label: COPY.openInBrowser, onPress: () => onOpenOutside(error.url) }] : [])]}
    />
  );
}
