import { BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { BaoCutClient } from '@baocut/client';
import { onLocaleChange, type BotStatus } from '@baocut/protocol';
import trayIconPath from '../../../build/icon.png?asset';
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
  /** 以隐藏方式启动时先把托盘挂上，等设置到了再决定留不留。 */
  showTray(): void;
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
    showTray: () => tray.show(),
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

/** Electron 的托盘图标与菜单。图标用应用图标缩小（macOS 菜单栏 18 点，其余 16 像素）。 */
function electronTrayHost(platform: NodeJS.Platform): TrayHost {
  const size = platform === 'darwin' ? 18 : 16;
  const image = nativeImage.createFromPath(trayIconPath);
  const tray = new Tray(image.isEmpty() ? image : image.resize({ width: size, height: size, quality: 'best' }));
  return {
    setMenu: (items) => tray.setContextMenu(Menu.buildFromTemplate(items.map((item) => menuItem(item, platform)))),
    setTitle: (title) => tray.setTitle(title),
    setToolTip: (text) => tray.setToolTip(text),
    onClick: (listener) => void tray.on('click', () => listener()),
    destroy: () => tray.destroy(),
  };
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
