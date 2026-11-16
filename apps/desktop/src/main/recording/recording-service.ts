import { BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, powerMonitor, powerSaveBlocker, screen, shell, type Display, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { BaoCutClient } from '@baocut/client';
import { newId, onLocaleChange, type Id, type RecordingOptions, type RecordingSources, type RecordingState, type RecordingSummary, type RecordingTarget } from '@baocut/protocol';
import type { RecordingChoice, RecordingNotice, RecordingSurfaceAction, RecordingSurfaceInit, RecordingSurfaceKind, RecordingSurfaceState } from '@baocut/ui';
import { appTrayImage, macTrayImage } from '../bot/bot-service.ts';
import { RB } from './recording-bar-copy.ts';
import {
  BAR,
  barPlacement,
  CAPTURE_SHORTCUTS,
  cameraPlacement,
  canRestart,
  captureShortcutsWanted,
  clock,
  currentRecording,
  DEFAULT_HOST_SETTINGS,
  hideForRecording,
  isCapturing,
  OPEN_SHORTCUTS,
  openShortcutsWanted,
  parseHostSettings,
  parseSessionRequest,
  privacyUrl,
  quitStep,
  SHORTCUT_KEYS,
  sleepStep,
  stillFinishing,
  toggleMethod,
  windowPlan,
  workerDisplayFor,
  type Bounds,
  type PickerKind,
  type RecordingHostSettings,
  type SessionRequest,
  type ShortcutKey,
} from './recording-rules.ts';

/*
 * 录制在主进程的部分（屏幕录制设计 §11）：自己连 Runtime、订阅 `recordings` 主题，开着录制的四种小窗，管应用窗口、菜单栏图标与全局快捷键。
 * - 一次「打开启动器」到「开始」之间的状态（落点、此刻的选择、在启动器还是在覆盖层）在这里，推给每扇小窗；开始之后的状态归 Runtime。
 * - 小窗：启动器、选取覆盖层（每块屏幕一扇）、控制条、摄像头预览。都是透明、无边框、置顶的窗口，同一个页面
 *   （`index.html?surface=<种类>`，界面在 @baocut/ui 的 `recording-surface`）。都开了内容保护（`setContentProtection`）：Windows 上
 *   不被截进画面；macOS 上它设的是 `NSWindowSharingNone`，用 ScreenCaptureKit 的 Recording Worker 仍然截得到，所以还要 Worker 把
 *   BaoCut 的窗口排除在外（`includeSelf` 为假时）。
 * - 应用窗口：开始采集时收到后台或最小化（看设置；这次要把 BaoCut 录进去时不动），采集结束时放回来；断线时也放回来。
 * - 菜单栏图标：不录时是菜单（打开 BaoCut、录制屏幕 / 窗口 / 区域、设置、退出；设置里能关掉）；录制中换成停止图标，点一下就停，
 *   关掉了图标时也有。
 * - 全局快捷键：七个，缺省都不设。打开启动器与直接选屏幕、窗口、区域的四个在不录时占着；停止、暂停与继续、重新开始只在采集时占着。
 *   改了某个之后注册不上（被别的应用占了）时告诉界面。
 * - 电源：采集中不让显示器睡眠；电脑要睡眠时暂停录制（倒计时里取消），醒来时控制条提示一次。退出之前先停止并保存（`stopForQuit`）。
 * - 来源：启动器或覆盖层开着时每 5 秒静默再问一次（窗口开关、设备插拔），不闪「正在载入」，问不到时留着上一次的。
 * 规则在 recording-rules.ts 并有单测；这里是 Electron 调用。录完之后打开编辑器由应用窗口的界面做（它看着状态走到「已进时间线」）。
 */

export const RECORDING_CONFIGURE_CHANNEL = 'baocut:recording-configure';
export const RECORDING_SETTINGS_CHANNEL = 'baocut:recording-open-settings';
export const RECORDING_OPEN_CHANNEL = 'baocut:recording-open';
export const RECORDING_SESSION_CHANNEL = 'baocut:recording-session';
export const RECORDING_APP_SETTINGS_CHANNEL = 'baocut:recording-open-app-settings';
export const RECORDING_SHORTCUT_FAILED_CHANNEL = 'baocut:recording-shortcut-failed';
export const SURFACE_INIT_CHANNEL = 'baocut:recording-surface-init';
export const SURFACE_STATE_CHANNEL = 'baocut:recording-surface-state';
export const SURFACE_READY_CHANNEL = 'baocut:recording-surface-ready';
export const SURFACE_ACT_CHANNEL = 'baocut:recording-surface-act';

export interface RecordingServiceOptions {
  connection(): Promise<{ endpoint: string; token: string }>;
  version: string;
  platform: NodeJS.Platform;
  /** 应用自己的窗口（不含录制小窗与网页标签）。 */
  appWindows(): BrowserWindow[];
  /** 打开（必要时新建）应用窗口并带到前台。 */
  showWindow(): BrowserWindow;
  /** 小窗的页面：开发时开发服务器的地址，打包后 `out/renderer/index.html`。 */
  page: { url: string } | { file: string };
  preload: string;
  /** 菜单栏菜单的「退出」。 */
  quit(): void;
}

export interface RecordingService {
  /** 这个窗口是不是录制的小窗（`showWindow` 之类找应用窗口时跳过它）。 */
  isSurfaceWindow(win: BrowserWindow): boolean;
  /**
   * 应用退出之前（屏幕录制设计 §11「退出」）：采集中的停止并保存，准备与倒计时里的丢掉。`wait` 时再等它收尾、导入完（最多
   * `timeoutMs`），Runtime 随后停下也不必下次恢复。从不抛。
   */
  stopForQuit(options: { wait: boolean; timeoutMs?: number }): Promise<void>;
  dispose(): void;
}

interface Session {
  id: number;
  phase: 'launcher' | 'picker';
  picker: PickerKind;
  request: SessionRequest;
  agent: { recordingId: Id; options: RecordingOptions } | null;
  choice: RecordingChoice | null;
  notices: RecordingNotice[];
  starting: boolean;
  error: string | null;
}

interface Surface {
  win: BrowserWindow;
  kind: RecordingSurfaceKind;
  display: Display | null;
}

const LAUNCHER = { width: 330, height: 400 } as const;
/** 开始之后到 Runtime 报来第一条采集中的状态之前，摄像头预览不关（免得关了又开）。 */
const HANDOFF_MS = 5000;
/** 开始之后小窗先藏起来，过一会儿再关：页面要在 `start` 的结果回来后记下这次的选择。 */
const CLOSE_DELAY_MS = 400;
/** 启动器或覆盖层开着时多久再问一次来源。每次问都要拉起一个 Worker 进程，所以不更勤。 */
const SOURCES_REFRESH_MS = 5000;
/** 退出时等收尾与导入的上限；Runtime 被停下时没导完的下次可以恢复。 */
const QUIT_WAIT_MS = 30_000;

export function installRecordingService(options: RecordingServiceOptions): RecordingService {
  const client = new BaoCutClient({
    resolve: () => options.connection(),
    client: { kind: 'desktop', name: 'BaoCut recording controls', version: options.version },
  });
  let settings: RecordingHostSettings = DEFAULT_HOST_SETTINGS;
  let configured = false;
  let connected = false;
  const recordings = new Map<Id, RecordingSummary>();
  const seen = new Map<Id, RecordingState>();
  let sources: RecordingSurfaceState['sources'] = { status: 'loading', sources: null, message: null };
  let sourcesLoad: Promise<void> | null = null;
  let session: Session | null = null;
  let sessionSeq = 0;
  /** 上一次从启动器开始的落点：丢弃之后「重新打开启动器」用它。 */
  let lastRequest: SessionRequest | null = null;
  let reopenAfter: SessionRequest | null = null;
  let restarting = false;
  let handoffUntil = 0;
  let handoffTimer: NodeJS.Timeout | null = null;
  /** 录制中收起了预览的那几次。 */
  const cameraHidden = new Set<Id>();
  let camera: { box: { width: number; height: number }; pos: { x: number; y: number } | null; pad: { side: number; top: number } } = {
    box: { width: 230, height: 230 },
    pos: null,
    pad: { side: 8, top: 56 },
  };
  let barHeight: number = BAR.height;
  let hidden: BrowserWindow[] = [];
  /** 电脑睡眠时自动暂停的那一次（用户继续之前控制条提示）。 */
  let sleptId: Id | null = null;
  let awakeBlocker: number | null = null;
  let sourcesTimer: NodeJS.Timeout | null = null;

  const surfaces = new Map<number, Surface>();
  const ready = new Set<number>();
  let launcher: BrowserWindow | null = null;
  const pickers = new Map<number, BrowserWindow>();
  let bar: BrowserWindow | null = null;
  let cameraWin: BrowserWindow | null = null;

  let tray: Tray | null = null;
  let trayMode: 'idle' | 'stop' | null = null;
  const registered = new Map<ShortcutKey, string>();
  const refused = new Map<ShortcutKey, string>();

  const current = () => currentRecording([...recordings.values()]);
  const call = (method: string, params: Record<string, unknown>) =>
    (client.request as (m: string, p: Record<string, unknown>) => Promise<unknown>)(method, params);
  const quietly = (method: string, params: Record<string, unknown>) =>
    call(method, params).catch((error: unknown) => console.error(`[recording] ${method} failed`, error));

  // ---- 来源 ----
  /** `quiet`（定时的再问）：不先推「正在载入」，问不到时留着上一次的列表；上一次还没问完时不再问。 */
  const loadSources = (quiet = false) => {
    if (quiet && sourcesLoad) return sourcesLoad;
    if (!quiet) {
      sources = { status: 'loading', sources: sources.sources, message: null };
      push();
    }
    const load = (client.request('recordings.sources', {}) as Promise<RecordingSources>).then(
      (s) => {
        sources = { status: 'ready', sources: s, message: null };
      },
      (error: unknown) => {
        if (quiet && sources.sources) return;
        sources = { status: 'error', sources: null, message: error instanceof Error ? error.message : String(error) };
      },
    );
    const done: Promise<void> = load.then(() => {
      if (sourcesLoad === done) sourcesLoad = null;
      push();
      syncCamera();
    });
    sourcesLoad = done;
    return done;
  };

  // ---- 屏幕 ----
  const isPrimary = (d: Display) => d.id === screen.getPrimaryDisplay().id;
  const workerIdOf = (d: Display) =>
    sources.sources ? workerDisplayFor({ id: d.id, bounds: d.bounds, primary: isPrimary(d) }, sources.sources.displays) : null;
  /** Worker 的屏幕 ID 对上 Electron 的哪块；对不上时主屏。 */
  const displayOfWorker = (workerId: string | null | undefined): Display => {
    if (workerId) {
      const found = screen.getAllDisplays().find((d) => workerIdOf(d) === workerId);
      if (found) return found;
    }
    return screen.getPrimaryDisplay();
  };
  const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  // ---- 小窗 ----
  const view = (): RecordingSurfaceState => ({
    session: session
      ? {
          id: session.id,
          phase: session.phase,
          picker: session.picker,
          landing: session.request.landing,
          agent: session.agent,
          choice: session.choice,
          notices: session.notices,
          starting: session.starting,
          error: session.error,
        }
      : null,
    recording: current(),
    sources,
    afterDiscard: settings.afterDiscard,
    pausedBySleep: !!sleptId && current()?.recordingId === sleptId && current()?.state === 'paused',
  });
  function push() {
    const state = view();
    for (const [id, s] of surfaces) if (ready.has(id) && !s.win.isDestroyed()) s.win.webContents.send(SURFACE_STATE_CHANNEL, state);
  }

  const titleOf = (kind: RecordingSurfaceKind) =>
    kind === 'launcher' ? RB.launcherTitle : kind === 'picker' ? RB.pickerTitle : kind === 'bar' ? RB.barTitle : RB.cameraTitle;

  const createSurface = (kind: RecordingSurfaceKind, bounds: Bounds, display: Display | null): BrowserWindow => {
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: kind === 'launcher' || kind === 'bar',
      resizable: false,
      movable: kind !== 'picker',
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      enableLargerThanScreen: kind === 'picker',
      show: false,
      title: titleOf(kind),
      webPreferences: { preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
    });
    // 内容保护：Windows 上不被截进画面；macOS 上见文件头。
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, kind === 'launcher' ? 'floating' : 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    if (kind === 'picker') win.setBounds(bounds);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    const id = win.webContents.id;
    surfaces.set(id, { win, kind, display });
    win.on('closed', () => {
      surfaces.delete(id);
      ready.delete(id);
      if (launcher === win) launcher = null;
      if (bar === win) bar = null;
      if (cameraWin === win) cameraWin = null;
      for (const [k, w] of pickers) if (w === win) pickers.delete(k);
    });
    if ('url' in options.page) {
      const url = new URL(options.page.url);
      url.searchParams.set('surface', kind);
      void win.loadURL(url.href);
    } else {
      void win.loadFile(options.page.file, { query: { surface: kind } });
    }
    return win;
  };
  const destroy = (win: BrowserWindow | null) => {
    if (win && !win.isDestroyed()) win.destroy();
  };
  /** 先藏起来（不再挡着、不被录进去），稍后再关。 */
  const retire = (win: BrowserWindow | null) => {
    if (!win || win.isDestroyed()) return;
    win.hide();
    setTimeout(() => destroy(win), CLOSE_DELAY_MS);
  };

  const showLauncher = () => {
    if (!launcher || launcher.isDestroyed()) {
      const area = cursorDisplay().workArea;
      const bounds = {
        x: Math.round(area.x + (area.width - LAUNCHER.width) / 2),
        y: Math.round(area.y + (area.height - LAUNCHER.height) / 2),
        ...LAUNCHER,
      };
      const win = createSurface('launcher', bounds, null);
      win.once('ready-to-show', () => {
        if (launcher === win && session?.phase === 'launcher') {
          win.show();
          win.focus();
        }
      });
      launcher = win;
      return;
    }
    launcher.show();
    launcher.focus();
  };
  const showPickers = () => {
    const displays = screen.getAllDisplays();
    const under = cursorDisplay();
    for (const d of displays) {
      if (pickers.has(d.id)) continue;
      const win = createSurface('picker', d.bounds, d);
      pickers.set(d.id, win);
      win.once('ready-to-show', () => {
        if (pickers.get(d.id) !== win || session?.phase !== 'picker') return;
        if (d.id === under.id) {
          win.show();
          win.focus();
        } else {
          win.showInactive();
        }
        cameraWin?.moveTop();
      });
    }
    const front = pickers.get(under.id);
    if (front?.isVisible()) front.focus();
  };
  const closePickers = (later = false) => {
    for (const w of [...pickers.values()]) (later ? retire : destroy)(w);
    pickers.clear();
  };

  // ---- 一次打开 ----
  const emit = (event: { type: 'opened' } | { type: 'closed'; outcome: 'cancelled' | 'started' | 'gone'; recordingId: Id | null }) => {
    for (const w of options.appWindows()) if (!w.isDestroyed()) w.webContents.send(RECORDING_SESSION_CHANNEL, event);
  };

  const open = (request: SessionRequest) => {
    const r = current();
    if (r) {
      if (bar && !bar.isDestroyed()) bar.showInactive();
      return;
    }
    if (session) {
      if (request.direct) toPicker(request.direct);
      else if (session.phase === 'launcher') showLauncher();
      else pickers.get(cursorDisplay().id)?.focus();
      return;
    }
    let agent: Session['agent'] = null;
    if (request.recordingId) {
      const waiting = recordings.get(request.recordingId);
      if (!waiting || waiting.state !== 'waiting') return;
      agent = { recordingId: waiting.recordingId, options: waiting.options };
    }
    session = {
      id: ++sessionSeq,
      phase: request.direct ? 'picker' : 'launcher',
      picker: request.direct ?? 'display',
      request,
      agent,
      choice: null,
      notices: [],
      starting: false,
      error: null,
    };
    void loadSources();
    if (sourcesTimer) clearInterval(sourcesTimer);
    sourcesTimer = setInterval(() => {
      if (session && !session.starting) void loadSources(true);
    }, SOURCES_REFRESH_MS);
    if (session.phase === 'launcher') showLauncher();
    else showPickers();
    emit({ type: 'opened' });
    push();
  };

  const toPicker = (kind: PickerKind) => {
    if (!session) return;
    session.phase = 'picker';
    session.picker = kind;
    if (session.choice) session.choice = { ...session.choice, source: kind };
    if (launcher && !launcher.isDestroyed()) launcher.hide();
    showPickers();
    push();
  };
  const toLauncher = () => {
    if (!session) return;
    session.phase = 'launcher';
    closePickers();
    showLauncher();
    push();
  };
  const endSession = (outcome: 'cancelled' | 'started' | 'gone') => {
    const s = session;
    if (!s) return;
    session = null;
    if (sourcesTimer) clearInterval(sourcesTimer);
    sourcesTimer = null;
    const later = outcome === 'started';
    (later ? retire : destroy)(launcher);
    launcher = null;
    closePickers(later);
    emit({ type: 'closed', outcome, recordingId: s.agent?.recordingId ?? null });
    if (outcome === 'cancelled' && s.agent) void quietly('recordings.cancel', { recordingId: s.agent.recordingId });
    push();
    syncCamera();
  };

  const resolveTarget = async (target: SessionRequest['target']): Promise<RecordingTarget> => {
    if (!('home' in target)) return target;
    if (target.home.projectId) return { create: { projectId: target.home.projectId } };
    const { project } = (await call('projects.create', { name: target.home.name.trim() || undefined, commandId: newId('cmd') })) as { project: { id: Id } };
    return { create: { projectId: project.id } };
  };

  const start = async (startOptions: Partial<RecordingOptions>): Promise<{ ok: true } | { ok: false; message: string }> => {
    const s = session;
    if (!s || s.starting) return { ok: false, message: 'No recorder is open' };
    s.starting = true;
    s.error = null;
    push();
    try {
      if (s.agent) {
        await call('recordings.start', { recordingId: s.agent.recordingId, options: startOptions });
      } else {
        const target = await resolveTarget(s.request.target);
        await call('recordings.start', { options: startOptions, target });
        const { direct: _direct, ...rest } = s.request;
        lastRequest = rest;
      }
      beginHandoff();
      if (session === s) endSession('started');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (session === s) {
        s.starting = false;
        s.error = message;
        push();
        void loadSources();
      }
      return { ok: false, message };
    }
  };

  const beginHandoff = () => {
    handoffUntil = Date.now() + HANDOFF_MS;
    if (handoffTimer) clearTimeout(handoffTimer);
    handoffTimer = setTimeout(() => {
      handoffUntil = 0;
      handoffTimer = null;
      syncCamera();
    }, HANDOFF_MS);
  };

  // ---- 控制条 ----
  const barAnchor = (r: RecordingSummary): { kind: PickerKind; target: Bounds | null; display: Bounds } => {
    const src = r.options.source;
    if (src.kind === 'window') {
      const w = sources.sources?.windows.find((x) => x.id === src.windowId);
      if (w?.bounds) {
        const d = displayOfWorker(w.bounds.displayId);
        return { kind: 'window', target: { x: d.bounds.x + w.bounds.x, y: d.bounds.y + w.bounds.y, width: w.bounds.width, height: w.bounds.height }, display: d.workArea };
      }
      return { kind: 'window', target: null, display: screen.getPrimaryDisplay().workArea };
    }
    return { kind: src.kind, target: null, display: displayOfWorker(src.displayId).workArea };
  };
  const syncBar = () => {
    const r = current();
    if (!r) {
      destroy(bar);
      bar = null;
      barHeight = BAR.height;
      return;
    }
    if (bar && !bar.isDestroyed()) return;
    const a = barAnchor(r);
    const p = barPlacement(a.kind, a.target, a.display, barHeight);
    const win = createSurface('bar', { ...p, width: BAR.width, height: barHeight }, null);
    win.once('ready-to-show', () => {
      if (bar === win) win.showInactive();
    });
    bar = win;
  };
  const setBarHeight = (height: number) => {
    barHeight = height;
    if (!bar || bar.isDestroyed()) return;
    const b = bar.getBounds();
    if (b.height === height) return;
    // 底边不动。
    bar.setBounds({ x: b.x, y: b.y + b.height - height, width: BAR.width, height });
  };

  const stopOrCancel = (r: RecordingSummary) => {
    // 倒计时里按停止就是取消：什么都还没录。
    if (r.state === 'countdown' || r.state === 'preparing') return quietly('recordings.discard', { recordingId: r.recordingId });
    if (isCapturing(r.state)) return quietly('recordings.stop', { recordingId: r.recordingId });
    return Promise.resolve();
  };
  const restart = async (r: RecordingSummary) => {
    if (restarting) return;
    restarting = true;
    try {
      await call('recordings.discard', { recordingId: r.recordingId });
      await call('recordings.start', { options: r.options, target: r.target });
      beginHandoff();
    } catch (error) {
      console.error('[recording] restart failed', error);
    } finally {
      restarting = false;
      if (!current() && hidden.length) restoreApp();
    }
  };
  const barAction = async (action: unknown) => {
    const r = current();
    if (!r) return;
    if (action === 'stop') await stopOrCancel(r);
    else if (action === 'pause' && r.state === 'recording') await quietly('recordings.pause', { recordingId: r.recordingId });
    else if (action === 'resume' && r.state === 'paused') await quietly('recordings.resume', { recordingId: r.recordingId });
    else if (action === 'restart' && canRestart(r.state)) await restart(r);
    else if (action === 'discard' && isCapturing(r.state)) {
      if (settings.afterDiscard === 'launcher') reopenAfter = lastRequest ?? settings.home;
      await quietly('recordings.discard', { recordingId: r.recordingId });
    }
  };

  // ---- 摄像头预览 ----
  const cameraWanted = (): boolean => {
    const r = current();
    if (r) return !!r.options.camera && isCapturing(r.state) && !cameraHidden.has(r.recordingId);
    if (session) return !!session.choice?.camera;
    return Date.now() < handoffUntil && !!cameraWin;
  };
  const cameraBounds = (): Bounds => {
    const { box, pad } = camera;
    const ref = camera.pos ? screen.getDisplayNearestPoint({ x: Math.round(camera.pos.x), y: Math.round(camera.pos.y) }) : cursorDisplay();
    const p = cameraPlacement(camera.pos, box, ref.workArea);
    return { x: p.x - pad.side, y: p.y - pad.top, width: box.width + pad.side * 2, height: box.height + pad.top + pad.side };
  };
  function syncCamera() {
    if (!cameraWanted()) {
      destroy(cameraWin);
      cameraWin = null;
      return;
    }
    if (cameraWin && !cameraWin.isDestroyed()) return;
    const win = createSurface('camera', cameraBounds(), null);
    win.once('ready-to-show', () => {
      if (cameraWin === win) win.showInactive();
    });
    cameraWin = win;
  }
  const setCameraBounds = (next: typeof camera) => {
    camera = next;
    if (cameraWin && !cameraWin.isDestroyed()) cameraWin.setBounds(cameraBounds());
  };
  const closeCamera = () => {
    const r = current();
    if (r) cameraHidden.add(r.recordingId);
    else if (session?.choice) session.choice = { ...session.choice, camera: null, cameraName: null };
    push();
    syncCamera();
  };

  // ---- 应用窗口 ----
  const hideApp = () => {
    const shown = options.appWindows().filter((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized());
    hidden = [...hidden.filter((w) => !w.isDestroyed() && !shown.includes(w)), ...shown];
    for (const w of shown) {
      if (settings.mainWindow === 'minimize') w.minimize();
      else w.hide();
    }
  };
  function restoreApp() {
    const windows = hidden.filter((w) => !w.isDestroyed());
    hidden = [];
    if (windows.length === 0) return void options.showWindow();
    for (const w of windows) {
      if (w.isMinimized()) w.restore();
      w.show();
    }
    windows[0]!.focus();
  }

  // ---- 菜单栏 ----
  const idleMenu = (): MenuItemConstructorOptions[] => {
    const can = !!settings.home;
    return [
      { label: RB.trayOpen, click: () => void options.showWindow() },
      { type: 'separator' },
      { label: RB.trayDisplay, enabled: can, click: () => openHome('display') },
      { label: RB.trayWindow, enabled: can, click: () => openHome('window') },
      { label: RB.trayArea, enabled: can, click: () => openHome('area') },
      { type: 'separator' },
      { label: RB.traySettings, click: () => openAppSettings() },
      { label: RB.trayQuit, click: () => options.quit() },
    ];
  };
  const syncTray = (rebuild = false) => {
    const r = current();
    const mode = r ? 'stop' : configured && settings.trayIcon ? 'idle' : null;
    if (!mode) {
      tray?.destroy();
      tray = null;
      trayMode = null;
      return;
    }
    if (!tray) {
      tray = new Tray(mode === 'stop' ? stopImage(options.platform) : idleImage(options.platform));
      tray.on('click', () => {
        if (trayMode === 'stop') {
          const now = current();
          if (now) void stopOrCancel(now);
        } else if (options.platform !== 'darwin') {
          tray?.popUpContextMenu();
        }
      });
      trayMode = null;
    }
    if (mode !== trayMode || rebuild) {
      if (mode !== trayMode) tray.setImage(mode === 'stop' ? stopImage(options.platform) : idleImage(options.platform));
      trayMode = mode;
      tray.setContextMenu(mode === 'stop' ? null : Menu.buildFromTemplate(idleMenu()));
    }
    tray.setToolTip(r ? (isCapturing(r.state) ? RB.trayStopTip(clock(r.elapsed)) : RB.trayFinishing) : RB.trayTip);
  };

  const openHome = (direct?: PickerKind) => {
    if (!settings.home) return void options.showWindow();
    const { direct: _direct, ...home } = settings.home;
    open(direct ? { ...home, direct } : home);
  };
  const openAppSettings = () => {
    const win = options.showWindow();
    const send = () => win.webContents.send(RECORDING_APP_SETTINGS_CHANNEL);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 500));
    else send();
  };

  // ---- 快捷键 ----
  const runShortcut = (key: ShortcutKey) => {
    const r = current();
    if (key === 'stop') {
      if (r) void stopOrCancel(r);
    } else if (key === 'pause') {
      const method = toggleMethod(r);
      if (r && method) void quietly(method, { recordingId: r.recordingId });
    } else if (key === 'restart') {
      if (r && canRestart(r.state)) void restart(r);
    } else {
      openHome(key === 'launcher' ? undefined : key);
    }
  };
  /** 让快捷键的占用跟上此刻的状态与设置；`report` 里的那几个注册不上时告诉界面（只在用户改了它们时，不在每次启动时）。 */
  const syncShortcuts = (report: ReadonlySet<ShortcutKey> = new Set()) => {
    const r = current();
    const openOn = openShortcutsWanted(r, connected, configured);
    const captureOn = captureShortcutsWanted(r);
    // 先放掉这次不要的，再注册要的（同一组键可能从一组换到另一组）。
    const want = new Map<ShortcutKey, string>();
    for (const key of SHORTCUT_KEYS) {
      const on = OPEN_SHORTCUTS.includes(key) ? openOn : CAPTURE_SHORTCUTS.includes(key) && captureOn;
      want.set(key, on ? settings.shortcuts[key] : '');
    }
    for (const [key, accel] of [...registered]) {
      if (want.get(key) === accel) continue;
      globalShortcut.unregister(accel);
      registered.delete(key);
    }
    const failed: ShortcutKey[] = [];
    const used = new Set(registered.values());
    for (const key of SHORTCUT_KEYS) {
      const accel = want.get(key) ?? '';
      if (!accel || registered.get(key) === accel) continue;
      // 注册不上的那组键不在每次状态变化时再试；改了设置才重试。
      if (refused.get(key) === accel && !report.has(key)) continue;
      let ok = false;
      if (!used.has(accel)) {
        try {
          ok = globalShortcut.register(accel, () => runShortcut(key));
        } catch {
          ok = false;
        }
      }
      if (ok) {
        registered.set(key, accel);
        used.add(accel);
        refused.delete(key);
      } else {
        refused.set(key, accel);
        if (report.has(key)) failed.push(key);
      }
    }
    if (failed.length) for (const w of options.appWindows()) if (!w.isDestroyed()) w.webContents.send(RECORDING_SHORTCUT_FAILED_CHANNEL, failed);
  };
  const unregisterAll = () => {
    for (const accel of registered.values()) globalShortcut.unregister(accel);
    registered.clear();
  };

  // ---- 电源 ----
  /** 采集中（准备到暂停）不让显示器睡眠；结束、失败、断线时放开。 */
  const syncAwake = () => {
    const r = current();
    const want = !!r && isCapturing(r.state);
    if (want && awakeBlocker === null) awakeBlocker = powerSaveBlocker.start('prevent-display-sleep');
    if (!want && awakeBlocker !== null) {
      if (powerSaveBlocker.isStarted(awakeBlocker)) powerSaveBlocker.stop(awakeBlocker);
      awakeBlocker = null;
    }
  };
  /** 电脑要睡眠：录制中暂停，倒计时里取消。系统不等应用，暂停可能来不及落下，醒来时再补一次。 */
  const onSuspend = () => {
    const r = current();
    const step = r ? sleepStep(r.state) : null;
    if (!r || !step) return;
    if (step === 'pause') {
      sleptId = r.recordingId;
      void quietly('recordings.pause', { recordingId: r.recordingId });
    } else {
      void quietly('recordings.discard', { recordingId: r.recordingId });
    }
  };
  const onWake = () => {
    const r = current();
    if (!r || r.recordingId !== sleptId) return;
    if (r.state === 'recording') void quietly('recordings.pause', { recordingId: r.recordingId });
    push();
  };
  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onWake);

  // ---- 状态变化 ----
  const sync = () => {
    const r = current();
    // 睡眠暂停的那一次：用户继续了或者录制结束了，提示就不再要。
    if (sleptId && r?.recordingId !== sleptId) sleptId = null;
    syncAwake();
    if (!r && reopenAfter && !session) {
      const next = reopenAfter;
      reopenAfter = null;
      setTimeout(() => open(next), 0);
    }
    syncBar();
    syncCamera();
    syncTray();
    syncShortcuts();
    push();
  };

  const onRecording = (r: RecordingSummary) => {
    const before = seen.get(r.recordingId);
    seen.set(r.recordingId, r.state);
    recordings.set(r.recordingId, r);
    if (r.recordingId === sleptId && before === 'paused' && r.state === 'recording') sleptId = null;
    if (isCapturing(r.state) && handoffTimer) {
      clearTimeout(handoffTimer);
      handoffTimer = null;
      handoffUntil = 0;
    }
    const plan = windowPlan(before, r.state, hideForRecording(r));
    if (plan === 'hide') hideApp();
    // 重新开始时上一次的结束不放回窗口：下一次马上又要收起。
    const another = [...recordings.values()].some((x) => x.recordingId !== r.recordingId && isCapturing(x.state));
    if (plan === 'restore' && !restarting && !another) restoreApp();
    // 智能体那次被别处开始或取消了：启动器跟着关。
    if (session?.agent?.recordingId === r.recordingId && r.state !== 'waiting' && !session.starting) endSession('gone');
  };

  const stopTopic = client.subscribeRecordings({
    snapshot: (snapshot) => {
      recordings.clear();
      // 快照里的状态当作「上次看到的」：重连时正在录的不再收一次窗口；收起过的照旧等结束时放回来。
      for (const r of snapshot.recordings) {
        if (!seen.has(r.recordingId)) seen.set(r.recordingId, r.state);
        onRecording(r);
      }
      sync();
    },
    event: (event) => {
      if (event.type === 'recording.removed') recordings.delete(event.recordingId);
      else onRecording(event.recording);
      sync();
    },
  });
  // 断线（Runtime 退出或重启）：窗口放回来，小窗与快捷键拿掉，等重连后的快照。
  const stopState = client.onState((state) => {
    connected = state.status === 'connected';
    if (connected) return void sync();
    if (hidden.length) restoreApp();
    recordings.clear();
    if (session) endSession('gone');
    sync();
  });
  // 订阅不会自己连上：先连一次，之后断线由客户端重连。
  void client.connect().catch((error: unknown) => console.error('[recording] connect failed', error));
  const stopLocale = onLocaleChange(() => syncTray(true));

  // ---- 应用窗口来的 ----
  const fromApp = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame && options.appWindows().some((w) => !w.isDestroyed() && w.webContents === event.sender);

  ipcMain.on(RECORDING_CONFIGURE_CHANNEL, (event, raw: unknown) => {
    if (!fromApp(event)) return;
    const next = parseHostSettings(raw);
    const changed = new Set<ShortcutKey>(configured ? SHORTCUT_KEYS.filter((k) => next.shortcuts[k] !== settings.shortcuts[k]) : []);
    settings = next;
    configured = true;
    syncShortcuts(changed);
    syncTray(true);
    push();
  });
  ipcMain.on(RECORDING_OPEN_CHANNEL, (event, raw: unknown) => {
    if (!fromApp(event)) return;
    const request = parseSessionRequest(raw);
    if (request) open(request);
  });
  ipcMain.handle(RECORDING_SETTINGS_CHANNEL, async (event, permission: unknown) => {
    if (!fromApp(event)) throw new Error('Only app windows can open system settings');
    const url = privacyUrl(permission, options.platform);
    if (!url) throw new Error('No system settings page for this permission on this platform');
    await shell.openExternal(url);
  });

  // ---- 小窗来的 ----
  const surfaceOf = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): Surface | null => {
    const s = surfaces.get(event.sender.id);
    return s && !s.win.isDestroyed() && s.win.webContents === event.sender && event.senderFrame === event.sender.mainFrame ? s : null;
  };
  ipcMain.handle(SURFACE_INIT_CHANNEL, async (event): Promise<RecordingSurfaceInit> => {
    const s = surfaceOf(event);
    if (!s) throw new Error('Not a recording surface');
    // 覆盖层要知道自己盖着 Worker 的哪块屏幕：等这一轮来源问完。
    if (s.display && sourcesLoad) await sourcesLoad.catch(() => {});
    return {
      kind: s.kind,
      platform: options.platform,
      display: s.display ? { bounds: { ...s.display.bounds }, workerDisplayId: workerIdOf(s.display) } : null,
    };
  });
  ipcMain.on(SURFACE_READY_CHANNEL, (event) => {
    const s = surfaceOf(event);
    if (!s) return;
    ready.add(event.sender.id);
    s.win.webContents.send(SURFACE_STATE_CHANNEL, view());
  });
  ipcMain.handle(SURFACE_ACT_CHANNEL, async (event, raw: unknown): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!surfaceOf(event)) return { ok: false, message: 'Not a recording surface' };
    const a = raw as RecordingSurfaceAction | null;
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') return { ok: false, message: 'Bad action' };
    switch (a.type) {
      case 'resolve':
        if (session && !session.choice && isObject(a.choice)) {
          session.choice = session.phase === 'picker' ? { ...a.choice, source: session.picker } : a.choice;
          session.notices = Array.isArray(a.notices) ? a.notices : [];
          push();
          syncCamera();
        }
        break;
      case 'choose':
        if (session && isObject(a.choice)) {
          session.choice = a.choice;
          push();
          syncCamera();
        }
        break;
      case 'pick':
        if (!session || !isPicker(a.kind)) break;
        if (session.phase === 'picker' && session.picker === a.kind) toLauncher();
        else toPicker(a.kind);
        break;
      case 'escape':
        toLauncher();
        break;
      case 'close':
        endSession('cancelled');
        break;
      case 'start':
        return start(isObject(a.options) ? (a.options as Partial<RecordingOptions>) : {});
      case 'permission': {
        const url = privacyUrl(a.permission, options.platform);
        if (url) await shell.openExternal(url);
        break;
      }
      case 'settings':
        openAppSettings();
        break;
      case 'refresh':
        await loadSources();
        break;
      case 'bar':
        await barAction(a.action);
        break;
      case 'bar-height':
        if (finite(a.height) && a.height >= 32 && a.height <= 600) setBarHeight(Math.ceil(a.height));
        break;
      case 'camera-bounds': {
        const box = a.box;
        const pad = a.pad;
        const pos = a.pos;
        if (!isObject(box) || !finite(box.width) || !finite(box.height) || box.width < 50 || box.height < 50 || box.width > 1200 || box.height > 1200) break;
        if (!isObject(pad) || !finite(pad.side) || !finite(pad.top) || pad.side < 0 || pad.top < 0 || pad.side > 100 || pad.top > 100) break;
        if (pos !== null && (!isObject(pos) || !finite(pos.x) || !finite(pos.y))) break;
        setCameraBounds({ box: { width: Math.round(box.width), height: Math.round(box.height) }, pos: pos ? { x: pos.x, y: pos.y } : null, pad: { side: pad.side, top: pad.top } });
        break;
      }
      case 'camera-close':
        closeCamera();
        break;
      default:
        return { ok: false, message: 'Unknown action' };
    }
    return { ok: true };
  });

  const stopForQuit = async ({ wait, timeoutMs = QUIT_WAIT_MS }: { wait: boolean; timeoutMs?: number }) => {
    const r = current();
    const step = r ? quitStep(r.state) : null;
    if (!r || !step) return;
    if (step === 'discard') return void (await quietly('recordings.discard', { recordingId: r.recordingId }));
    await quietly('recordings.stop', { recordingId: r.recordingId });
    if (!wait) return;
    const deadline = Date.now() + timeoutMs;
    // 停止的回复先到，主题上的状态后到：还看着录制中的也要等。
    const busy = () => {
      const now = recordings.get(r.recordingId);
      return !!now && (now.state === 'recording' || now.state === 'paused' || stillFinishing(now));
    };
    while (connected && busy() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  return {
    isSurfaceWindow: (win) => [...surfaces.values()].some((s) => s.win === win),
    stopForQuit,
    dispose() {
      stopTopic();
      stopState();
      stopLocale();
      unregisterAll();
      powerMonitor.off('suspend', onSuspend);
      powerMonitor.off('resume', onWake);
      if (awakeBlocker !== null && powerSaveBlocker.isStarted(awakeBlocker)) powerSaveBlocker.stop(awakeBlocker);
      awakeBlocker = null;
      if (sourcesTimer) clearInterval(sourcesTimer);
      sourcesTimer = null;
      if (handoffTimer) clearTimeout(handoffTimer);
      for (const s of [...surfaces.values()]) destroy(s.win);
      surfaces.clear();
      tray?.destroy();
      tray = null;
      ipcMain.removeAllListeners(RECORDING_CONFIGURE_CHANNEL);
      ipcMain.removeAllListeners(RECORDING_OPEN_CHANNEL);
      ipcMain.removeAllListeners(SURFACE_READY_CHANNEL);
      ipcMain.removeHandler(RECORDING_SETTINGS_CHANNEL);
      ipcMain.removeHandler(SURFACE_INIT_CHANNEL);
      ipcMain.removeHandler(SURFACE_ACT_CHANNEL);
      client.close();
    },
  };
}

function isObject(v: unknown): v is Record<string, never> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPicker(v: unknown): v is PickerKind {
  return v === 'display' || v === 'window' || v === 'area';
}

function idleImage(platform: NodeJS.Platform): NativeImage {
  return platform === 'darwin' ? macTrayImage() : appTrayImage();
}

/** 录制中的菜单栏图标：圆角方块（macOS 是模板图，跟着菜单栏变色；别的系统是红色）。 */
function stopImage(platform: NodeJS.Platform): NativeImage {
  const size = 32;
  const inset = 7;
  const radius = 4;
  const [r, g, b] = platform === 'darwin' ? [0, 0, 0] : [0xd7, 0x37, 0x3f];
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(inset + radius - (x + 0.5), 0, x + 0.5 - (size - inset - radius));
      const dy = Math.max(inset + radius - (y + 0.5), 0, y + 0.5 - (size - inset - radius));
      const d = Math.hypot(dx, dy) - radius;
      const alpha = Math.round(255 * Math.min(1, Math.max(0, 0.5 - d)));
      const i = (y * size + x) * 4;
      // BGRA
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = alpha;
    }
  }
  const image = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
  if (platform === 'darwin') image.setTemplateImage(true);
  return image;
}
