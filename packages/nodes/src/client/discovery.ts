import { spawn, type ChildProcess } from 'node:child_process';
import { NODE_SERVICE_TYPE, type DiscoveredNode } from '@baocut/protocol';
import type { NodeLogger } from '../node-logger.ts';

/**
 * 发现（节点协议规范 §12）：浏览局域网里登记了 `_baocut-node._tcp` 的节点。结果只用于展示与预填地址，不构成信任：
 * 配对时以 `/v1/health` 与配对结果里的 `nodeId` 为准。
 *
 * macOS 用系统的 `dns-sd`：`-B` 浏览实例 → 每个实例 `-L` 解析出主机、端口与 TXT（`id=<nodeId>`）→ `-G v4` 取主机的
 * IPv4 地址。`dns-sd` 不会自己结束，所有子进程在期限到时一律杀掉；输出逐行解析，认不出的行跳过。其他平台返回空列表。
 * 测试注入假的 `Discoverer`，不碰真实的 mDNS。
 */

export interface Discoverer {
  /** 在 `timeoutMs` 内能发现的节点（期限到即返回）。 */
  discover(timeoutMs: number): Promise<DiscoveredNode[]>;
}

export const noDiscoverer: Discoverer = {
  async discover() {
    return [];
  },
};

// ---- 解析（输出格式见测试里抓取的样本） ----

const TIMESTAMP = String.raw`^\s*\d{1,2}:\d{2}:\d{2}\.\d{3}\s+`;
const TIMESTAMP_LINE = new RegExp(TIMESTAMP);
const BROWSE_LINE = new RegExp(String.raw`${TIMESTAMP}(Add|Rmv)\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(.+?)\s*$`);
const LOOKUP_LINE = new RegExp(String.raw`${TIMESTAMP}(.+?) can be reached at (.+?):(\d+)(?:\s|$)`);
const ADDRESS_LINE = new RegExp(String.raw`${TIMESTAMP}(Add|Rmv)\s+[0-9a-fA-F]+\s+\d+\s+(\S+)\s+(\S+)(.*)$`);

export interface BrowseEvent {
  action: 'add' | 'remove';
  /** 实例名（节点的名字），原样。 */
  name: string;
}

/** `dns-sd -B` 的一行 → 实例的出现或消失；不是本服务类型的行与表头返回 null。 */
export function parseBrowseLine(line: string): BrowseEvent | null {
  const match = BROWSE_LINE.exec(line);
  if (!match) return null;
  const [, action, , serviceType, name] = match;
  if (serviceType!.replace(/\.$/, '') !== NODE_SERVICE_TYPE) return null;
  return { action: action === 'Add' ? 'add' : 'remove', name: name! };
}

export interface LookupResult {
  host: string;
  port: number;
  txt: Record<string, string>;
}

/**
 * `dns-sd -L` 的输出 → 主机、端口与 TXT。主机去掉末尾的点；TXT 在 "can be reached at" 的下一行，
 * 以空格分隔的 `key=value`（`\ ` 是值里的空格）。还没有解析出来时返回 null。
 */
export function parseLookupOutput(output: string): LookupResult | null {
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = LOOKUP_LINE.exec(lines[i]!);
    if (!match) continue;
    const host = match[2]!.trim().replace(/\.$/, '');
    const port = Number(match[3]);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) continue;
    const txtLine = lines[i + 1];
    const txt: Record<string, string> = {};
    if (txtLine !== undefined && !TIMESTAMP_LINE.test(txtLine)) {
      for (const entry of txtLine.trim().split(/(?<!\\) +/)) {
        const eq = entry.indexOf('=');
        if (eq <= 0) continue;
        txt[entry.slice(0, eq)] = unescapeDnsSd(entry.slice(eq + 1));
      }
    }
    return { host, port, txt };
  }
  return null;
}

/** `dns-sd -G v4` 的输出 → 出现过的 IPv4 地址（按出现顺序去重；`No Such Record` 与 0.0.0.0 不算）。 */
export function parseAddressOutput(output: string): string[] {
  const addresses: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = ADDRESS_LINE.exec(line);
    if (!match || match[1] !== 'Add') continue;
    const address = match[3]!;
    if (/No Such Record/i.test(match[4] ?? '')) continue;
    if (!isIPv4(address) || address === '0.0.0.0') continue;
    if (!addresses.includes(address)) addresses.push(address);
  }
  return addresses;
}

/** 挑一个给别的机器连的地址：私网地址优先，其次其他地址；链路本地与回环最后（同一台机器上的节点只有回环）。 */
export function pickAddress(addresses: string[]): string | null {
  const rank = (address: string) => {
    if (address.startsWith('127.')) return 3;
    if (address.startsWith('169.254.')) return 2;
    return isPrivateIPv4(address) ? 0 : 1;
  };
  const sorted = addresses.filter((a) => isIPv4(a) && a !== '0.0.0.0').sort((a, b) => rank(a) - rank(b));
  return sorted[0] ?? null;
}

/** `dns-sd` 的转义：`\DDD` 是十进制字节，`\x` 是字符本身。 */
export function unescapeDnsSd(text: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      const digits = /^\d{3}/.exec(text.slice(i + 1));
      if (digits) {
        bytes.push(Number(digits[0]) & 0xff);
        i += 3;
        continue;
      }
      i += 1;
    }
    const code = text.codePointAt(i)!;
    const ch = String.fromCodePoint(code);
    bytes.push(...Buffer.from(ch, 'utf8'));
    i += ch.length - 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

function isIPv4(text: string): boolean {
  const parts = text.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// ---- macOS 的 dns-sd ----

/** 解析一个实例的地址时，第一个地址出现之后再等多久收集其他接口上的地址。 */
const ADDRESS_SETTLE_MS = 200;
const OUTPUT_LIMIT = 1024 * 1024;

interface RunControl {
  stop(): void;
  /** 再等 `ms` 收集输出，然后叫停。 */
  stopAfter(ms: number): void;
}

export class DnsSdDiscoverer implements Discoverer {
  readonly #command: string;
  readonly #log: NodeLogger | undefined;

  constructor(options: { command?: string; log?: NodeLogger } = {}) {
    this.#command = options.command ?? 'dns-sd';
    this.#log = options.log;
  }

  async discover(timeoutMs: number): Promise<DiscoveredNode[]> {
    const deadline = Date.now() + timeoutMs;
    const children = new Set<ChildProcess>();
    const found = new Map<string, DiscoveredNode>();
    const resolving = new Map<string, Promise<void>>();

    /** 跑一个 `dns-sd`，直到 `onOutput` 叫停、进程退出或期限到；之后一律杀掉。 */
    const run = (args: string[], onOutput: (all: string, control: RunControl) => void): Promise<void> =>
      new Promise((resolve) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          resolve();
          return;
        }
        let child: ChildProcess;
        try {
          child = spawn(this.#command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
        } catch {
          resolve();
          return;
        }
        children.add(child);
        let output = '';
        let done = false;
        const timers: Array<ReturnType<typeof setTimeout>> = [];
        const stop = () => {
          if (done) return;
          done = true;
          for (const timer of timers) clearTimeout(timer);
          children.delete(child);
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          resolve();
        };
        timers.push(setTimeout(stop, remaining));
        const control: RunControl = { stop, stopAfter: (ms) => timers.push(setTimeout(stop, ms)) };
        child.on('error', (error) => {
          this.#log?.warn('mDNS browse failed', { error: String(error) });
          stop();
        });
        child.on('exit', stop);
        child.stdout!.setEncoding('utf8');
        child.stdout!.on('data', (chunk: string) => {
          if (done) return;
          // 防御：异常大的输出不再累积。
          if (output.length < OUTPUT_LIMIT) output += chunk;
          onOutput(output, control);
        });
      });

    const resolveInstance = async (name: string) => {
      let lookup: LookupResult | null = null;
      await run(['-L', name, NODE_SERVICE_TYPE, 'local'], (all, control) => {
        lookup = parseLookupOutput(all);
        if (lookup) control.stop();
      });
      const result = lookup as LookupResult | null;
      if (!result) return;
      let addresses: string[] = [];
      let settling = false;
      await run(['-G', 'v4', result.host], (all, control) => {
        addresses = parseAddressOutput(all);
        if (addresses.length > 0 && !settling) {
          settling = true;
          control.stopAfter(ADDRESS_SETTLE_MS);
        }
      });
      const host = pickAddress(addresses) ?? result.host;
      const id = result.txt.id;
      const nodeId = id && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
      found.set(name, { name, host, port: result.port, nodeId });
    };

    try {
      await run(['-B', NODE_SERVICE_TYPE, 'local'], (all) => {
        for (const line of all.split(/\r?\n/)) {
          const event = parseBrowseLine(line);
          if (event?.action === 'add' && !resolving.has(event.name)) resolving.set(event.name, resolveInstance(event.name));
        }
      });
      await Promise.all(resolving.values());
    } finally {
      for (const child of children) child.kill('SIGKILL');
    }
    return dedupe([...found.values()]);
  }
}

/** 同一个节点可能在多个接口上出现：按 `nodeId`（没有时按名字）去重。 */
function dedupe(nodes: DiscoveredNode[]): DiscoveredNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = node.nodeId ?? `name:${node.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 本平台的默认发现方式：macOS 用 `dns-sd`，其他平台不浏览。 */
export function defaultDiscoverer(platform: NodeJS.Platform = process.platform, log?: NodeLogger): Discoverer {
  return platform === 'darwin' ? new DnsSdDiscoverer(log ? { log } : {}) : noDiscoverer;
}
