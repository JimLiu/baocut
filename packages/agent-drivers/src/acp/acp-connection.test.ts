import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@agentclientprotocol/sdk';
import { silentLogger } from '@baocut/harness';
import { createFakeAcp, type FakeAcp } from '../testing/fake-acp.ts';
import { AcpProcess } from './acp-connection.ts';

/**
 * 智能体进程结束时，它派生的进程一起结束（POSIX 上是整个进程组）。假智能体按 `helper` 场景派生一个不理会 SIGTERM 的子进程，
 * 像 cursor-agent 启动时跑的 rg：只结束智能体本身的话，它留成孤儿。
 */

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe.skipIf(process.platform === 'win32')('AcpProcess 结束时不留下智能体派生的进程', () => {
  let dir: string;
  let fake: FakeAcp;
  const open: AcpProcess[] = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-acp-process-'));
    fake = await createFakeAcp(path.join(dir, 'fake'), { helper: true });
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((proc) => proc.close()));
    // 断言失败时也不留下测试自己的进程。
    for (const pid of helpers()) if (alive(pid)) process.kill(pid, 'SIGKILL');
    await fs.rm(dir, { recursive: true, force: true });
  });

  const helpers = () => fake.log().flatMap((e) => (e.kind === 'start' && e.helper ? [e.helper] : []));

  async function start(): Promise<AcpProcess> {
    const install = (await fake.locate())!;
    const proc = await AcpProcess.start({
      command: install.command,
      args: ['acp'],
      cwd: dir,
      env: install.env,
      log: silentLogger,
      label: 'Fake',
      client: {} as Client,
    });
    open.push(proc);
    return proc;
  }

  it('关闭：SIGTERM 之后还在的派生进程被强杀，close 等到它们都退出', async () => {
    const proc = await start();
    const [helper] = helpers();
    expect(alive(helper!)).toBe(true);

    await proc.close();
    expect(alive(helper!)).toBe(false);
    expect(alive(proc.child.pid!)).toBe(false);
  });

  it('智能体自己退出：它留下的进程随即被强杀，不必等关闭', async () => {
    const proc = await start();
    const [helper] = helpers();
    // 假智能体在 stdin 关闭时退出。
    proc.child.stdin!.end();
    expect(await proc.exited).toBeNull();
    await until(() => !alive(helper!), 2_000);
  });

  it('initialize 之前就退出：start 失败，它派生的进程也已结束', async () => {
    fake.scenario({ exitOnInitialize: true });
    await expect(start()).rejects.toThrow();
    const [helper] = helpers();
    expect(helper).toBeDefined();
    expect(alive(helper!)).toBe(false);
  });
});
