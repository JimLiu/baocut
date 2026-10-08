import dns from 'node:dns';
import net from 'node:net';
import { RpcError, type Localized } from '@baocut/protocol';
import { JobsLinkUrl } from '@baocut/protocol/messages/jobs/link-url.ts';

/**
 * 从链接导入的链接检查与脱敏（架构设计 §7.9）。
 *
 * 检查：只接受 `http(s)://`；不接受带用户名或密码的链接；主机不能是本机、链路本地或内网地址（字面的 IP、`localhost`、
 * `.local` 之类的本地名字、没有点的单段主机名），提交时再把主机名解析一遍，任何一个地址落在这些范围里就拒绝。
 * 这些检查管不到的（下载工具自己再解析一次之间的 DNS 变化、跟随的重定向、提取器另外请求的接口与 CDN 地址）记在 §7.9。
 *
 * 脱敏：存储与日志里只出现规范化之后的链接：去掉片段，查询参数只留下标识内容的那几个（`v`、`list`、`index`、`t`、`start`、
 * `p`、`page`、`id`、`bvid`、`aid`），其余（跟踪参数、签名、令牌）一律去掉；路径原样保留。规范化改变了链接时，原始链接只
 * 存在 Runtime Home 的一个 0600 文件里（`LinkSources`），按摘要引用，流程完成时删除。
 */

/** 脱敏之后保留的查询参数。 */
export const KEPT_QUERY_KEYS: ReadonlySet<string> = new Set(['v', 'list', 'index', 't', 'start', 'p', 'page', 'id', 'bvid', 'aid']);

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

export interface CheckedLink {
  /** 原样的链接（只在内存里与 `LinkSources` 里）。 */
  raw: string;
  /** 规范化、脱敏之后的链接：存储、日志、来源都用它。 */
  canonical: string;
  host: string;
}

function linkError(code: string, message: Localized): RpcError {
  return new RpcError('invalid-request', message, { code });
}

/** 校验并规范化链接。不合时 `invalid-request`（`LINK_UNSUPPORTED`、`LINK_PRIVATE_ADDRESS`）。 */
export function checkLink(input: string): CheckedLink {
  const raw = input.trim();
  if (raw.startsWith('-')) throw linkError('LINK_UNSUPPORTED', JobsLinkUrl.startsWithDash());
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw linkError('LINK_UNSUPPORTED', JobsLinkUrl.invalidLink());
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw linkError('LINK_UNSUPPORTED', JobsLinkUrl.httpOnly());
  if (url.username || url.password) throw linkError('LINK_UNSUPPORTED', JobsLinkUrl.credentials());
  const host = hostOf(url);
  if (!host) throw linkError('LINK_UNSUPPORTED', JobsLinkUrl.noHost());
  if (isPrivateHost(host)) throw linkError('LINK_PRIVATE_ADDRESS', JobsLinkUrl.privateAddress());
  return { raw, canonical: redactUrl(url), host };
}

/** URL 里的主机：IPv6 去掉方括号，域名去掉结尾的点、转小写。 */
function hostOf(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host.replace(/\.$/, '');
}

/** 规范化：去掉凭据与片段，只留下标识内容的查询参数（按名字排序）。 */
export function redactUrl(input: URL | string): string {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : new URL(input.href);
  } catch {
    return JobsLinkUrl.redacted().text;
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  const kept = [...url.searchParams.entries()].filter(([key]) => KEPT_QUERY_KEYS.has(key));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = kept.length > 0 ? `?${new URLSearchParams(kept).toString()}` : '';
  return url.href;
}

/** 一段文本（工具的报错）里的每个 http(s) 链接都换成脱敏之后的写法。 */
export function redactUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s'"<>]+/gi, (match) => redactUrl(match));
}

/** 主机名本身就指向本机或内网：字面的私有地址、`localhost`、本地后缀、没有点的单段名字。 */
export function isPrivateHost(host: string): boolean {
  if (net.isIP(host)) return isPrivateAddress(host);
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return !host.includes('.');
}

/** 本机、链路本地、私有、共享、保留、组播地址（IPv4 与 IPv6，含 IPv4 映射与 NAT64 的写法）。 */
export function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version !== 6) return true;
  const lower = address.toLowerCase();
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateV4(mapped[1]!);
  const words = expandV6(lower);
  if (!words) return true;
  if (words.every((w) => w === 0)) return true; // ::
  if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true; // ::1
  if (words[0]! === 0 && words[1]! === 0 && words[2]! === 0 && words[3]! === 0 && words[4]! === 0 && words[5]! === 0xffff) {
    return isPrivateV4(`${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`);
  }
  if (words[0]! === 0x64 && words[1]! === 0xff9b) {
    return isPrivateV4(`${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`);
  }
  const first = words[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 站点本地（已废弃）
  if ((first & 0xff00) === 0xff00) return true; // 组播
  if (first === 0x2001 && words[1]! === 0x0db8) return true; // 文档用
  return false;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function expandV6(address: string): number[] | null {
  const zone = address.indexOf('%');
  const bare = zone >= 0 ? address.slice(0, zone) : address;
  const [head, tail, extra] = bare.split('::');
  if (extra !== undefined) return null;
  const parse = (part: string | undefined) => (part ? part.split(':').map((h) => Number.parseInt(h, 16)) : []);
  const front = parse(head);
  const back = tail === undefined ? [] : parse(tail);
  const fill = tail === undefined ? 0 : 8 - front.length - back.length;
  const words = [...front, ...Array<number>(Math.max(0, fill)).fill(0), ...back];
  if (words.length !== 8 || words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return null;
  return words;
}

/** 把主机名解析成全部地址（默认用系统的解析器）。 */
export type HostLookup = (host: string) => Promise<string[]>;

export const systemLookup: HostLookup = async (host) =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * 提交时解析主机名：任何一个地址是本机或内网就拒绝（`LINK_PRIVATE_ADDRESS`）；解析不了是 `LINK_NETWORK_ERROR`。
 * 字面的 IP 不再解析。
 */
export async function checkResolvedHost(host: string, lookup: HostLookup): Promise<void> {
  if (net.isIP(host)) return;
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new RpcError('conflict', JobsLinkUrl.unresolvable({ host }), { code: 'LINK_NETWORK_ERROR' });
  }
  if (addresses.length === 0) throw new RpcError('conflict', JobsLinkUrl.noAddresses({ host }), { code: 'LINK_NETWORK_ERROR' });
  if (addresses.some(isPrivateAddress)) {
    throw linkError('LINK_PRIVATE_ADDRESS', JobsLinkUrl.resolvesPrivate({ host }));
  }
}
