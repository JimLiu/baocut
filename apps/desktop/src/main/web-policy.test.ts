import { describe, expect, it } from 'vitest';
import {
  OpenThrottle,
  browserUserAgent,
  checkWebUrl,
  clampZoom,
  isLoopbackHost,
  isRequestAllowed,
  isWebTabId,
  parseBounds,
} from './web-policy.ts';

const host = (raw: string) => new URL(raw).hostname;

describe('网页标签的地址规则', () => {
  it('回环地址：各种写法都认得出', () => {
    for (const raw of [
      'http://localhost:3000',
      'http://LOCALHOST./',
      'http://app.localhost',
      'http://127.0.0.1',
      'http://127.1',
      'http://127.255.0.9:8080',
      'http://0x7f.0.0.1',
      'http://2130706433',
      'http://0.0.0.0',
      'http://0/',
      'http://[::1]:5173',
      'http://[::]',
      'http://[::ffff:127.0.0.1]',
      'http://[0:0:0:0:0:0:0:1]',
    ]) {
      expect(isLoopbackHost(host(raw)), raw).toBe(true);
    }
    for (const raw of ['https://example.com', 'http://128.0.0.1', 'http://localhost.example.com', 'http://[::2]', 'http://10.0.0.1', 'http://[::ffff:8.8.8.8]']) {
      expect(isLoopbackHost(host(raw)), raw).toBe(false);
    }
  });

  it('只允许 http/https；拒绝回环地址与应用自己的页面；去掉账号密码', () => {
    expect(checkWebUrl('https://example.com/a?b#c')).toEqual({ ok: true, url: 'https://example.com/a?b#c' });
    expect(checkWebUrl('https://user:pass@example.com/')).toEqual({ ok: true, url: 'https://example.com/' });
    expect(checkWebUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'scheme' });
    expect(checkWebUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'scheme' });
    expect(checkWebUrl('data:text/html,hi')).toEqual({ ok: false, reason: 'scheme' });
    expect(checkWebUrl('chrome://settings')).toEqual({ ok: false, reason: 'scheme' });
    expect(checkWebUrl('not a url')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkWebUrl(42)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkWebUrl('')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkWebUrl('http://localhost:5173/')).toEqual({ ok: false, reason: 'loopback' });
    expect(checkWebUrl('http://[::1]/')).toEqual({ ok: false, reason: 'loopback' });
    expect(checkWebUrl('http://localhost:5173/x', { appOrigins: ['http://localhost:5173'] })).toEqual({ ok: false, reason: 'app-origin' });
    // 界面主动交给系统浏览器时可以放行回环地址。
    expect(checkWebUrl('http://localhost:3000/', { allowLoopback: true })).toEqual({ ok: true, url: 'http://localhost:3000/' });
  });

  it('分区里的请求：网络请求按地址规则判；data/blob/about 放行；file 与其它协议拦下', () => {
    expect(isRequestAllowed('https://example.com/a.js')).toBe(true);
    expect(isRequestAllowed('http://127.0.0.1:7777/rpc')).toBe(false);
    expect(isRequestAllowed('ws://localhost:7777/')).toBe(false);
    expect(isRequestAllowed('wss://example.com/socket')).toBe(true);
    expect(isRequestAllowed('ws://localhost:5173/', [])).toBe(false);
    expect(isRequestAllowed('wss://app.example/', ['https://app.example'])).toBe(false);
    expect(isRequestAllowed('data:image/png;base64,AAAA')).toBe(true);
    expect(isRequestAllowed('blob:https://example.com/uuid')).toBe(true);
    expect(isRequestAllowed('about:blank')).toBe(true);
    expect(isRequestAllowed('file:///Users/me/secret.txt')).toBe(false);
    expect(isRequestAllowed('devtools://devtools/x')).toBe(false);
    expect(isRequestAllowed('garbage')).toBe(false);
  });
});

describe('网页标签的参数校验', () => {
  it('缩放收进 50–200', () => {
    expect(clampZoom(125)).toBe(125);
    expect(clampZoom(10)).toBe(50);
    expect(clampZoom(500)).toBe(200);
    expect(clampZoom(66.7)).toBe(67);
    expect(clampZoom(Number.NaN)).toBeNull();
    expect(clampZoom('100')).toBeNull();
  });

  it('矩形：取整，拒绝负宽高、非有限数与缺字段', () => {
    expect(parseBounds({ x: 10.4, y: 20.6, width: 300.5, height: 200.2 })).toEqual({ x: 10, y: 21, width: 301, height: 200 });
    expect(parseBounds({ x: 0, y: 0, width: -1, height: 10 })).toBeNull();
    expect(parseBounds({ x: 0, y: 0, width: Infinity, height: 10 })).toBeNull();
    expect(parseBounds({ x: 0, y: 0, width: 10 })).toBeNull();
    expect(parseBounds('0,0,10,10')).toBeNull();
    expect(parseBounds(null)).toBeNull();
  });

  it('标签 id 的外形', () => {
    expect(isWebTabId('web_1_abc')).toBe(true);
    expect(isWebTabId('web_')).toBe(false);
    expect(isWebTabId('../x')).toBe(false);
    expect(isWebTabId(1)).toBe(false);
  });

  it('User-Agent 去掉应用名与 Electron', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) @baocut/desktop/0.1.0 Chrome/140.0.7339.0 Electron/44.5.1 Safari/537.36';
    expect(browserUserAgent(ua)).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.0 Safari/537.36',
    );
  });

  it('弹窗节流：同一标签一秒内只放一次', () => {
    const gate = new OpenThrottle(1000);
    expect(gate.allow('a', 0)).toBe(true);
    expect(gate.allow('a', 500)).toBe(false);
    expect(gate.allow('b', 500)).toBe(true);
    expect(gate.allow('a', 1000)).toBe(true);
    gate.forget('a');
    expect(gate.allow('a', 1001)).toBe(true);
  });
});
