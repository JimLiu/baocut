import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ handlers: new Map<string, Function>(), listeners: new Map<string, Function>(), views: [] as any[], owner: null as any,
  session: null as any, openExternal: vi.fn(async () => {}) }));
vi.mock('electron', () => ({
  ipcMain: { handle: (key: string, fn: Function) => env.handlers.set(key, fn), on: (key: string, fn: Function) => env.listeners.set(key, fn) },
  BrowserWindow: { fromWebContents: (wc: any) => wc === env.owner.webContents ? env.owner : null },
  WebContentsView: class { webContents = makeContents(); setVisible = vi.fn(); setBounds = vi.fn(); constructor() { env.views.push(this); } },
  session: { fromPartition: () => env.session }, shell: { openExternal: env.openExternal },
}));
import { installWebTabs } from './web-tabs.ts';
import { nativeWebShortcut, parseDeviceSize, parseFindRequest } from './web-policy.ts';

function makeContents() {
  let request = 0;
  return Object.assign(new EventEmitter(), {
    mainFrame: { parent: null }, isDestroyed: () => false, getURL: () => 'https://example.com/', getTitle: () => 'Example', isLoading: () => false,
    navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() },
    send: vi.fn(), close: vi.fn(), setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), loadURL: vi.fn(async () => {}),
    reload: vi.fn(), reloadIgnoringCache: vi.fn(), stop: vi.fn(), enableDeviceEmulation: vi.fn(), disableDeviceEmulation: vi.fn(),
    findInPage: vi.fn(() => ++request), stopFindInPage: vi.fn(), focus: vi.fn(),
  });
}
const event = () => ({ sender: env.owner.webContents, senderFrame: env.owner.webContents.mainFrame });
const invoke = (name: string, ...args: unknown[]) => env.handlers.get(`baocut:web-${name}`)!(event(), ...args);
const send = (name: string, ...args: unknown[]) => env.listeners.get(`baocut:web-${name}`)!(event(), ...args);

beforeEach(() => {
  env.views = []; env.handlers.clear(); env.listeners.clear(); env.openExternal.mockClear();
  env.owner = Object.assign(new EventEmitter(), { webContents: makeContents(), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, isDestroyed: () => false });
  env.session = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() }, setUserAgent: vi.fn(), getUserAgent: () => 'Chrome/140', clearStorageData: vi.fn(), clearCache: vi.fn(), clearAuthCache: vi.fn() });
  installWebTabs({ appOrigins: ['http://localhost:5173'] });
});

describe('原生浏览器能力', () => {
  it('原生文档就绪前不调用设备模拟或查找清理，跨页导航后重新等待就绪', () => {
    const id = invoke('create'), wc = env.views[0].webContents;
    send('viewport', id, null); send('find-stop', id);
    send('bounds', id, { x: 0, y: 0, width: 390, height: 844 });
    send('viewport', id, { width: 390, height: 844 });
    expect(wc.disableDeviceEmulation).not.toHaveBeenCalled();
    expect(wc.enableDeviceEmulation).not.toHaveBeenCalled();
    expect(wc.stopFindInPage).not.toHaveBeenCalled();
    wc.emit('dom-ready'); expect(wc.enableDeviceEmulation).toHaveBeenCalledOnce();
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    send('bounds', id, { x: 0, y: 0, width: 390, height: 844 });
    expect(wc.enableDeviceEmulation).toHaveBeenCalledOnce();
    wc.emit('dom-ready'); expect(wc.enableDeviceEmulation).toHaveBeenCalledTimes(2);
  });
  it('查找只接受当前请求的结果；停止后忽略在途结果', () => {
    const id = invoke('create'), wc = env.views[0].webContents;
    wc.emit('dom-ready');
    send('find', id, { query: '字幕' });
    expect(wc.findInPage).toHaveBeenLastCalledWith('字幕', { forward: true, findNext: true });
    send('find', id, { query: 'caption', next: true, forward: false });
    expect(wc.findInPage).toHaveBeenLastCalledWith('caption', { forward: false, findNext: false });
    wc.emit('found-in-page', {}, { requestId: 1, activeMatchOrdinal: 9, matches: 10 });
    expect(env.owner.webContents.send.mock.lastCall[1].find).toEqual({ query: 'caption', active: 0, matches: 0 });
    wc.emit('found-in-page', {}, { requestId: 2, activeMatchOrdinal: 2, matches: 3 });
    expect(env.owner.webContents.send.mock.lastCall[1].find).toEqual({ query: 'caption', active: 2, matches: 3 });
    send('find-stop', id);
    wc.emit('found-in-page', {}, { requestId: 2, activeMatchOrdinal: 2, matches: 3 });
    expect(env.owner.webContents.send.mock.lastCall[1].find.matches).toBe(0);
  });
  it('真实忽略缓存刷新、视口模拟、原生网页快捷键；子框架不能控制视图', () => {
    const id = invoke('create'), wc = env.views[0].webContents;
    wc.emit('dom-ready');
    send('reload', id, true); expect(wc.reloadIgnoringCache).toHaveBeenCalledOnce();
    send('bounds', id, { x: 100, y: 200, width: 390, height: 844 });
    send('viewport', id, { width: 390, height: 844 });
    expect(wc.enableDeviceEmulation).toHaveBeenLastCalledWith(expect.objectContaining({ viewSize: { width: 390, height: 844 }, scale: 1 }));
    send('viewport', id, { width: 1, height: 1 }); expect(wc.enableDeviceEmulation).toHaveBeenCalledTimes(1);
    send('viewport', id, null); expect(wc.disableDeviceEmulation).toHaveBeenCalled();
    const preventDefault = vi.fn();
    wc.emit('before-input-event', { preventDefault }, { type: 'keyDown', key: 'f', code: 'KeyF', meta: process.platform === 'darwin', control: process.platform !== 'darwin', alt: false, shift: false });
    expect(env.owner.webContents.send).toHaveBeenLastCalledWith('baocut:web-shortcut', { id, action: 'find' });
    env.listeners.get('baocut:web-reload')!({ sender: env.owner.webContents, senderFrame: { parent: {} } }, id, true);
    expect(wc.reloadIgnoringCache).toHaveBeenCalledOnce();
  });
  it('弹窗和权限拒绝有状态提示，关闭标签销毁原生视图', () => {
    const id = invoke('create'), wc = env.views[0].webContents;
    wc.emit('dom-ready');
    expect(wc.setWindowOpenHandler.mock.lastCall[0]({ url: 'https://example.org/' })).toEqual({ action: 'deny' });
    expect(env.openExternal).not.toHaveBeenCalled();
    expect(env.owner.webContents.send.mock.lastCall[1].notice.kind).toBe('popup');
    const cb = vi.fn(); env.session.setPermissionRequestHandler.mock.lastCall[0](wc, 'camera', cb);
    expect(cb).toHaveBeenCalledWith(false);
    expect(env.owner.webContents.send.mock.lastCall[1].notice.kind).toBe('permission');
    send('destroy', id); expect(wc.close).toHaveBeenCalledOnce();
  });
  it('跨平台输入和尺寸参数严格校验', () => {
    expect(parseDeviceSize({ width: Infinity, height: 400 })).toBeNull();
    expect(parseFindRequest({ query: 'x'.repeat(4097) })).toBeNull();
    expect(nativeWebShortcut({ key: 'r', meta: false, control: true, alt: false, shift: true }, false)).toBe('force-reload');
  });
});
