import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron';
import { BaoCutClient } from '@baocut/client';
import { onLocaleChange, type BotStatus } from '@baocut/protocol';
import trayIconPath from '../../../build/icon.png?asset';
import trayMacPath from '../../../build/tray-mac.png?asset';
import trayMac2xPath from '../../../build/tray-mac@2x.png?asset';
import { BotMonitor, type NotificationHost } from './bot-monitor.ts';
import { quitServiceConfirmed, quitServicePrompt, residentQuitChoice, residentQuitPrompt, type ResidentQuitChoice } from './bot-quit.ts';
import { BOT_ROUTE_CHANNEL, BOT_TAKE_ROUTE_CHANNEL, PendingRoute, taskRoute, type BotRoute } from './bot-route.ts';
import { LoginItem } from './login-item.ts';
import { TrayController, type TrayHost, type TrayMenuItem } from './tray.ts';

/**
 * Bot 后台服务在主进程里的装配（技术方案 §15.2）：把 `BotMonitor`、`TrayController`、`LoginItem` 接到真正的 Electron
 * API 上。逻辑都在那几个模块里并有单测；这里只剩薄薄的 Electron 调用（托盘、菜单、通知、对话框、登录项、IPC），
 * 在这台 Linux 虚拟机上没法真跑，靠手动验收（技术方案 §20「桌面」一行）。
 */

export interface BotServiceOptions {
  /** Runtime 的地址与令牌（与渲染进程同一个来源：`RuntimeSupervisor.connection`）。 */
  connection(): Promise<{ endpoint: string; token: string }>;
  version: string;
  platform: NodeJS.Platform;
  /** 打开（必要时新建）应用窗口并带到前台。 */
  showWindow(): BrowserWindow;
  /** 「退出后台服务」确认后：停 Runtime 并退出应用，不再问。 */
  quitCompletely(): void;
  /** 常驻状态变化：告诉 Runtime（`{ type: 'resident' }`）并调整窗口生命周期。 */
  onResidency(resident: boolean, status: BotStatus | null): void;
  /** 登录项用的 `app`（`setLoginItemSettings` / `getLoginItemSettings`）。 */
  loginItemApi: ConstructorParameters<typeof LoginItem>[0];
}

export interface BotService {
  readonly monitor: BotMonitor;
  /** 打开窗口并把界面带到 Bot 页的某处。 */
  openRoute(route: BotRoute): void;
  /** 常驻时 `before-quit` 的确认框。 */
  confirmResidentQuit(parent: BrowserWindow | null): Promise<ResidentQuitChoice>;
  dispose(): void;
}

export function installBotService(options: BotServiceOptions): BotService {
  const pending = new PendingRoute();
  let quitDialogOpen = false;

  const openRoute = (route: BotRoute) => {
    pending.set(route);
    const win = options.showWindow();
    // 已经载入的界面收到提醒后来取；还在载入的，界面挂好时自己来取（bot-route.ts）。
    if (!win.webContents.isLoading()) win.webContents.send(BOT_ROUTE_CHANNEL);
  };

  ipcMain.handle(BOT_TAKE_ROUTE_CHANNEL, (event) => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return null;
    return pending.take();
  });

  const client = new BaoCutClient({
    resolve: () => options.connection(),
    client: { kind: 'desktop', name: 'BaoCut background service', version: options.version },
  });

  // 托盘的动作要用到 monitor，monitor 又要托盘：先建托盘，动作里晚一点读 monitor。
  let monitor: BotMonitor | null = null;
  const tray = new TrayController(
    () => electronTrayHost(options.platform),
    {
      openWindow: () => void options.showWindow(),
      openTask: (task) => openRoute(taskRoute(task.channelId, task.workItemId)),
      setPaused: (paused) => void monitor?.setPaused(paused).catch((error) => logError('pause automation failed', error)),
      quitService: () => {
        if (quitDialogOpen) return;
        quitDialogOpen = true;
        void (async () => {
          const status = (await monitor?.refreshStatus()) ?? null;
          const prompt = quitServicePrompt(status, monitor?.settings?.timeZone ?? null);
          const { response } = await dialog.showMessageBox(prompt);
          if (quitServiceConfirmed(response)) options.quitCompletely();
        })()
          .catch((error) => logError('quit background service failed', error))
          .finally(() => {
            quitDialogOpen = false;
          });
      },
    },
    options.platform,
  );

  monitor = new BotMonitor({
    client,
    notifier: electronNotificationHost(),
    tray,
    // Windows / Linux 上窗口全关后托盘是回到应用的唯一入口；macOS 有 Dock 图标。
    trayFallback: () => options.platform !== 'darwin' && BrowserWindow.getAllWindows().length === 0,
    loginItem: new LoginItem(options.loginItemApi, options.platform),
    openRoute,
    onResidency: (resident, status) => options.onResidency(resident, status),
    log: logError,
  });
  monitor.start();

  const offLocale = onLocaleChange(() => tray.render());

  return {
    monitor,
    openRoute,
    async confirmResidentQuit(parent) {
      const prompt = residentQuitPrompt(monitor.status, options.platform, monitor.settings?.timeZone ?? null);
      if (parent?.isMinimized()) parent.restore();
      const { response } = parent ? await dialog.showMessageBox(parent, prompt) : await dialog.showMessageBox(prompt);
      return residentQuitChoice(response);
    },
    dispose() {
      offLocale();
      ipcMain.removeHandler(BOT_TAKE_ROUTE_CHANNEL);
      monitor.dispose();
    },
  };
}

function logError(message: string, detail?: unknown): void {
  // i18n-ignore: diagnostic log for the main-process terminal
  console.error(`[baocut:bot] ${message}`, detail ?? '');
}

/** Electron 的系统通知。显示中的留着引用，点击回调才不会被回收。 */
function electronNotificationHost(): NotificationHost {
  const shown = new Set<Notification>();
  return {
    show(content, onClick) {
      if (!Notification.isSupported()) return;
      const notification = new Notification({
        title: content.title,
        body: content.body,
        ...(content.subtitle ? { subtitle: content.subtitle } : {}),
      });
      shown.add(notification);
      notification.on('click', () => {
        shown.delete(notification);
        onClick();
      });
      notification.on('close', () => shown.delete(notification));
      notification.show();
    },
  };
}

/**
 * Electron 的托盘图标与菜单。macOS 用单色模板图（`tools/app-icon` 生成的 18 点 1x / 2x），系统按菜单栏深浅染色，和别的
 * 菜单栏图标一样；Windows / Linux 的托盘图标惯例是彩色的，用应用图标缩到 16 像素。
 */
function electronTrayHost(platform: NodeJS.Platform): TrayHost {
  const tray = new Tray(platform === 'darwin' ? macTrayImage() : appTrayImage());
  return {
    setMenu: (items) => tray.setContextMenu(Menu.buildFromTemplate(items.map((item) => menuItem(item, platform)))),
    setToolTip: (text) => tray.setToolTip(text),
    onClick: (listener) => void tray.on('click', () => listener()),
    destroy: () => tray.destroy(),
  };
}

/** `?asset` 打包后文件名带哈希，认不出 `Template` 后缀与 `@2x`：两张各读进来，合成一张标成模板。 */
function macTrayImage(): NativeImage {
  const image = nativeImage.createEmpty();
  for (const [scaleFactor, file] of [
    [1, trayMacPath],
    [2, trayMac2xPath],
  ] as const) {
    const png = nativeImage.createFromPath(file);
    if (!png.isEmpty()) image.addRepresentation({ scaleFactor, buffer: png.toPNG() });
  }
  image.setTemplateImage(true);
  return image;
}

function appTrayImage(): NativeImage {
  const image = nativeImage.createFromPath(trayIconPath);
  return image.isEmpty() ? image : image.resize({ width: 16, height: 16, quality: 'best' });
}

/** Windows 的菜单把 `&` 当助记符：任务标题里的 `&` 要写成 `&&` 才照原样显示。 */
function menuItem(item: TrayMenuItem, platform: NodeJS.Platform): MenuItemConstructorOptions {
  const click = item.click;
  return {
    ...(item.label !== undefined ? { label: platform === 'win32' ? item.label.replaceAll('&', '&&') : item.label } : {}),
    ...(item.type ? { type: item.type } : {}),
    ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
    ...(click ? { click: () => click() } : {}),
    ...(item.submenu ? { submenu: item.submenu.map((child) => menuItem(child, platform)) } : {}),
  };
}
