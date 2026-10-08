import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { JobRecord, ResourceCapacity } from '@baocut/protocol';
import { ModelCatalog } from '@baocut/models';
import { JobManager, ResourceScheduler, type CapacitySource, type JobVideos } from '@baocut/jobs';
import { runWorker } from './video-export.ts';

/**
 * 成片导出的租约与 Worker 的进程组（架构设计 §7.7）：Worker 异常退出或被取消时，Runtime 杀掉它的整个进程组，
 * 等组里的进程真的都退出之后任务才结束、租约才归还。用假的 Worker（Node 脚本）与它启动的假 ffmpeg（忽略 SIGTERM、
 * 标准输入输出不连 Worker 的管道），不做真实渲染。`kill(-pgid, 0)` 的探测可以被「闸门」挡住，假装组里还有进程：
 * 闸门关着时租约必须还在；打开之后租约归还，归还的那一刻组里已经没有进程。只在有进程组的系统上跑。
 */

const GiB = 1024 * 1024 * 1024;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** 假 Worker：开一个同组的假 ffmpeg，把两个 pid 原子地写进 `<输入>.pids`，报一次进度；收到 `cancel` 时报取消并退出，不管 ffmpeg。 */
const FAKE_WORKER = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const input = process.argv[3];
const ffmpeg = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
fs.writeFileSync(input + '.pids.tmp', JSON.stringify({ worker: process.pid, ffmpeg: ffmpeg.pid }));
fs.renameSync(input + '.pids.tmp', input + '.pids');
process.stdout.write(JSON.stringify({ event: 'progress', frame: 1, total: 100 }) + '\\n');
let text = '';
process.stdin.setEncoding('utf8').on('data', (chunk) => {
  text += chunk;
  if (text.includes('cancel')) {
    process.stdout.write(JSON.stringify({ event: 'cancelled', frame: 1, total: 100 }) + '\\n', () => process.exit(0));
  }
});
setInterval(() => {}, 1000);
`;

class FixedCapacity implements CapacitySource {
  current(): ResourceCapacity {
    return {
      memory: 8 * GiB,
      gpuMemory: null,
      cpuThreads: 8,
      scratchDisk: null,
      unifiedMemory: false,
      sources: { memory: 'setting', gpuMemory: 'unknown', cpuThreads: 'setting', scratchDisk: 'unknown' },
    };
  }
}

const realKill = process.kill.bind(process);

function alive(pid: number): boolean {
  try {
    realKill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until<T>(read: () => T | null | undefined | false | Promise<T | null | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe.skipIf(process.platform === 'win32')('成片导出：进程组退出之后才归还租约', () => {
  let dir: string;
  let workerScript: string;
  let scheduler: ResourceScheduler;
  let jobs: JobManager;
  /** 闸门关着时，`kill(-pgid, 0)` 一律当作组里还有进程。 */
  let gated: boolean;
  /** 闸门关着时挡下的探测次数。 */
  let probesBlocked: number;
  /** 每次归还租约时：闸门是否关着、Worker 的进程组里是否还有进程。 */
  let releases: Array<{ gated: boolean; groupAlive: boolean }>;
  let pids: { worker: number; ffmpeg: number } | null;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-export-lease-'));
    // Worker 以可执行文件的方式启动（`runWorker` 只传 `render <输入>` 两个参数）：一个 exec 到 node 的包装，pid 不变。
    const script = path.join(dir, 'fake-export-worker.cjs');
    await fs.writeFile(script, FAKE_WORKER);
    workerScript = path.join(dir, 'fake-export-worker');
    await fs.writeFile(workerScript, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
    gated = true;
    probesBlocked = 0;
    releases = [];
    pids = null;
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (pid < 0 && signal === 0 && gated) {
        probesBlocked++;
        return true;
      }
      return realKill(pid, signal);
    }) as typeof process.kill);

    scheduler = new ResourceScheduler({
      capacity: new FixedCapacity(),
      reserves: () => ({
        system: { memory: 0, gpuMemory: null, cpuThreads: 0, scratchDisk: null },
        interactive: { memory: 0, gpuMemory: null, cpuThreads: 0, scratchDisk: null },
      }),
    });
    // 记下每次归还租约的那一刻。
    const request = scheduler.request.bind(scheduler);
    scheduler.request = (req, handlers) =>
      request(req, {
        ...handlers,
        admit: (lease) =>
          handlers.admit({
            leaseId: lease.leaseId,
            release: () => {
              releases.push({ gated, groupAlive: pids !== null && alive(-pids.worker) });
              lease.release();
            },
          }),
      });
    const videos: JobVideos = {
      retain: () => {},
      release: () => {},
      source: async () => {
        throw new Error('不读素材');
      },
      current: () => null,
      videoRevision: () => null,
      apply: async () => ({}),
    };
    jobs = new JobManager({
      paths: {
        jobsFile: path.join(dir, 'store', 'jobs.jsonl'),
        stagingDir: path.join(dir, 'staging'),
        artifactsDir: path.join(dir, 'artifacts'),
        diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
      },
      catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
      router: {
        selectTranscribe: async () => {
          throw new Error('不转写');
        },
        transcriber: () => null,
        executors: () => [],
      },
      videos,
      resources: scheduler,
    });
    await jobs.open();
  });

  afterEach(async () => {
    gated = false;
    vi.restoreAllMocks();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 与导出服务相同的接法：一个带资源需求的任务，里面跑一次 Worker 的 `render`。 */
  async function startRender(): Promise<{ jobId: string; pids: { worker: number; ffmpeg: number } }> {
    const input = path.join(dir, `render-${crypto.randomBytes(4).toString('hex')}.json`);
    await fs.writeFile(input, '{}');
    const { jobId } = jobs.submitTask(
      {
        kind: 'export',
        spec: { task: 'export', snapshotArtifactId: 'sha256:' + '0'.repeat(64) },
        videoId: null,
        contentHash: 'sha256:' + '1'.repeat(64),
        inputHash: 'sha256:' + crypto.randomBytes(32).toString('hex'),
        providerId: 'local',
        modelId: 'export:video',
        queue: { key: 'export', concurrency: 2 },
        resources: { demand: { memory: 1 * GiB, cpuThreads: 2 } },
        run: async ({ signal }) => {
          await runWorker({ command: workerScript }, 'render', input, { signal });
          return { documentId: null, artifactId: 'sha256:' + '2'.repeat(64) };
        },
      },
      { kind: 'connection', id: 'conn_1' },
    );
    const read = await until(async () => {
      const text = await fs.readFile(`${input}.pids`, 'utf8').catch(() => '');
      return text ? (JSON.parse(text) as { worker: number; ffmpeg: number }) : null;
    });
    pids = read;
    onTestFinished(() => {
      for (const pid of [read.ffmpeg, read.worker]) if (alive(pid)) realKill(pid, 'SIGKILL');
    });
    expect(scheduler.snapshot().leases).toHaveLength(1);
    return { jobId, pids: read };
  }

  const record = (jobId: string): JobRecord => jobs.inspect(jobId);

  /** 闸门关着：组已经被杀掉，但探测说还在——任务没结束，租约还在。打开闸门之后任务结束，租约在组真的退出之后归还。 */
  async function expectLeaseHeldUntilGroupGone(jobId: string, worker: { worker: number; ffmpeg: number }): Promise<JobRecord> {
    await until(() => probesBlocked > 0);
    // Runtime 已经强杀了整个组：假 ffmpeg 忽略 SIGTERM，只有 SIGKILL 收得掉它。
    await until(() => !alive(worker.ffmpeg) && !alive(worker.worker), 3_000);
    expect(TERMINAL.has(record(jobId).state)).toBe(false);
    expect(scheduler.snapshot().leases).toHaveLength(1);
    expect(releases).toEqual([]);
    gated = false;
    const done = await until(() => TERMINAL.has(record(jobId).state) && record(jobId));
    await until(() => scheduler.snapshot().leases.length === 0);
    expect(releases).toEqual([{ gated: false, groupAlive: false }]);
    expect(scheduler.outstanding).toBe(0);
    return done;
  }

  it('Worker 被强杀：任务失败；它留下的 ffmpeg 随组被杀掉，组退出之后才归还租约', async () => {
    const { jobId, pids: started } = await startRender();
    realKill(started.worker, 'SIGKILL');
    const done = await expectLeaseHeldUntilGroupGone(jobId, started);
    expect(done.state).toBe('failed');
  });

  it('取消：Worker 自己退出但没停下 ffmpeg；组被杀掉、退出之后才归还租约', async () => {
    const { jobId, pids: started } = await startRender();
    // 不等 `cancel` 兑现：它等任务结束，而任务要等闸门打开。
    const cancelled = jobs.cancel(jobId);
    const done = await expectLeaseHeldUntilGroupGone(jobId, started);
    expect(done.state).toBe('cancelled');
    expect(await cancelled).toEqual({ state: 'cancelled' });
  });
});
