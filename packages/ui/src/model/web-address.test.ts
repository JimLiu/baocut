import { describe, expect, it } from 'vitest';
import { DEVICE_PRESETS, deviceFrame, WEB_ZOOM_STEPS, displayUrl, resolveAddress, webShortcut, zoomStep } from './web-address.ts';

describe('网页标签的地址栏', () => {
  it('像网址的按网址打开，补上协议', () => {
    expect(resolveAddress('example.com')).toBe('https://example.com/');
    expect(resolveAddress('  example.com/a?b=1  ')).toBe('https://example.com/a?b=1');
    expect(resolveAddress('http://example.com')).toBe('http://example.com/');
    expect(resolveAddress('localhost:3000')).toBe('http://localhost:3000/');
    expect(resolveAddress('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
    expect(resolveAddress('example.com:8443')).toBe('https://example.com:8443/');
  });

  it('不合规矩的网址返回 null：非 http/https、带账号密码', () => {
    expect(resolveAddress('file:///etc/passwd')).toBeNull();
    expect(resolveAddress('javascript:alert(1)')).toBeNull();
    expect(resolveAddress('https://user:pw@example.com')).toBeNull();
    expect(resolveAddress('   ')).toBeNull();
  });

  it('其余当搜索词，走 Google', () => {
    expect(resolveAddress('剪辑 教程')).toBe('https://www.google.com/search?q=%E5%89%AA%E8%BE%91%20%E6%95%99%E7%A8%8B');
    expect(resolveAddress('react hooks')).toBe('https://www.google.com/search?q=react%20hooks');
  });

  it('静止时显示的网址不带协议，根路径省略', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com');
    expect(displayUrl('https://example.com:8443/a/b?q=1#top')).toBe('example.com:8443/a/b?q=1#top');
    expect(displayUrl('')).toBe('');
  });
});

describe('网页标签的快捷键', () => {
  const key = (over: Partial<Parameters<typeof webShortcut>[0]>) => ({
    key: 'l',
    code: 'KeyL',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  it('macOS 用 ⌘，其它平台用 Ctrl；按物理键判断', () => {
    expect(webShortcut(key({ metaKey: true }), true)).toBe('focus-address');
    expect(webShortcut(key({ metaKey: true, key: 'r', code: 'KeyR' }), true)).toBe('reload');
    expect(webShortcut(key({ metaKey: true, shiftKey: true, code: 'KeyR' }), true)).toBe('force-reload');
    expect(webShortcut(key({ ctrlKey: true, code: 'KeyF' }), false)).toBe('find');
    expect(webShortcut(key({ metaKey: true, key: 'ｌ' }), true)).toBe('focus-address');
    expect(webShortcut(key({ ctrlKey: true }), false)).toBe('focus-address');
    expect(webShortcut(key({ ctrlKey: true }), true)).toBeNull();
    expect(webShortcut(key({ metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(webShortcut(key({}), true)).toBeNull();
    expect(webShortcut(key({ metaKey: true, key: 'k', code: 'KeyK' }), true)).toBeNull();
  });
});

describe('网页缩放', () => {
  it('一档一档放大缩小，到头不动', () => {
    expect(zoomStep(100, 1)).toBe(110);
    expect(zoomStep(100, -1)).toBe(90);
    expect(zoomStep(200, 1)).toBe(200);
    expect(zoomStep(50, -1)).toBe(50);
    expect(zoomStep(80, 1)).toBe(90);
    expect(zoomStep(80, -1)).toBe(75);
    expect(WEB_ZOOM_STEPS[0]).toBe(50);
    expect(WEB_ZOOM_STEPS.at(-1)).toBe(200);
  });
});

it('设备视口等比适配当前面板，不超出原生视图边界', () => {
  expect(deviceFrame(DEVICE_PRESETS.phone, { width: 422, height: 876 })).toEqual(DEVICE_PRESETS.phone);
  const frame = deviceFrame({ width: 1440, height: 900 }, { width: 752, height: 482 });
  expect(frame).toEqual({ width: 720, height: 450 });
  expect(deviceFrame(DEVICE_PRESETS.phone, { width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
});
