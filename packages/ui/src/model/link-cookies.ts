import { defineMessages, intlLocale, onLocaleChange, type CookieBrowserInfo, type LinkCookieBrowser } from '@baocut/protocol';
import { zhHans } from './link-cookies.zh-Hans.ts';
import { zhHant } from './link-cookies.zh-Hant.ts';
import { ja } from './link-cookies.ja.ts';
import { ko } from './link-cookies.ko.ts';
import { es } from './link-cookies.es.ts';
import { fr } from './link-cookies.fr.ts';
import { de } from './link-cookies.de.ts';
import { nl } from './link-cookies.nl.ts';
import { ptBR } from './link-cookies.pt-BR.ts';
import { it } from './link-cookies.it.ts';
import { ru } from './link-cookies.ru.ts';
import { pl } from './link-cookies.pl.ts';
import { tr } from './link-cookies.tr.ts';
import { vi } from './link-cookies.vi.ts';

const andList = (names: readonly string[]) => new Intl.ListFormat(intlLocale('en'), { type: 'conjunction' }).format(names);

/** 「网站登录」的文案（英文是键与类型的来源，译文在 `link-cookies.zh-Hans.ts`）。 */
const en = {
  noneChecked: 'Leave them all unchecked to download anonymously. If the site asks you to sign in or verify, sign in to it in a browser first, then check that browser.',
  oneChecked: (name: string) => `Uses ${name} cookies to access the site.`,
  manyChecked: (names: readonly string[]) =>
    `Tries ${names.join(' → ')} in that order: if a browser’s cookies can’t be read or the site still asks you to sign in, it moves on to the next one and stops at the first that works. The result says which one was used.`,
  privacy: 'Only the browsers you check are read. yt-dlp reads the cookies on this computer and uses them only to access the site; BaoCut remembers only the browser names, never the cookies.',
  keychain: (names: readonly string[]) =>
    `macOS will ask for Keychain access once for ${names.length > 1 ? `each of ${andList(names)}` : names[0]}. Choose “Always Allow” and it won’t ask again.`,
  safariAccess: 'To read Safari cookies, first allow BaoCut in System Settings › Privacy & Security › Full Disk Access.',
  chromiumLocked: (names: readonly string[]) =>
    names.length > 1
      ? `While ${andList(names)} are open, their cookie databases are locked and can’t be read. Quit these browsers completely before downloading, including any running in the background.`
      : `While ${names[0]} is open, its cookie database is locked and can’t be read. Quit this browser completely before downloading, including if it’s running in the background.`,
  appBound: (names: readonly string[]) =>
    `On Windows, ${andList(names)} usually ${names.length > 1 ? 'protect' : 'protects'} cookies with App-Bound Encryption, which yt-dlp may not be able to read, even after you quit the browser.`,
  /** 接在上一句后面（英文带前导空格）。 */
  firefoxTip: ' If you need to sign in, sign in to the site in Firefox and check Firefox instead.',
  noBrowsers: 'No browser cookies were found on this computer, so downloads can only be anonymous. After you sign in to the site in a browser, click “Detect browsers again”.',
  used: (name: string) => `Used ${name} cookies`,
};
export type LinkCookiesMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 下载视频的「网站登录」（产品设计 §2.7「下载视频」，架构设计 §7.9 Cookie、§12.9「本机浏览器」；设计稿 model-tool-cookies.js）。
 *
 * - 只列出 Runtime 检测到有 Cookie 库的浏览器（`externalTools.cookieBrowsers`），最近用过的在前。
 * - 勾选的浏览器按列出的顺序逐个试（不是按点选的先后）：读不到 Cookie 或网站仍要求登录时换下一个，用上一个就停。
 * - 「所有浏览器」不是一个取值：勾上就是全选检测到的，提交的仍是浏览器列表；只勾了一部分时半选。都不勾是匿名下载。
 * - 系统授权的提示看 Runtime 所在主机的平台（检测结果带的 `platform`），不看这个界面跑在哪。
 */

export const COOKIE_BROWSER_LABEL: Readonly<Record<LinkCookieBrowser, string>> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  brave: 'Brave',
  chromium: 'Chromium',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  whale: 'Whale',
};

/** Chromium 内核：macOS 上 Cookie 用钥匙串里的密钥加密、读取时会弹授权；Windows 上浏览器开着时 Cookie 库被占用（yt-dlp #7271）。 */
const CHROMIUM: readonly LinkCookieBrowser[] = ['chrome', 'edge', 'brave', 'chromium', 'opera', 'vivaldi', 'whale'];

/**
 * Windows 上用应用绑定加密（App-Bound Encryption）保护 Cookie、yt-dlp 目前解不开的（yt-dlp #10927，2026-10 核对）：
 * Chrome 127 起的系统级安装、Edge（总是系统级安装）、Brave 的系统级安装。Opera、Vivaldi 目前没有启用，不在此列。
 */
const APP_BOUND: readonly LinkCookieBrowser[] = ['chrome', 'edge', 'brave'];

export const cookieBrowserLabel = (id: LinkCookieBrowser): string => COOKIE_BROWSER_LABEL[id] ?? id;

type Detected = readonly Pick<CookieBrowserInfo, 'id'>[];

/** 勾选的浏览器按检测到的顺序排（就是尝试的顺序）；重新检测后不在列表里的去掉。 */
export function orderedBrowsers(checked: readonly LinkCookieBrowser[], detected: Detected): LinkCookieBrowser[] {
  const set = new Set(checked);
  return detected.map((b) => b.id).filter((id) => set.has(id));
}

/** 「所有浏览器」：检测到的都勾上是全选，勾了一部分是半选。 */
export function allBrowsersState(checked: readonly LinkCookieBrowser[], detected: Detected): { selected: boolean; indeterminate: boolean } {
  const n = orderedBrowsers(checked, detected).length;
  const total = detected.length;
  return { selected: total > 0 && n === total, indeterminate: n > 0 && n < total };
}

/** 点「所有浏览器」：全选时清空，没选或半选时选上全部。 */
export function toggleAllBrowsers(checked: readonly LinkCookieBrowser[], detected: Detected): LinkCookieBrowser[] {
  return allBrowsersState(checked, detected).selected ? [] : detected.map((b) => b.id);
}

/** 勾上或取消一个浏览器，结果仍按检测到的顺序。 */
export function toggleBrowser(checked: readonly LinkCookieBrowser[], id: LinkCookieBrowser, on: boolean, detected: Detected): LinkCookieBrowser[] {
  const rest = checked.filter((x) => x !== id);
  return orderedBrowsers(on ? [...rest, id] : rest, detected);
}

/**
 * 复选框下面的说明：先说按勾选怎么用，再说读了什么、BaoCut 记什么；再按 Runtime 所在主机与勾了哪些浏览器提示：
 * macOS 上的系统授权，Windows 上 Cookie 库被占用与应用绑定加密（没勾 Firefox 时建议改用它）。
 */
export function cookieNotes(list: readonly LinkCookieBrowser[], platform: string | null): string[] {
  const names = list.map(cookieBrowserLabel);
  const lines = [
    list.length === 0 ? M.noneChecked : list.length === 1 ? M.oneChecked(names[0]!) : M.manyChecked(names),
    M.privacy,
  ];
  if (platform === 'darwin') {
    const keychain = list.filter((id) => CHROMIUM.includes(id)).map(cookieBrowserLabel);
    if (keychain.length) lines.push(M.keychain(keychain));
    if (list.includes('safari')) lines.push(M.safariAccess);
  }
  if (platform === 'win32') {
    const chromium = list.filter((id) => CHROMIUM.includes(id)).map(cookieBrowserLabel);
    const appBound = list.filter((id) => APP_BOUND.includes(id)).map(cookieBrowserLabel);
    if (chromium.length) lines.push(M.chromiumLocked(chromium));
    if (appBound.length) lines.push(M.appBound(appBound));
    if (chromium.length && !list.includes('firefox')) lines[lines.length - 1] += M.firefoxTip;
  }
  return lines;
}

/** 一个都没检测到时的说明。 */
// 旧的具名字符串导出：字符串没法按读取取当前语言，换语言时改写这个绑定（ES 模块的导入是活绑定；界面换语言时整体重画）。
export let NO_COOKIE_BROWSERS: string = M.noBrowsers;
onLocaleChange(() => {
  NO_COOKIE_BROWSERS = M.noBrowsers;
});

/** 运行的结果里写明用上的浏览器。 */
export const usedCookieText = (id: LinkCookieBrowser): string => M.used(cookieBrowserLabel(id));
