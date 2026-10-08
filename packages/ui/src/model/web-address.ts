import { safeUrl } from './workspace.ts';

/**
 * 网页标签的地址栏与缩放（产品设计 §3.3；移植自设计稿 model-home-browser.js）。
 */

/** 不是网址的输入走这个搜索（设计稿：Google）。 */
export const WEB_SEARCH_URL = 'https://www.google.com/search?q=';

/**
 * 地址栏的输入 → 要打开的网址。像主机名（`a.b`、`localhost`、`[::1]`，可带端口）或带协议的按网址处理，
 * 不合规矩（非 http/https、带账号密码）返回 null；其余当搜索词。空输入返回 null。
 */
export function resolveAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const host = /^(localhost|\[[\da-f:]+\]|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#]|$)/i.test(text);
  if (host || /^[a-z][a-z\d+.-]*:/i.test(text)) return safeUrl(text);
  return WEB_SEARCH_URL + encodeURIComponent(text);
}

/** 地址栏静止时显示的网址：主机 + 路径（根路径省略）+ 查询 + 片段，不显示协议。 */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
  } catch {
    return '';
  }
}

/** 缩放档位（百分比）：50–200。 */
export const WEB_ZOOM_STEPS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200] as const;

/** 放大（delta > 0）或缩小一档；当前值不在档位上时取最近的下一档。到头不动。 */
export function zoomStep(current: number, delta: 1 | -1): number {
  const steps: readonly number[] = WEB_ZOOM_STEPS;
  if (delta > 0) return steps.find((s) => s > current) ?? steps.at(-1)!;
  return [...steps].reverse().find((s) => s < current) ?? steps[0]!;
}

/** 网页加载多久算「较慢」。 */
export const WEB_SLOW_MS = 15_000;

export interface WebKeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * 网页标签的快捷键（原型 home-browser.jsx）：⌘L 聚焦地址栏，⌘R 重新加载；Windows 与 Linux 用 Ctrl。
 * 字母按物理键（`code`）判断，输入法改写 `key` 时也认得出。
 */
export function webShortcut(event: WebKeyLike, mac: boolean): 'focus-address' | 'reload' | 'force-reload' | 'find' | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey) return null;
  const letter = event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  if (letter === 'r') return event.shiftKey ? 'force-reload' : 'reload';
  if (event.shiftKey) return null;
  if (letter === 'f') return 'find';
  if (letter === 'l') return 'focus-address';
  return null;
}

export interface DeviceSize { width: number; height: number }
export const DEVICE_PRESETS = { phone: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, laptop: { width: 1440, height: 900 } };
export function deviceFrame(size: DeviceSize, available: DeviceSize): DeviceSize {
  const scale = Math.max(0, Math.min(1, (available.width - 32) / size.width, (available.height - 32) / size.height));
  return { width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) };
}
