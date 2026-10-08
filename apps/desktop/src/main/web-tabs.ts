import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import type { HostBridge } from '@baocut/ui';
import { M } from './main-copy.ts';
import { OpenThrottle, browserUserAgent, checkWebUrl, clampZoom, isRequestAllowed, isWebTabId, parseBounds, parseDeviceSize, parseFindRequest, nativeWebShortcut } from './web-policy.ts';

/**
 * 网页标签的宿主一侧（架构设计 §12.10）。
 *
 * 每个标签一个 WebContentsView，挂在发起它的窗口上：独立的 `persist:web` 分区，沙箱、上下文隔离、
 * 没有 Node、没有预加载脚本，网页拿不到任何 BaoCut 能力。只允许 http/https；回环地址、`file:` 与应用自己的页面
 * 一律拒绝（导航前拦一次，分区的每个请求再拦一次）。新窗口与权限请求一律拒绝并提示；下载交给系统浏览器。
 *
 * 渲染进程传来的每个参数都重新校验；标签 id 由这里生成，只认发起窗口自己的标签。
 */

type WebTabState = Parameters<Parameters<NonNullable<HostBridge['web']>['onState']>[0]>[0];

export const WEB_PARTITION = 'persist:web';
/** 每个窗口最多开多少个网页视图。 */
const MAX_TABS_PER_WINDOW = 24;

interface Tab {
  id: string;
  owner: BrowserWindow;
  view: WebContentsView;
  zoom: number;
  error: WebTabState['error'];
  ready: boolean;
  emulating: boolean;
  device: { width: number; height: number } | null;
  bounds: { x: number; y: number; width: number; height: number };
  find: { query: string; active: number; matches: number };
  findRequest: number;
  notice: NonNullable<WebTabState['notice']> | null;
}

export interface WebTabsOptions {
  /** 应用自己的来源（开发时的渲染服务器）；网页标签不许打开。 */
  appOrigins: readonly string[];
}

export function installWebTabs({ appOrigins }: WebTabsOptions): void {
  const tabs = new Map<string, Tab>();
  const watchedOwners = new WeakSet<BrowserWindow>();
  const popups = new OpenThrottle(1000);
  let counter = 0;
  let partition: Session | null = null;

  /** 网页分区只配置一次：权限、下载、请求拦截、User-Agent。 */
  const webSession = (): Session => {
    if (partition) return partition;
    const ses = session.fromPartition(WEB_PARTITION);
    ses.setPermissionRequestHandler((wc, _permission, callback) => {
      callback(false);
      const tab = [...tabs.values()].find(t => t.view.webContents === wc);
      if (tab) notice(tab, 'permission');
    });
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (event, item, wc) => {
      event.preventDefault();
      const target = checkWebUrl(item.getURL(), { appOrigins });
      const tab = [...tabs.values()].find(t => t.view.webContents === wc);
      if (target.ok && tab && popups.allow(tab.id, Date.now())) {
        void shell.openExternal(target.url).then(() => notice(tab, 'download')).catch(() => {});
      }
    });
    // 不带过滤条件：每个请求自己判，挡住网页里对本机服务（包括 Runtime 网关）的子资源与 WebSocket 请求。
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isRequestAllowed(details.url, appOrigins) }));
    ses.setUserAgent(browserUserAgent(ses.getUserAgent()));
    partition = ses;
    return ses;
  };

  const stateOf = (tab: Tab): WebTabState => {
    const wc = tab.view.webContents;
    return {
      id: tab.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
      error: tab.error,
      find: tab.find,
      notice: tab.notice,
    };
  };

  const emit = (tab: Tab): void => {
    if (tab.owner.isDestroyed() || tab.view.webContents.isDestroyed()) return;
    tab.owner.webContents.send('baocut:web-state', stateOf(tab));
  };

  const notice = (tab: Tab, kind: 'popup' | 'download' | 'permission'): void => {
    tab.notice = { serial: (tab.notice?.serial ?? 0) + 1, kind };
    emit(tab);
  };
  const applyDevice = (tab: Tab): void => {
    const wc = tab.view.webContents;
    if (!tab.ready) return;
    if (!tab.device) { if (tab.emulating) wc.disableDeviceEmulation(); tab.emulating = false; return; }
    const size = tab.device;
    const scale = Math.min(1, tab.bounds.width / size.width, tab.bounds.height / size.height);
    if (scale <= 0) return;
    wc.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: size, viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 1, viewSize: size, scale });
    tab.emulating = true;
  };

  const destroy = (tab: Tab): void => {
    tabs.delete(tab.id);
    popups.forget(tab.id);
    if (!tab.owner.isDestroyed()) tab.owner.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  };

  const destroyAllOf = (owner: BrowserWindow): void => {
    for (const tab of [...tabs.values()]) if (tab.owner === owner) destroy(tab);
  };

  /** 窗口关掉、界面重新加载或崩溃时，它开的网页视图都没人管了，一并销毁。 */
  const watchOwner = (owner: BrowserWindow): void => {
    if (watchedOwners.has(owner)) return;
    watchedOwners.add(owner);
    owner.on('closed', () => destroyAllOf(owner));
    owner.webContents.on('did-navigate', () => destroyAllOf(owner));
    owner.webContents.on('render-process-gone', () => destroyAllOf(owner));
  };

  /** 只认窗口主框架里的界面发来的请求；网页视图（没有预加载脚本）和子框架都不行。 */
  const ownerOf = (event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || owner.webContents !== event.sender) return null;
    if (!event.senderFrame || event.senderFrame.parent !== null) return null;
    return owner;
  };

  const tabOf = (event: IpcMainEvent | IpcMainInvokeEvent, id: unknown): Tab | null => {
    const owner = ownerOf(event);
    if (!owner || !isWebTabId(id)) return null;
    const tab = tabs.get(id);
    return tab && tab.owner === owner && !tab.view.webContents.isDestroyed() ? tab : null;
  };

  const wire = (tab: Tab, wc: WebContents): void => {
    // 网页里的新窗口一律拒绝并提示；外部打开只由界面上的用户动作触发。
    wc.setWindowOpenHandler(({ url }) => {
      const target = checkWebUrl(url, { appOrigins });
      // 保留当前页，告知用户；不让脚本弹窗自动启动外部应用。
      if (target.ok) notice(tab, 'popup');
      return { action: 'deny' };
    });
    // 网页自己发起的导航与重定向：主框架按规则判，拒绝时停下并推一条「被拒绝」状态。子框架交给请求拦截。
    const guard = (details: Electron.Event<{ url: string; isMainFrame: boolean }>): void => {
      if (!details.isMainFrame) return;
      const check = checkWebUrl(details.url, { appOrigins });
      if (check.ok) return;
      details.preventDefault();
      tab.error = { kind: 'blocked', reason: check.reason, url: details.url };
      emit(tab);
    };
    wc.on('will-navigate', (details) => guard(details));
    wc.on('will-redirect', (details) => guard(details));
    wc.on('found-in-page', (_event, result) => {
      if (result.requestId !== tab.findRequest) return;
      tab.find = { ...tab.find, active: result.activeMatchOrdinal, matches: result.matches };
      emit(tab);
    });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const action = nativeWebShortcut(input, process.platform === 'darwin');
      if (!action) return;
      event.preventDefault();
      tab.owner.webContents.focus();
      tab.owner.webContents.send('baocut:web-shortcut', { id: tab.id, action });
    });
    wc.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) tab.ready = false; });
    wc.on('dom-ready', () => { tab.ready = true; applyDevice(tab); emit(tab); });
    wc.on('did-start-loading', () => emit(tab));
    wc.on('did-stop-loading', () => emit(tab));
    wc.on('did-navigate', () => {
      // 缩放按来源记在分区里：换了站点要把这个标签的缩放重新放上去。
      wc.setZoomFactor(tab.zoom / 100);
      applyDevice(tab);
      tab.findRequest = 0;
      tab.find = { query: '', active: 0, matches: 0 };
      tab.error = null;
      emit(tab);
    });
    wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) emit(tab);
    });
    wc.on('page-title-updated', () => emit(tab));
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // -3（ERR_ABORTED）是停止、被拦下或换了导航，不算失败。
      if (!isMainFrame || code === -3) return;
      tab.error = { kind: 'failed', code, description, url };
      emit(tab);
    });
    wc.on('render-process-gone', () => {
      tab.error = { kind: 'crashed' };
      emit(tab);
    });
  };

  ipcMain.handle('baocut:web-create', (event) => {
    const owner = ownerOf(event);
    if (!owner) throw new Error(M.webCreateNotWindow);
    if ([...tabs.values()].filter((t) => t.owner === owner).length >= MAX_TABS_PER_WINDOW) throw new Error(M.webTooManyTabs);
    watchOwner(owner);
    const view = new WebContentsView({
      webPreferences: {
        session: webSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        spellcheck: false,
      },
    });
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    owner.contentView.addChildView(view);
    const tab: Tab = { id: `web_${++counter}_${Math.random().toString(36).slice(2, 10)}`, owner, view, zoom: 100, error: null, ready: false, emulating: false, device: null, bounds: { x: 0, y: 0, width: 0, height: 0 }, find: { query: '', active: 0, matches: 0 }, findRequest: 0, notice: null };
    tabs.set(tab.id, tab);
    wire(tab, view.webContents);
    return tab.id;
  });

  ipcMain.handle('baocut:web-navigate', (event, id: unknown, url: unknown) => {
    const tab = tabOf(event, id);
    if (!tab) throw new Error(M.webTabMissing);
    // 主进程的 loadURL 不经过 will-navigate：这里是唯一一道门。
    const check = checkWebUrl(url, { appOrigins });
    if (!check.ok) {
      tab.error = { kind: 'blocked', reason: check.reason, url: typeof url === 'string' ? url.slice(0, 2048) : '' };
      emit(tab);
      return check;
    }
    tab.error = null;
    // 失败由 did-fail-load 报给界面；这里不再抛。
    tab.view.webContents.loadURL(check.url).catch(() => {});
    return check;
  });

  const onTab = (channel: string, act: (tab: Tab, value: unknown) => void): void => {
    ipcMain.on(channel, (event, id: unknown, value: unknown) => {
      const tab = tabOf(event, id);
      if (tab) act(tab, value);
    });
  };

  onTab('baocut:web-back', (tab) => { if (tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack(); });
  onTab('baocut:web-forward', (tab) => { if (tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward(); });
  onTab('baocut:web-reload', (tab, ignoreCache) => {
    tab.error = null;
    if (ignoreCache === true) tab.view.webContents.reloadIgnoringCache();
    else tab.view.webContents.reload();
  });
  onTab('baocut:web-find', (tab, raw) => {
    const request = parseFindRequest(raw);
    if (!request || !tab.ready) return;
    tab.find = { query: request.query, active: 0, matches: 0 };
    tab.findRequest = tab.view.webContents.findInPage(request.query, { forward: request.forward, findNext: !request.next });
    emit(tab);
  });
  onTab('baocut:web-find-stop', (tab) => {
    if (tab.findRequest) tab.view.webContents.stopFindInPage('clearSelection');
    tab.findRequest = 0;
    tab.find = { query: '', active: 0, matches: 0 };
    emit(tab);
  });
  onTab('baocut:web-viewport', (tab, raw) => {
    if (raw !== null) {
      const size = parseDeviceSize(raw);
      if (!size) return;
      tab.device = size;
    } else tab.device = null;
    applyDevice(tab);
  });
  onTab('baocut:web-stop', (tab) => tab.view.webContents.stop());
  onTab('baocut:web-zoom', (tab, value) => {
    const zoom = clampZoom(value);
    if (zoom === null) return;
    tab.zoom = zoom;
    tab.view.webContents.setZoomFactor(zoom / 100);
  });
  onTab('baocut:web-bounds', (tab, value) => {
    const bounds = parseBounds(value);
    if (bounds) { tab.bounds = bounds; tab.view.setBounds(bounds); applyDevice(tab); }
  });
  onTab('baocut:web-visible', (tab, value) => {
    if (typeof value === 'boolean') {
      if (value) { tab.view.webContents.setZoomFactor(tab.zoom / 100); applyDevice(tab); }
      tab.view.setVisible(value);
    }
  });
  onTab('baocut:web-destroy', (tab) => destroy(tab));

  ipcMain.handle('baocut:web-clear-data', async (event) => {
    if (!ownerOf(event)) throw new Error(M.webClearNotWindow);
    const ses = webSession();
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
  });

  // 界面主动「在浏览器中打开」：只收 http/https，去掉账号密码；本机地址（用户自己的开发服务器）可以交给系统浏览器。
  ipcMain.handle('baocut:open-external', async (event, url: unknown) => {
    if (!ownerOf(event)) throw new Error(M.webOpenNotWindow);
    const target = checkWebUrl(url, { allowLoopback: true });
    if (!target.ok) throw new Error(M.webOpenScheme);
    await shell.openExternal(target.url);
  });
}
