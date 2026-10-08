import net from 'node:net';

/**
 * 来源门（节点协议规范 §2）：只看套接字的对端地址，不读任何转发头。
 *
 * 默认允许：回环（`127/8`、`::1`）、私有网段（`10/8`、`172.16/12`、`192.168/16`）、链路本地（`169.254/16`、`fe80::/10`）、
 * 唯一本地（`fc00::/7`）。`::ffff:a.b.c.d`（IPv4 映射）按其中的 IPv4 判断。其余一律不允许；`allowAnySource` 打开时跳过。
 * 地址缺失或不是合法的 IP（套接字已经断开）时不允许。
 */
export function sourceAllowed(remoteAddress: string | undefined | null, allowAnySource = false): boolean {
  if (allowAnySource) return true;
  if (!remoteAddress) return false;
  // 链路本地地址可能带作用域：`fe80::1%en0`。
  const address = remoteAddress.split('%')[0]!;
  const family = net.isIP(address);
  if (family === 4) return ipv4Allowed(address);
  if (family === 6) return ipv6Allowed(address);
  return false;
}

function ipv4Allowed(address: string): boolean {
  const octets = address.split('.').map(Number);
  const [a, b] = octets as [number, number, number, number];
  if (a === 127) return true; // 回环 127/8
  if (a === 10) return true; // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 链路本地 169.254/16
  return false;
}

function ipv6Allowed(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return false;
  // 回环 ::1
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  // IPv4 映射 ::ffff:a.b.c.d
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const hi = groups[6]!;
    const lo = groups[7]!;
    return ipv4Allowed(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  const first = groups[0]!;
  if ((first & 0xffc0) === 0xfe80) return true; // 链路本地 fe80::/10
  if ((first & 0xfe00) === 0xfc00) return true; // 唯一本地 fc00::/7
  return false;
}

/** 把合法的 IPv6 文本展开成 8 个 16 位整数；末尾可以是点分的 IPv4。 */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    // 末尾的点分 IPv4 换成两组十六进制：`::ffff:1.2.3.4` → `::ffff:102:304`。
    if (net.isIP(last) !== 4) return null;
    const [a, b, c, d] = last.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parse = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  let groups: number[];
  if (text.includes('::')) {
    const halves = text.split('::');
    if (halves.length !== 2) return null;
    const left = parse(halves[0]!);
    const right = parse(halves[1]!);
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    groups = parse(text);
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}
