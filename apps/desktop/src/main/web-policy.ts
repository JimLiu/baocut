/**
 * 网页标签的规则（架构设计 §12.10）：哪些地址能打开、哪些请求要拦、缩放档位、渲染进程传来的参数怎么校验。
 * 纯逻辑，不引 electron，可以单测；接 Electron 的部分在 web-tabs.ts。
 */

/** 被拒绝的原因：不是网址、不是 http/https、本机回环地址、应用自己的页面。 */
export type WebBlockReason = 'invalid' | 'scheme' | 'loopback' | 'app-origin';

export type WebUrlCheck = { ok: true; url: string } | { ok: false; reason: WebBlockReason };

export interface WebUrlOptions {
  /** 应用自己的来源（开发时的渲染服务器）。 */
  appOrigins?: readonly string[];
  /** 允许回环地址：只给界面主动「在浏览器中打开」用，网页里发起的一律不允许。 */
  allowLoopback?: boolean;
}

/**
 * 本机回环地址：localhost（含 `*.localhost`）、127.0.0.0/8、0.0.0.0、[::1]、[::]，以及映射到它们的 IPv6 写法。
 * 传入的是 `URL.hostname`：URL 解析已经把 `127.1`、`0x7f.0.0.1`、`2130706433` 这类写法规范成 `127.0.0.1`。
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host === '0.0.0.0') return true;
  if (!host.startsWith('[')) return false;
  const v6 = host.slice(1, -1);
  // `::ffff:127.0.0.1` 规范化之后是 `::ffff:7f00:1`；`::127.0.0.1`（已废弃的兼容写法）是 `::7f00:1`。
  return v6 === '::1' || v6 === '::' || v6 === '::ffff:0:0' || /^::(ffff:)?7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(v6);
}

/** 去掉账号密码之后的网址。 */
function withoutCredentials(url: URL): string {
  url.username = '';
  url.password = '';
  return url.href;
}

/** 网页标签能不能打开这个地址：只允许 http/https，拒绝回环地址与应用自己的页面，去掉账号密码。 */
export function checkWebUrl(raw: unknown, options: WebUrlOptions = {}): WebUrlCheck {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) return { ok: false, reason: 'invalid' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (!url.hostname) return { ok: false, reason: 'invalid' };
  if (options.appOrigins?.includes(url.origin)) return { ok: false, reason: 'app-origin' };
  if (!options.allowLoopback && isLoopbackHost(url.hostname)) return { ok: false, reason: 'loopback' };
  return { ok: true, url: withoutCredentials(url) };
}

/**
 * 网页分区里的每个请求（含子框架、图片、脚本、WebSocket）：网络请求按 `checkWebUrl` 判；
 * `data:`、`blob:`、`about:` 这类不出网的放行；`file:` 与其它协议一律拦下。
 */
export function isRequestAllowed(raw: string, appOrigins: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      return checkWebUrl(raw, { appOrigins }).ok;
    case 'ws:':
    case 'wss:':
      return !isLoopbackHost(url.hostname) && !appOrigins.includes(url.origin.replace(/^ws/, 'http'));
    case 'data:':
    case 'blob:':
    case 'about:':
      return true;
    default:
      return false;
  }
}

/** 缩放档位（百分比），与设计稿一致；区间 50–200。 */
export const WEB_ZOOM_MIN = 50;
export const WEB_ZOOM_MAX = 200;

/** 把渲染进程给的缩放百分比收进区间；不是有限数返回 null。 */
export function clampZoom(percent: unknown): number | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  return Math.min(WEB_ZOOM_MAX, Math.max(WEB_ZOOM_MIN, Math.round(percent)));
}

export interface WebBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_COORD = 100_000;

/** 网页视图在窗口里的矩形：四个有限数；取整（Electron 不收小数）；宽高不能为负。 */
export function parseBounds(raw: unknown): WebBounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, width, height } = raw as Record<string, unknown>;
  const values = [x, y, width, height];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD)) return null;
  const [rx, ry, rw, rh] = (values as number[]).map(Math.round) as [number, number, number, number];
  if (rw < 0 || rh < 0) return null;
  return { x: rx, y: ry, width: rw, height: rh };
}

/** 网页标签的 id 由主进程生成；渲染进程传回来的先看外形。 */
export function isWebTabId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^web_[A-Za-z0-9_-]{1,60}$/.test(raw);
}

export function parseDeviceSize(raw: unknown): { width: number; height: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { width, height } = raw as Record<string, unknown>;
  if (![width, height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 240 && n <= 4096)) return null;
  return { width: Math.round(width as number), height: Math.round(height as number) };
}

export function parseFindRequest(raw: unknown): { query: string; forward: boolean; next: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { query, forward, next } = raw as Record<string, unknown>;
  if (typeof query !== 'string' || !query || query.length > 4096 || query.includes('\0')) return null;
  return { query, forward: forward !== false, next: next === true };
}

export function nativeWebShortcut(input: { key: string; code?: string; meta: boolean; control: boolean; alt: boolean; shift: boolean }, mac: boolean) {
  if (input.alt || (mac ? !input.meta || input.control : !input.control || input.meta)) return null;
  const key = (input.code?.startsWith('Key') ? input.code.slice(3) : input.key).toLowerCase();
  if (key === 'r') return input.shift ? 'force-reload' as const : 'reload' as const;
  if (input.shift) return null;
  return key === 'l' ? 'focus-address' as const : key === 'f' ? 'find' as const : null;
}

/**
 * 网页标签用的 User-Agent：去掉 Electron 与应用名，免得网站按「不是浏览器」区别对待。
 * `… (KHTML, like Gecko) BaoCut/0.1.0 Chrome/140.0 Electron/44.5.1 Safari/537.36` → `… (KHTML, like Gecko) Chrome/140.0 Safari/537.36`
 */
export function browserUserAgent(ua: string): string {
  return ua.replace(/(\(KHTML, like Gecko\)) (?:\S+ )*?(Chrome\/)/, '$1 $2').replace(/ Electron\/\S+/, '');
}

/** 网页弹窗交给系统浏览器的节流：同一个标签一段时间内只放一次，挡住连续弹窗。 */
export class OpenThrottle {
  readonly #intervalMs: number;
  readonly #last = new Map<string, number>();

  constructor(intervalMs = 1000) {
    this.#intervalMs = intervalMs;
  }

  allow(key: string, now: number): boolean {
    const last = this.#last.get(key);
    if (last !== undefined && now - last < this.#intervalMs) return false;
    this.#last.set(key, now);
    return true;
  }

  forget(key: string): void {
    this.#last.delete(key);
  }
}
