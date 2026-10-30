import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  listeners: new Map<string, Function>(),
  notifications: [] as any[],
  win: null as any,
  setBadgeCount: vi.fn(),
}));
vi.mock('electron', () => ({
  Notification: Object.assign(
    function Notification(this: any, options: { title: string; body: string }) {
      const notification = Object.assign(new EventEmitter(), { options, show: vi.fn() });
      env.notifications.push(notification);
      return notification;
    },
    { isSupported: () => true },
  ),
  app: { setBadgeCount: env.setBadgeCount },
  ipcMain: { on: (channel: string, listener: Function) => env.listeners.set(channel, listener) },
  BrowserWindow: { fromWebContents: () => env.win },
}));
import { badgeCount, installNotifications, notificationInput } from './notifications.ts';

function fakeWindow(focused: boolean) {
  return {
    isDestroyed: () => false,
    isMinimized: () => true,
    isFocused: () => focused,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

function send(channel: string, value: unknown) {
  const frame = {};
  env.listeners.get(channel)!({ sender: { mainFrame: frame }, senderFrame: frame }, value);
}

describe('system notifications', () => {
  beforeEach(() => {
    env.listeners.clear();
    env.notifications.length = 0;
    env.setBadgeCount.mockClear();
    installNotifications();
  });

  it('只收认得的字段：会话 id 只认 id 字符，标题不能空，过长截短', () => {
    expect(notificationInput({ title: ' Trim ', body: 'Done', conversationId: 'conv_1', extra: 1 })).toEqual({
      title: 'Trim',
      body: 'Done',
      conversationId: 'conv_1',
    });
    expect(notificationInput({ title: 'x', body: 'y', conversationId: '../etc' })).toBeNull();
    expect(notificationInput({ title: '  ', body: 'y', conversationId: 'c' })).toBeNull();
    expect(notificationInput(null)).toBeNull();
    expect(notificationInput({ title: 'a'.repeat(300), body: '', conversationId: 'c' })?.title).toHaveLength(200);
    expect([badgeCount(3), badgeCount(-1), badgeCount(1.5), badgeCount('2'), badgeCount(1000)]).toEqual([3, null, null, null, null]);
  });

  it('点通知：窗口还原到前台，把会话 id 发回界面', () => {
    env.win = fakeWindow(true);
    send('baocut:notify', { title: 'Trim the intro', body: 'Waiting for your approval', conversationId: 'conv_1' });
    const [notification] = env.notifications;
    expect(notification.options).toEqual({ title: 'Trim the intro', body: 'Waiting for your approval' });
    expect(notification.show).toHaveBeenCalled();
    notification.emit('click');
    expect(env.win.restore).toHaveBeenCalled();
    expect(env.win.focus).toHaveBeenCalled();
    expect(env.win.webContents.send).toHaveBeenCalledWith('baocut:notification-click', 'conv_1');
  });

  it('不是主框架发的不理；徽标数只认整数', () => {
    env.win = fakeWindow(true);
    env.listeners.get('baocut:notify')!({ sender: { mainFrame: {} }, senderFrame: {} }, { title: 'x', body: '', conversationId: 'c' });
    expect(env.notifications).toHaveLength(0);
    send('baocut:set-badge', 2);
    send('baocut:set-badge', 'x');
    if (process.platform === 'win32') expect(env.setBadgeCount).not.toHaveBeenCalled();
    else expect(env.setBadgeCount.mock.calls).toEqual([[2]]);
  });
});
