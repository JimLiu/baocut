import { BrowserWindow, Notification, app, ipcMain } from 'electron';

/*
 * 系统通知与徽标（产品设计 §3.1「提醒」）：要不要提醒、提醒什么由界面决定（packages/ui model/attention.ts），这里只把它交给系统。
 * 点通知时窗口回到前台，把会话 id 发回界面去打开那条会话。
 *
 * 平台差异（开发流程 §4.1）：macOS 的 Dock 与 Linux（Unity 启动器）用 `app.setBadgeCount` 显示数字；Windows 没有数字徽标，
 * 发通知时窗口在后台就让任务栏按钮闪，回到前台自己停。Windows 的系统通知要求进程的 AppUserModelID 与开始菜单快捷方式的一致
 * （安装器把快捷方式设成 appId），启动时由 `app-main.ts` 设好；免安装的 zip 版没有快捷方式，系统可能不显示通知。
 */

export interface NotificationInput {
  title: string;
  body: string;
  conversationId: string;
}

/** 界面给的通知：只收认得的字段，标题与正文截短，会话 id 只认 id 的字符。 */
export function notificationInput(raw: unknown): NotificationInput | null {
  const { title, body, conversationId } = (raw ?? {}) as Record<string, unknown>;
  if (typeof title !== 'string' || typeof body !== 'string' || typeof conversationId !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) return null;
  const head = title.trim().slice(0, 200);
  if (!head) return null;
  return { title: head, body: body.trim().slice(0, 500), conversationId };
}

/** 徽标上的数：0–999 的整数，别的不认。 */
export function badgeCount(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 999 ? raw : null;
}

/** 显示中的通知：留着引用，点击回调才不会被回收。 */
const shown = new Set<Notification>();

export function installNotifications(): void {
  ipcMain.on('baocut:notify', (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return;
    const input = notificationInput(raw);
    if (!input || !Notification.isSupported()) return;
    const notification = new Notification({ title: input.title, body: input.body });
    shown.add(notification);
    notification.on('click', () => {
      shown.delete(notification);
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('baocut:notification-click', input.conversationId);
    });
    notification.on('close', () => shown.delete(notification));
    notification.show();
    if (process.platform === 'win32' && !win.isFocused()) win.flashFrame(true);
  });

  ipcMain.on('baocut:set-badge', (event, raw: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return;
    const count = badgeCount(raw);
    if (count === null || process.platform === 'win32') return;
    app.setBadgeCount(count);
  });
}
