import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DnsSdDiscoverer,
  defaultDiscoverer,
  noDiscoverer,
  parseAddressOutput,
  parseBrowseLine,
  parseLookupOutput,
  pickAddress,
  unescapeDnsSd,
} from './discovery.ts';

/**
 * 解析器对着在 macOS 上抓取的 `dns-sd` 输出样本；`DnsSdDiscoverer` 对着一个回放这些样本、之后一直不退出的假命令
 * （真实的 `dns-sd` 也不会自己退出），不碰真实的 mDNS。
 */

const BROWSE_SAMPLE = `Browsing for _baocut-node._tcp.local
DATE: ---Sat 03 Oct 2026---
 0:39:03.316  ...STARTING...
Timestamp     A/R    Flags  if Domain               Service Type         Instance Name
 0:39:03.318  Add        2   7 local.               _baocut-node._tcp.   Probe Node 1
 0:39:03.319  Add        3  14 local.               _baocut-node._tcp.   Edit Bay  (2)
 0:39:03.320  Add        2   7 local.               _other._tcp.         Not Ours
 0:39:04.100  Rmv        0   7 local.               _baocut-node._tcp.   Gone Node
`;

const LOOKUP_SAMPLE = String.raw`Lookup Probe Node 1._baocut-node._tcp.local
DATE: ---Sat 03 Oct 2026---
 0:39:05.328  ...STARTING...
 0:39:05.329  Probe\032Node\0321._baocut-node._tcp.local. can be reached at Junmins-Mac-mini.local.:47999 (interface 7)
 id=node_probe v=1
`;

const ADDRESS_SAMPLE = `DATE: ---Sat 03 Oct 2026---
 0:39:07.351  ...STARTING...
Timestamp     A/R  Flags         IF  Hostname                               Address                                      TTL
 0:39:07.352  Add  40000003      14  Junmins-Mac-mini.local.                10.0.0.243                                   4500
 0:39:07.352  Add  40000003       7  Junmins-Mac-mini.local.                127.0.0.1                                    4500
 0:39:07.352  Add  40000003       7  Junmins-Mac-mini.local.                10.0.0.243                                   4500
 0:39:07.352  Add  40000003       7  Junmins-Mac-mini.local.                0.0.0.0                                      1   No Such Record
 0:39:07.352  Add  40000002       7  Junmins-Mac-mini.local.                169.254.71.144                               4500
`;

describe('dns-sd 输出的解析', () => {
  it('浏览：本服务类型的实例出现与消失；实例名可以含空格与括号', () => {
    const events = BROWSE_SAMPLE.split('\n').map(parseBrowseLine).filter(Boolean);
    expect(events).toEqual([
      { action: 'add', name: 'Probe Node 1' },
      { action: 'add', name: 'Edit Bay  (2)' },
      { action: 'remove', name: 'Gone Node' },
    ]);
    expect(parseBrowseLine('garbage')).toBeNull();
    expect(parseBrowseLine('')).toBeNull();
  });

  it('解析实例：主机去掉末尾的点，端口，TXT 的 id 与 v', () => {
    expect(parseLookupOutput(LOOKUP_SAMPLE)).toEqual({ host: 'Junmins-Mac-mini.local', port: 47999, txt: { id: 'node_probe', v: '1' } });
    // 还没有输出到那一行
    expect(parseLookupOutput(LOOKUP_SAMPLE.split('\n').slice(0, 3).join('\n'))).toBeNull();
    // TXT 还没到：先给出主机与端口
    expect(parseLookupOutput(LOOKUP_SAMPLE.split('\n').slice(0, 4).join('\n'))).toEqual({
      host: 'Junmins-Mac-mini.local',
      port: 47999,
      txt: {},
    });
    expect(parseLookupOutput(' 0:00:00.000  x can be reached at host.local.:99999 (interface 1)')).toBeNull();
  });

  it('地址：Add 行的 IPv4，去重，跳过 No Such Record 与 0.0.0.0；挑选时私网优先，回环与链路本地最后', () => {
    const addresses = parseAddressOutput(ADDRESS_SAMPLE);
    expect(addresses).toEqual(['10.0.0.243', '127.0.0.1', '169.254.71.144']);
    expect(pickAddress(addresses)).toBe('10.0.0.243');
    expect(pickAddress(['127.0.0.1', '169.254.1.1'])).toBe('169.254.1.1');
    expect(pickAddress(['127.0.0.1'])).toBe('127.0.0.1');
    expect(pickAddress(['8.8.8.8', '192.168.1.5'])).toBe('192.168.1.5');
    expect(pickAddress([])).toBeNull();
  });

  it('转义：\\DDD 是十进制字节（UTF-8 可以跨多个转义），\\x 是字符本身', () => {
    expect(unescapeDnsSd(String.raw`Probe\032Node\0321`)).toBe('Probe Node 1');
    expect(unescapeDnsSd(String.raw`a\.b\\c`)).toBe('a.b\\c');
    expect(unescapeDnsSd(String.raw`\229\174\157`)).toBe('宝');
  });
});

describe('DnsSdDiscoverer', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  /** 假的 dns-sd：按参数回放样本，然后不退出；每个进程把 pid 记到目录里。 */
  async function fakeDnsSd(): Promise<{ command: string; pids: () => Promise<number[]> }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-dnssd-'));
    dirs.push(dir);
    const samples = { browse: BROWSE_SAMPLE, lookup: LOOKUP_SAMPLE, address: ADDRESS_SAMPLE };
    const script = path.join(dir, 'fake-dns-sd.mjs');
    await fs.writeFile(
      script,
      `import fs from 'node:fs';
const samples = ${JSON.stringify(samples)};
fs.writeFileSync(${JSON.stringify(dir)} + '/pid-' + process.pid, '');
const [flag, name] = process.argv.slice(2);
if (flag === '-B') process.stdout.write(samples.browse);
else if (flag === '-L') process.stdout.write(name === 'Probe Node 1' ? samples.lookup : samples.lookup.replace('id=node_probe', 'id=node_bay').replace('47999', '47611'));
else if (flag === '-G') process.stdout.write(samples.address);
setInterval(() => {}, 1000);
`,
    );
    const command = path.join(dir, 'dns-sd');
    await fs.writeFile(command, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
    return {
      command,
      pids: async () => (await fs.readdir(dir)).filter((f) => f.startsWith('pid-')).map((f) => Number(f.slice(4))),
    };
  }

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('浏览 → 解析 → 取地址，期限到即返回，子进程全部结束', async () => {
    const fake = await fakeDnsSd();
    const started = Date.now();
    const nodes = await new DnsSdDiscoverer({ command: fake.command }).discover(1_500);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(nodes.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Edit Bay  (2)', host: '10.0.0.243', port: 47611, nodeId: 'node_bay' },
      { name: 'Probe Node 1', host: '10.0.0.243', port: 47999, nodeId: 'node_probe' },
    ]);
    const pids = await fake.pids();
    expect(pids.length).toBe(5);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const pid of pids) expect(alive(pid)).toBe(false);
  });

  it('命令不存在：空列表', async () => {
    expect(await new DnsSdDiscoverer({ command: '/nonexistent/dns-sd' }).discover(300)).toEqual([]);
  });

  it('非 macOS 不浏览', async () => {
    expect(defaultDiscoverer('linux')).toBe(noDiscoverer);
    expect(await noDiscoverer.discover(100)).toEqual([]);
  });
});
