import { describe, expect, it } from 'vitest';
import { LINK_COOKIE_BROWSERS, type CookieBrowserInfo } from '@baocut/protocol';
import {
  allBrowsersState,
  COOKIE_BROWSER_LABEL,
  cookieNotes,
  orderedBrowsers,
  toggleAllBrowsers,
  toggleBrowser,
  usedCookieText,
} from './link-cookies.ts';

/** 下载视频的「网站登录」（产品设计 §2.7）：勾选的顺序、「所有浏览器」的全选与半选、说明与结果的说法。 */

const detected: CookieBrowserInfo[] = [
  { id: 'chrome', label: 'Chrome', lastUsedAt: '2026-10-06T09:42:00Z' },
  { id: 'safari', label: 'Safari', lastUsedAt: null },
  { id: 'firefox', label: 'Firefox', lastUsedAt: '2026-09-28T14:03:00Z' },
  { id: 'edge', label: 'Edge', lastUsedAt: '2026-08-17T08:30:00Z' },
];

describe('网站登录', () => {
  it('勾选的浏览器按检测到的顺序排（就是尝试的顺序），没检测到的去掉', () => {
    expect(orderedBrowsers(['edge', 'chrome'], detected)).toEqual(['chrome', 'edge']);
    expect(orderedBrowsers(['brave', 'safari'], detected)).toEqual(['safari']);
    expect(orderedBrowsers(['chrome'], [])).toEqual([]);
    expect(toggleBrowser(['edge'], 'chrome', true, detected)).toEqual(['chrome', 'edge']);
    expect(toggleBrowser(['chrome', 'edge'], 'chrome', false, detected)).toEqual(['edge']);
  });

  it('「所有浏览器」：全选、半选与没选；点它在全选时清空，否则选上全部', () => {
    expect(allBrowsersState([], detected)).toEqual({ selected: false, indeterminate: false });
    expect(allBrowsersState(['safari'], detected)).toEqual({ selected: false, indeterminate: true });
    expect(allBrowsersState(['edge', 'firefox', 'safari', 'chrome'], detected)).toEqual({ selected: true, indeterminate: false });
    expect(allBrowsersState([], [])).toEqual({ selected: false, indeterminate: false });
    expect(toggleAllBrowsers([], detected)).toEqual(['chrome', 'safari', 'firefox', 'edge']);
    expect(toggleAllBrowsers(['safari'], detected)).toEqual(['chrome', 'safari', 'firefox', 'edge']);
    expect(toggleAllBrowsers(['chrome', 'safari', 'firefox', 'edge'], detected)).toEqual([]);
  });

  it('说明：按勾了几个说怎么用；总说只读勾选的、不保存 Cookie；Runtime 在 macOS 上时提示钥匙串与 Safari 权限', () => {
    const none = cookieNotes([], 'darwin');
    expect(none[0]).toMatch(/匿名下载/);
    expect(none[1]).toMatch(/只读取你勾选的浏览器.*不保存 Cookie 内容/);
    expect(none).toHaveLength(2);
    expect(cookieNotes(['firefox'], 'darwin')[0]).toMatch(/用 Firefox 的 Cookie/);
    expect(cookieNotes(['firefox'], 'darwin')).toHaveLength(2);
    const many = cookieNotes(['chrome', 'safari', 'edge'], 'darwin');
    expect(many[0]).toMatch(/按 Chrome → Safari → Edge 的顺序逐个试/);
    expect(many[2]).toMatch(/为 Chrome、Edge 各弹出一次钥匙串授权/);
    expect(many[3]).toMatch(/完全磁盘访问权限/);
    expect(cookieNotes(['edge'], 'darwin')[2]).toMatch(/^macOS 会为 Edge 弹出一次钥匙串授权/);
    expect(cookieNotes(['chrome', 'safari'], 'linux')).toHaveLength(2);
    expect(cookieNotes(['chrome', 'safari'], null)).toHaveLength(2);
  });

  it('Windows：Chromium 内核的开着时读不到、要先退出；Chrome、Edge、Brave 的应用绑定加密可能读不到；没勾 Firefox 时建议改用它', () => {
    const chrome = cookieNotes(['chrome'], 'win32');
    expect(chrome).toHaveLength(4);
    expect(chrome[2]).toMatch(/^Chrome 开着时 Cookie 库被占用.*先完全退出这个浏览器/);
    expect(chrome[3]).toMatch(/^Chrome 在 Windows 上通常用应用绑定加密.*可能读不到.*建议在 Firefox 里登录目标网站后改勾 Firefox。$/);
    expect(chrome.join('')).not.toMatch(/钥匙串|完全磁盘访问权限/);
    // Opera、Vivaldi 只有占用的问题，不说应用绑定加密。
    const opera = cookieNotes(['opera', 'vivaldi'], 'win32');
    expect(opera).toHaveLength(3);
    expect(opera[2]).toMatch(/^Opera、Vivaldi 开着时.*这些浏览器.*改勾 Firefox。$/);
    // 勾了 Firefox 就不再建议。
    const mixed = cookieNotes(['chrome', 'firefox', 'edge', 'brave'], 'win32');
    expect(mixed[3]).toMatch(/^Chrome、Edge、Brave 在 Windows 上通常用应用绑定加密/);
    expect(mixed.join('')).not.toMatch(/改勾 Firefox/);
    expect(cookieNotes(['firefox'], 'win32')).toHaveLength(2);
    expect(cookieNotes([], 'win32')).toHaveLength(2);
  });

  it('结果写明用上的浏览器；每个取值都有名字', () => {
    expect(usedCookieText('chrome')).toBe('用了 Chrome 的 Cookie');
    expect(LINK_COOKIE_BROWSERS.every((id) => !!COOKIE_BROWSER_LABEL[id])).toBe(true);
  });
});
