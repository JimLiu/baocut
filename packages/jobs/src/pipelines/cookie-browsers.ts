import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CookieBrowserInfo, LinkCookieBrowser } from '@baocut/protocol';

/**
 * 这台机器上哪些浏览器有 Cookie 库（`externalTools.cookieBrowsers`，架构设计 §7.9）：下载视频的「网站登录」只列出这些，
 * 不让用户选一个没装的浏览器。
 *
 * - 位置按 yt-dlp 读 `--cookies-from-browser` 时的查找规则：Chromium 系是数据目录下 `[<Profile>/][Network/]Cookies`，
 *   Firefox 是配置根下 `[<Profile>/|Profiles/<Profile>/]cookies.sqlite`，Safari（只有 macOS）是固定位置的
 *   `Cookies.binarycookies`。找不到库的浏览器不列出：yt-dlp 同样找不到它。
 * - 只看文件在不在与修改时间（`stat` 与列出数据目录的直接子目录），不打开、不读 Cookie，不运行下载工具。
 * - 最近改过的排在前面（最近在用的浏览器最可能登录着目标网站），下载按这个顺序逐个尝试；时间相同或读不到时按固定顺序。
 */

export const COOKIE_BROWSER_LABELS: Readonly<Record<LinkCookieBrowser, string>> = {
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

/** 去哪里找：探测用的主机信息。测试传一棵临时目录树。 */
export interface CookieHost {
  platform: NodeJS.Platform;
  home: string | null;
  env: { LOCALAPPDATA?: string | undefined; APPDATA?: string | undefined; XDG_CONFIG_HOME?: string | undefined };
}

/** 一个浏览器的 Cookie 库的查找规则：Chromium 系的数据目录、Firefox 的配置根，或固定的文件。 */
export interface CookieDatabaseRule {
  id: LinkCookieBrowser;
  chromium?: string;
  firefox?: string[];
  files?: string[];
}

export function currentCookieHost(): CookieHost {
  return { platform: process.platform, home: os.homedir() || null, env: process.env };
}

/** 各平台的查找规则，顺序就是时间相同时的顺序。纯函数：只拼路径，不碰文件。 */
export function cookieDatabaseRules(host: CookieHost): CookieDatabaseRule[] {
  const { home, env } = host;
  const at = (base: string | null | undefined, ...segments: string[]) => (base ? path.join(base, ...segments) : undefined);
  const rules: CookieDatabaseRule[] = [];
  const chromium = (id: LinkCookieBrowser, dir: string | undefined) => {
    if (dir) rules.push({ id, chromium: dir });
  };
  const firefox = (roots: Array<string | undefined>) => {
    const found = roots.filter((r): r is string => !!r);
    if (found.length > 0) rules.push({ id: 'firefox', firefox: found });
  };
  if (host.platform === 'darwin') {
    const support = at(home, 'Library', 'Application Support');
    chromium('chrome', at(support, 'Google', 'Chrome'));
    chromium('edge', at(support, 'Microsoft Edge'));
    firefox([at(support, 'Firefox', 'Profiles')]);
    if (home) {
      rules.push({
        id: 'safari',
        files: [
          path.join(home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies', 'Cookies.binarycookies'),
          path.join(home, 'Library', 'Cookies', 'Cookies.binarycookies'),
        ],
      });
    }
    chromium('brave', at(support, 'BraveSoftware', 'Brave-Browser'));
    chromium('chromium', at(support, 'Chromium'));
    chromium('opera', at(support, 'com.operasoftware.Opera'));
    chromium('vivaldi', at(support, 'Vivaldi'));
    chromium('whale', at(support, 'Naver', 'Whale'));
  } else if (host.platform === 'win32') {
    const local = env.LOCALAPPDATA || undefined;
    const roaming = env.APPDATA || undefined;
    chromium('chrome', at(local, 'Google', 'Chrome', 'User Data'));
    chromium('edge', at(local, 'Microsoft', 'Edge', 'User Data'));
    firefox([
      at(roaming, 'Mozilla', 'Firefox', 'Profiles'),
      at(local, 'Packages', 'Mozilla.Firefox_n80bbvh6b1yt2', 'LocalCache', 'Roaming', 'Mozilla', 'Firefox', 'Profiles'),
    ]);
    chromium('brave', at(local, 'BraveSoftware', 'Brave-Browser', 'User Data'));
    chromium('chromium', at(local, 'Chromium', 'User Data'));
    chromium('opera', at(roaming, 'Opera Software', 'Opera Stable'));
    chromium('vivaldi', at(local, 'Vivaldi', 'User Data'));
    chromium('whale', at(local, 'Naver', 'Naver Whale', 'User Data'));
  } else {
    const config = env.XDG_CONFIG_HOME || at(home, '.config');
    chromium('chrome', at(config, 'google-chrome'));
    chromium('edge', at(config, 'microsoft-edge'));
    firefox([
      at(config, 'mozilla', 'firefox'),
      at(home, '.mozilla', 'firefox'),
      at(home, '.var', 'app', 'org.mozilla.firefox', 'config', 'mozilla', 'firefox'),
      at(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
      at(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
    ]);
    chromium('brave', at(config, 'BraveSoftware', 'Brave-Browser'));
    chromium('chromium', at(config, 'chromium'));
    chromium('opera', at(config, 'opera'));
    chromium('vivaldi', at(config, 'vivaldi'));
    chromium('whale', at(config, 'naver-whale'));
  }
  return rules;
}

/** 这台机器上找得到 Cookie 库的浏览器，最近改过的在前。 */
export async function detectCookieBrowsers(host: CookieHost = currentCookieHost()): Promise<CookieBrowserInfo[]> {
  const rules = cookieDatabaseRules(host);
  const found = await Promise.all(rules.map(async (rule, order) => ({ rule, order, seen: await lastChange(rule) })));
  return found
    .filter((f) => f.seen !== undefined)
    .sort((a, b) => (b.seen ?? -Infinity) - (a.seen ?? -Infinity) || a.order - b.order)
    .map(({ rule, seen }) => ({
      id: rule.id,
      label: COOKIE_BROWSER_LABELS[rule.id],
      lastUsedAt: seen === null || seen === undefined ? null : new Date(seen).toISOString(),
    }));
}

/**
 * 这条规则下 Cookie 库最近的修改时间（毫秒）：找不到库时 undefined；固定位置的文件在、但没有权限看（macOS 的 Safari 要
 * 「完全磁盘访问权限」）时 null——库在，只是不知道时间。
 */
async function lastChange(rule: CookieDatabaseRule): Promise<number | null | undefined> {
  const candidates: string[] = [];
  if (rule.chromium) {
    for (const base of [rule.chromium, ...(await childDirectories(rule.chromium))]) {
      candidates.push(path.join(base, 'Cookies'), path.join(base, 'Network', 'Cookies'));
    }
  }
  for (const root of rule.firefox ?? []) {
    for (const base of [root, ...(await childDirectories(root)), ...(await childDirectories(path.join(root, 'Profiles')))]) {
      candidates.push(path.join(base, 'cookies.sqlite'));
    }
  }
  let newest: number | null | undefined;
  for (const file of [...candidates, ...(rule.files ?? [])]) {
    const denied = (error: NodeJS.ErrnoException) => (error.code === 'EPERM' || error.code === 'EACCES') && !!rule.files?.includes(file);
    const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => (denied(error) ? null : undefined));
    if (stat === null) newest ??= null;
    else if (stat?.isFile()) newest = Math.max(newest ?? -Infinity, stat.mtimeMs);
  }
  return newest;
}

async function childDirectories(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)).sort();
}
