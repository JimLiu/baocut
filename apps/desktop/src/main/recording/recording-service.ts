import path from 'node:path';
import { BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, screen, shell, type MenuItemConstructorOptions } from 'electron';
import { BaoCutClient } from '@baocut/client';
import { onLocaleChange, type Id, type RecordingState, type RecordingStreamStatus, type RecordingSummary } from '@baocut/protocol';
import { appTrayImage, macTrayImage } from '../bot/bot-service.ts';
import { RB } from './recording-bar-copy.ts';
import {
  barView,
  clock,
  currentRecording,
  DEFAULT_HOST_SETTINGS,
  parseHostSettings,
  privacyUrl,
  shortcutsWanted,
  toggleMethod,
  windowPlan,
  type BarView,
  type RecordingHostSettings,
} from './recording-rules.ts';

/*
 * 录制中主进程的部分（屏幕录制设计 §11「录制中」）：自己连 Runtime、订阅 `recordings` 主题，管四样东西——
 * - 应用窗口：开始采集时收起（设置里可以关掉），采集结束时放回来；断线时也放回来。
 * - 控制条：一个总在最前的小窗口（已录时长、暂停与继续、停止、丢弃；丢弃要在条上再确认一次）。开了内容保护
 *   （`setContentProtection`）：Windows 上不被截进画面；macOS 上它设的是 `NSWindowSharingNone`，Electron 文档说明用
 *   ScreenCaptureKit 的应用仍然截得到，Recording Worker 正是用它采集，所以 macOS 上还要 Worker 把这个窗口排除在外。
 * - 菜单栏（托盘）图标：同样的四个动作；macOS 的菜单栏上写已录时长。
 * - 全局快捷键：停止、暂停与继续，只在采集时注册；注册不上时告诉界面（被别的应用占了）。
 * 规则在 recording-rules.ts 并有单测；这里是薄薄的 Electron 调用。录完之后打开编辑器由界面做（它看着状态走到「已进时间线」）。
 */

export const RECORDING_CONFIGURE_CHANNEL = 'baocut:recording-configure';
export const RECORDING_SETTINGS_CHANNEL = 'baocut:recording-open-settings';
export const RECORDING_SHORTCUT_FAILED_CHANNEL = 'baocut:recording-shortcut-failed';
export const RECORDING_BAR_VIEW_CHANNEL = 'baocut:recording-bar-view';
export const RECORDING_BAR_ACT_CHANNEL = 'baocut:recording-bar-act';
export const RECORDING_BAR_READY_CHANNEL = 'baocut:recording-bar-ready';

export interface RecordingServiceOptions {
  connection(): Promise<{ endpoint: string; token: string }>;
  version: string;
  platform: NodeJS.Platform;
  /** 应用自己的窗口（不含控制条与网页标签）。 */
  appWindows(): BrowserWindow[];
  /** 打开（必要时新建）应用窗口并带到前台。 */
  showWindow(): BrowserWindow;
  /** 控制条页面：开发时开发服务器的地址，打包后 `out/renderer` 下的文件。 */
  barPage: { url: string } | { file: string };
  barPreload: string;
}

export interface RecordingService {
  /** 这个窗口是不是控制条（`showWindow` 之类找应用窗口时跳过它）。 */
  isBarWindow(win: BrowserWindow): boolean;
  dispose(): void;
}

/** 控制条收到的样子：文字由主进程按当前语言给，页面里不放文案目录。 */
export interface BarPayload {
  phase: BarView['phase'];
  title: string;
  time: string;
  notice: string | null;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canDiscard: boolean;
  labels: { pause: string; resume: string; stop: string; discard: string; discardConfirm: string; discardYes: string; discardNo: string; bar: string };
}

type BarAction = 'pause' | 'resume' | 'stop' | 'discard';

const BAR_WIDTH = 340;
const BAR_HEIGHT = 48;

export function installRecordingService(options: RecordingServiceOptions): RecordingService {
  const client = new BaoCutClient({
    resolve: () => options.connection(),
    client: { kind: 'desktop', name: 'BaoCut recording controls', version: options.version },
  });
  let settings: RecordingHostSettings = DEFAULT_HOST_SETTINGS;
  const recordings = new Map<Id, RecordingSummary>();
  const seen = new Map<Id, RecordingState>();
  const announcedLost = new Map<Id, Set<RecordingStreamStatus['role']>>();
  let notice: string | null = null;
  let hidden: BrowserWindow[] = [];
  let bar: BrowserWindow | null = null;
  let barReady = false;
  let tray: Tray | null = null;
  let trayPhase: string | null = null;
  let registered: { stop: string; pause: string } | null = null;

  const current = () => currentRecording([...recordings.values()]);

  const request = (method: 'recordings.pause' | 'recordings.resume' | 'recordings.stop', recordingId: Id) =>
    client.request(method, { recordingId }).catch((error: unknown) => console.error(`[recording] ${method} failed`, error));
  const discard = (recordingId: Id) =>
    client.request('recordings.discard', { recordingId }).catch((error: unknown) => console.error('[recording] discard failed', error));

  // ---- 应用窗口 ----
  const hideApp = () => {
    hidden = options.appWindows().filter((w) => !w.isDestroyed() && w.isVisible());
    for (const w of hidden) w.hide();
  };
  const restoreApp = () => {
    const windows = hidden.filter((w) => !w.isDestroyed());
    hidden = [];
    if (windows.length === 0) return void options.showWindow();
    for (const w of windows) w.show();
    windows[0]!.focus();
  };

  // ---- 控制条 ----
  const payload = (view: BarView): BarPayload => ({
    phase: view.phase,
    title: view.phase === 'countdown' ? RB.countdown(Math.ceil(view.seconds)) : view.phase === 'paused' ? RB.paused : view.phase === 'finishing' ? RB.finishing : RB.recording,
    time: view.phase === 'countdown' ? '' : clock(view.seconds),
    notice,
    canPause: view.canPause,
    canResume: view.canResume,
    canStop: view.canStop,
    canDiscard: view.canDiscard,
    labels: {
      pause: RB.pause,
      resume: RB.resume,
      stop: RB.stop,
      discard: RB.discard,
      discardConfirm: RB.discardConfirm,
      discardYes: RB.discardYes,
      discardNo: RB.discardNo,
      bar: RB.barTitle,
    },
  });

  const openBar = () => {
    if (bar && !bar.isDestroyed()) return bar;
    const area = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      x: Math.round(area.x + (area.width - BAR_WIDTH) / 2),
      y: area.y + 12,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      title: RB.barTitle,
      hasShadow: true,
      backgroundColor: '#1d1d1d',
      roundedCorners: true,
      webPreferences: { preload: options.barPreload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    // 内容保护：Windows 上不被截进画面；macOS 上见文件头（ScreenCaptureKit 不认）。
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.once('ready-to-show', () => win.showInactive());
    win.on('closed', () => {
      if (bar === win) {
        bar = null;
        barReady = false;
      }
    });
    if ('url' in options.barPage) void win.loadURL(options.barPage.url);
    else void win.loadFile(options.barPage.file);
    bar = win;
    barReady = false;
    return win;
  };
  const closeBar = () => {
    const win = bar;
    bar = null;
    barReady = false;
    if (win && !win.isDestroyed()) win.destroy();
  };
  const sendBar = (view: BarView) => {
    const win = openBar();
    if (barReady && !win.isDestroyed()) win.webContents.send(RECORDING_BAR_VIEW_CHANNEL, payload(view));
  };

  // ---- 菜单栏 ----
  const trayMenu = (view: BarView, recordingId: Id): MenuItemConstructorOptions[] => [
    ...(view.canPause ? [{ label: RB.pause, click: () => void request('recordings.pause', recordingId) }] : []),
    ...(view.canResume ? [{ label: RB.resume, click: () => void request('recordings.resume', recordingId) }] : []),
    ...(view.canStop ? [{ label: RB.stop, click: () => void request('recordings.stop', recordingId) }] : []),
    ...(view.canDiscard ? [{ label: RB.discard, click: () => void confirmDiscard(recordingId) }] : []),
    { type: 'separator' },
    { label: RB.trayShow, click: () => void options.showWindow() },
  ];
  const confirmDiscard = async (recordingId: Id) => {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: RB.discardConfirm,
      buttons: [RB.discardYes, RB.discardNo],
      defaultId: 1,
      cancelId: 1,
    });
    if (response === 0) await discard(recordingId);
  };
  const updateTray = (view: BarView | null, recordingId: Id | null) => {
    if (!view || !recordingId) {
      tray?.destroy();
      tray = null;
      trayPhase = null;
      return;
    }
    if (!tray) {
      tray = new Tray(options.platform === 'darwin' ? macTrayImage() : appTrayImage());
      tray.on('click', () => {
        if (options.platform !== 'darwin') tray?.popUpContextMenu();
      });
    }
    const time = view.phase === 'countdown' ? RB.countdown(Math.ceil(view.seconds)) : clock(view.seconds);
    if (options.platform === 'darwin') tray.setTitle(view.phase === 'finishing' ? RB.finishing : `● ${time}`);
    tray.setToolTip(RB.trayTip(time));
    const key = `${view.phase}|${view.canStop}|${view.canDiscard}|${RB.pause}`;
    if (key !== trayPhase) {
      trayPhase = key;
      tray.setContextMenu(Menu.buildFromTemplate(trayMenu(view, recordingId)));
    }
  };

  // ---- 快捷键 ----
  const unregister = () => {
    if (!registered) return;
    for (const accel of [registered.stop, registered.pause]) if (accel) globalShortcut.unregister(accel);
    registered = null;
  };
  const register = () => {
    if (registered) return;
    const failed: Array<'stop' | 'pause'> = [];
    const { stop, pause } = settings.shortcuts;
    const ok = (accel: string, run: () => void) => {
      try {
        return globalShortcut.register(accel, run);
      } catch {
        return false;
      }
    };
    if (stop && !ok(stop, () => {
      const r = current();
      if (r) void request('recordings.stop', r.recordingId);
    })) failed.push('stop');
    if (pause && pause !== stop && !ok(pause, () => {
      const r = current();
      const method = toggleMethod(r);
      if (r && method) void request(method, r.recordingId);
    })) failed.push('pause');
    registered = { stop: failed.includes('stop') ? '' : stop, pause: failed.includes('pause') ? '' : pause };
    if (failed.length) for (const w of options.appWindows()) if (!w.isDestroyed()) w.webContents.send(RECORDING_SHORTCUT_FAILED_CHANNEL, failed);
  };

  // ---- 状态变化 ----
  const sync = () => {
    const r = current();
    const view = barView(r);
    if (r && view) {
      const lost = announcedLost.get(r.recordingId) ?? new Set();
      const fresh = view.lost.filter((role) => !lost.has(role));
      if (fresh.length) {
        for (const role of fresh) lost.add(role);
        announcedLost.set(r.recordingId, lost);
        notice = RB.lost(fresh.map(roleName).join(', '));
      }
      sendBar(view);
    } else {
      notice = null;
      closeBar();
    }
    updateTray(view, r?.recordingId ?? null);
    if (shortcutsWanted(r)) register();
    else unregister();
  };

  const onRecording = (r: RecordingSummary) => {
    const plan = windowPlan(seen.get(r.recordingId), r.state, settings.hideWindow);
    seen.set(r.recordingId, r.state);
    recordings.set(r.recordingId, r);
    if (plan === 'hide') hideApp();
    if (plan === 'restore') restoreApp();
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
  // 断线（Runtime 退出或重启）：窗口放回来，控制条与快捷键拿掉，等重连后的快照。
  const stopState = client.onState((state) => {
    if (state.status === 'connected') return;
    if (hidden.length) restoreApp();
    recordings.clear();
    sync();
  });
  // 订阅不会自己连上：先连一次，之后断线由客户端重连。
  void client.connect().catch((error: unknown) => console.error('[recording] connect failed', error));
  const stopLocale = onLocaleChange(() => {
    trayPhase = null;
    sync();
  });

  ipcMain.on(RECORDING_CONFIGURE_CHANNEL, (event, raw: unknown) => {
    if (!isAppSender(event.sender, options) || event.senderFrame !== event.sender.mainFrame) return;
    const next = parseHostSettings(raw);
    const changed = next.shortcuts.stop !== settings.shortcuts.stop || next.shortcuts.pause !== settings.shortcuts.pause;
    settings = next;
    if (changed && registered) {
      unregister();
      sync();
    }
  });
  ipcMain.handle(RECORDING_SETTINGS_CHANNEL, async (event, permission: unknown) => {
    if (!isAppSender(event.sender, options) || event.senderFrame !== event.sender.mainFrame) throw new Error('Only app windows can open system settings');
    const url = privacyUrl(permission, options.platform);
    if (!url) throw new Error('No system settings page for this permission on this platform');
    await shell.openExternal(url);
  });
  ipcMain.on(RECORDING_BAR_READY_CHANNEL, (event) => {
    if (!bar || bar.isDestroyed() || event.sender !== bar.webContents) return;
    barReady = true;
    sync();
  });
  ipcMain.handle(RECORDING_BAR_ACT_CHANNEL, async (event, action: unknown) => {
    if (!bar || bar.isDestroyed() || event.sender !== bar.webContents) return;
    const r = current();
    if (!r || typeof action !== 'string') return;
    const a = action as BarAction;
    if (a === 'pause') await request('recordings.pause', r.recordingId);
    else if (a === 'resume') await request('recordings.resume', r.recordingId);
    else if (a === 'stop') await request('recordings.stop', r.recordingId);
    // 丢弃在条上已经确认过一次（两步按钮）。
    else if (a === 'discard') await discard(r.recordingId);
  });

  return {
    isBarWindow: (win) => !!bar && win === bar,
    dispose() {
      stopTopic();
      stopState();
      stopLocale();
      unregister();
      closeBar();
      tray?.destroy();
      tray = null;
      ipcMain.removeAllListeners(RECORDING_CONFIGURE_CHANNEL);
      ipcMain.removeAllListeners(RECORDING_BAR_READY_CHANNEL);
      ipcMain.removeHandler(RECORDING_SETTINGS_CHANNEL);
      ipcMain.removeHandler(RECORDING_BAR_ACT_CHANNEL);
      client.close();
    },
  };
}

function isAppSender(sender: Electron.WebContents, options: RecordingServiceOptions): boolean {
  return options.appWindows().some((w) => !w.isDestroyed() && w.webContents === sender);
}

function roleName(role: RecordingStreamStatus['role']): string {
  switch (role) {
    case 'camera':
      return RB.roleCamera;
    case 'microphone':
      return RB.roleMicrophone;
    case 'system-audio':
      return RB.roleSystemAudio;
    case 'screen':
      return RB.roleScreen;
    case 'pointer':
      return RB.rolePointer;
    case 'keyboard':
      return RB.roleKeyboard;
  }
}

/** 控制条页面在哪：开发时跟着开发服务器，打包后在 `out/renderer`。 */
export function barPageOf(devServerUrl: string | undefined, mainDir: string): { url: string } | { file: string } {
  if (devServerUrl) return { url: new URL('recording-bar.html', devServerUrl.endsWith('/') ? devServerUrl : `${devServerUrl}/`).href };
  return { file: path.join(mainDir, '../renderer/recording-bar.html') };
}
