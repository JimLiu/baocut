import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type EditOperation, type JobRecord, type ResourceCapacity } from '@baocut/protocol';
import { FileCredentialStore } from '@baocut/runtime-storage';
import {
  LocalProviderSource,
  MANIFEST_FILE,
  ModelCatalog,
  ModelServiceStore,
  ModelServices,
  type BundleDefinition,
  type RepoManifestSpec,
} from '@baocut/models';
import { JobManager, type JobVideos, type TaskSubmission } from './job-manager.ts';
import { LocalTranscribeProvider } from './local-provider.ts';
import { FAKE_MODEL_WORKER } from './index.ts';
import type { CapacitySource } from './machine-capacity.ts';
import { MODEL_WORKER_DEMAND, modelWorkerHolder, type ResourceReserves } from './resource-profiles.ts';
import { ResourceScheduler } from './resource-scheduler.ts';

/**
 * JobManager 经资源调度（架构设计 §7.6、§7.7）准入，对着假的 Model Worker 跑：等待原因、超过容量的拒绝、取消与崩溃时
 * 租约不泄漏也不提前归还、空闲的 Model Worker 让位。容量是注入的假值：内存 1.5 GiB、不留预留，正好放得下一个 Model Worker。
 */

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const COMPONENTS: BundleDefinition['components'] = {
  asr: { family: 'qwen3-asr', repo: 'test/asr', revision: 'r-asr' },
  vad: { family: 'silero-vad', repo: 'test/vad', revision: 'r-vad' },
};
const BUNDLE_IDS = ['fake@cpu', 'other@cpu', 'fake@cpu#hang-on-cancel,slow', 'fake@cpu#crash-once', 'fake@cpu#slow-load', 'fake@cpu#slow'];
const BUNDLES: BundleDefinition[] = BUNDLE_IDS.map((bundleId) => ({
  bundleId,
  capability: 'transcribe',
  backend: 'candle',
  device: 'cpu',
  label: 'Fake',
  components: COMPONENTS,
}));

async function writeRepo(root: string, repo: string, revision: string): Promise<void> {
  const dir = path.join(root, ...repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const content = `weights of ${repo}`;
  await fs.writeFile(path.join(dir, 'model.safetensors'), content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo, revision, files: [{ path: 'model.safetensors', size: content.length, sha256 }] }),
  );
}

class FakeVideos implements JobVideos {
  revision = 7;
  contentHash = 'sha256:' + 'a'.repeat(64);

  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  retain(): void {}

  release(): void {}

  async source() {
    return { file: this.file, revision: '1', contentHash: this.contentHash, mediaType: 'audio/wav' };
  }

  current() {
    return { videoRevision: String(this.revision), asset: { revision: '1', contentHash: this.contentHash } };
  }

  videoRevision() {
    return String(this.revision);
  }

  async apply(_videoId: string, _request: { commandId: string; expectedRevision: string; operations: EditOperation[] }) {
    this.revision++;
    return { refs: { speech: 'doc_speech' } };
  }
}

class FakeCapacity implements CapacitySource {
  value: ResourceCapacity = {
    memory: 1.5 * GiB,
    gpuMemory: null,
    cpuThreads: 8,
    scratchDisk: null,
    unifiedMemory: false,
    sources: { memory: 'setting', gpuMemory: 'unknown', cpuThreads: 'setting', scratchDisk: 'unknown' },
  };

  current(): ResourceCapacity {
    return this.value;
  }
}

const NO_RESERVES = (): ResourceReserves => ({
  system: { memory: 0, gpuMemory: null, cpuThreads: 0, scratchDisk: null },
  interactive: { memory: 0, gpuMemory: null, cpuThreads: 0, scratchDisk: null },
});

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 可以从外面结束的任务。 */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('JobManager 的资源准入（假 Model Worker）', () => {
  let dir: string;
  let catalog: ModelCatalog;
  let provider: LocalTranscribeProvider;
  let scheduler: ResourceScheduler;
  let manager: JobManager;
  let events: JobRecord[];
  /** 进程持有的份额归还时，那个进程是否还活着（每个进程一条）。 */
  let releasedWhileAlive: boolean[];
  /** 测试里此刻唯一的 Model Worker 进程号（归还时检查它）。 */
  let currentPid: number | null;

  async function start(
    options: { idleMs?: number; cancelGraceMs?: number; manifests?: RepoManifestSpec[]; bundles?: BundleDefinition[] } = {},
  ) {
    catalog = new ModelCatalog({ root: path.join(dir, 'models'), bundles: options.bundles ?? BUNDLES, manifests: options.manifests });
    scheduler = new ResourceScheduler({ capacity: new FakeCapacity(), reserves: NO_RESERVES });
    releasedWhileAlive = [];
    currentPid = null;
    const retain = scheduler.retain.bind(scheduler);
    scheduler.retain = (holder, evict) => {
      const release = retain(holder, evict);
      if (!release) return null;
      return () => {
        releasedWhileAlive.push(currentPid !== null && alive(currentPid));
        release();
      };
    };
    provider = new LocalTranscribeProvider({
      catalog,
      command: () => ({ command: process.execPath, args: [FAKE_MODEL_WORKER] }),
      env: async () => process.env,
      idleMs: options.idleMs ?? 60_000,
      cancelGraceMs: options.cancelGraceMs ?? 5_000,
      resources: scheduler,
    });
    const store = await ModelServiceStore.open(
      { modelServicesFile: path.join(dir, 'store', 'model-services.json') },
      new FileCredentialStore(path.join(dir, 'store', 'model-credentials.json')),
    );
    const paths = {
      jobsFile: path.join(dir, 'store', 'jobs.jsonl'),
      stagingDir: path.join(dir, 'staging'),
      artifactsDir: path.join(dir, 'artifacts'),
      diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
    };
    const sources = [new LocalProviderSource({ catalog, transcriber: provider })];
    manager = new JobManager({
      paths,
      catalog,
      router: new ModelServices({ store, sources }),
      videos: new FakeVideos(audio),
      resources: scheduler,
    });
    await manager.open();
    events = [];
    manager.onChange((job) => events.push(structuredClone(job)));
  }

  let audio: string;

  const submit = (bundleId = 'fake@cpu') =>
    manager.submitTranscribe({ videoId: 'mov_1', assetId: 'ast_1', bundleId }, { kind: 'connection', id: 'conn_1' });

  /** 不经模型的任务：`gate` 兑现前一直运行。 */
  const task = (gate: Promise<void>, patch: Partial<TaskSubmission> = {}) =>
    manager.submitTask(
      {
        kind: 'export',
        spec: { task: 'export', snapshotArtifactId: 'sha256:' + '0'.repeat(64) },
        videoId: null,
        contentHash: 'sha256:' + '1'.repeat(64),
        inputHash: 'sha256:' + crypto.randomBytes(32).toString('hex'),
        providerId: 'local',
        modelId: 'export:test',
        queue: { key: 'export', concurrency: 2 },
        resources: { demand: { memory: 1 * GiB } },
        run: async ({ signal }) => {
          const aborted = new Promise((_, reject) => {
            if (signal.aborted) reject(new Error('aborted'));
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
          await Promise.race([gate, aborted]);
          return { documentId: null, artifactId: 'sha256:' + '2'.repeat(64) };
        },
        ...patch,
      },
      { kind: 'connection', id: 'conn_1' },
    );

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-job-resources-'));
    await writeRepo(path.join(dir, 'models'), 'test/asr', 'r-asr');
    await writeRepo(path.join(dir, 'models'), 'test/vad', 'r-vad');
    audio = path.join(dir, 'audio.wav');
    await fs.writeFile(audio, 'not really audio');
  });

  afterEach(async () => {
    await manager?.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('放不下的任务排队并记下在等什么；取消排队的撤回请求；结束后后面的开始', async () => {
    await start();
    const first = deferred();
    const a = task(first.promise);
    const b = task(first.promise);
    const c = task(first.promise);
    expect(manager.inspect(a.jobId).state).toBe('running');
    const waiting = manager.inspect(b.jobId);
    expect(waiting).toMatchObject({ state: 'queued', wait: { reason: 'resources', dimensions: ['memory'], ahead: 0 } });
    expect(waiting.wait!.detail).toContain('内存');
    expect(events.some((e) => e.jobId === b.jobId && e.wait?.reason === 'resources')).toBe(true);
    // c 的队列没满，排在等内存的 b 后面：同样算等资源。
    expect(manager.inspect(c.jobId).wait).toMatchObject({ reason: 'resources', dimensions: ['memory'], ahead: 1 });
    expect(scheduler.snapshot().waiting.map((w) => w.owner)).toEqual([b.jobId, c.jobId]);

    await manager.cancel(b.jobId);
    expect(manager.inspect(b.jobId)).toMatchObject({ state: 'cancelled' });
    expect(manager.inspect(b.jobId).wait).toBeUndefined();
    expect(scheduler.snapshot().waiting.map((w) => w.owner)).toEqual([c.jobId]);

    first.resolve();
    await manager.settled(a.jobId);
    await manager.settled(c.jobId);
    expect(manager.inspect(c.jobId)).toMatchObject({ state: 'completed' });
    expect(manager.inspect(c.jobId).wait).toBeUndefined();
    // 租约在执行（含收尾）结束之后归还，可能晚于终态。
    await until(() => scheduler.outstanding === 0);
  });

  it('停止 Runtime 时任务还在运行与排队：全部停下，租约全部归还', async () => {
    await start();
    const gate = deferred();
    const ids = [task(gate.promise), task(gate.promise), task(gate.promise)].map((t) => t.jobId);
    await manager.shutdown();
    expect(ids.map((id) => manager.inspect(id).state)).toEqual(['interrupted', 'interrupted', 'interrupted']);
    expect(scheduler.outstanding).toBe(0);
  });

  it('同一队列的并发上限也是一种等待；需求超过这台机器能给的量时提交即被拒绝', async () => {
    await start();
    const gate = deferred();
    const a = task(gate.promise, { queue: { key: 'serial', concurrency: 1 }, resources: { demand: {} } });
    const b = task(gate.promise, { queue: { key: 'serial', concurrency: 1 }, resources: { demand: {} } });
    expect(manager.inspect(b.jobId).wait).toMatchObject({ reason: 'concurrency', ahead: 0 });
    let error: unknown;
    try {
      task(gate.promise, { resources: { demand: { memory: 2 * GiB } } });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).details).toMatchObject({
      code: 'RESOURCE_ADMISSION_UNSATISFIABLE',
      dimensions: [{ dimension: 'memory', demand: 2 * GiB, limit: 1.5 * GiB }],
    });
    expect(manager.list().filter((j) => j.state === 'queued' || j.state === 'running')).toHaveLength(2);
    gate.resolve();
    await manager.settled(a.jobId);
    await manager.settled(b.jobId);
    await until(() => scheduler.outstanding === 0);
  });

  it('转写：Model Worker 进程持有 holder，任务结束后仍计入；卸载、进程真的退出之后才归还', async () => {
    await start();
    const { jobId } = await submit();
    await manager.settled(jobId);
    expect(manager.inspect(jobId).state).toBe('completed');
    currentPid = provider.workerPid('fake@cpu')!;
    expect(currentPid).toBeGreaterThan(0);
    await until(() => scheduler.snapshot().leases.length === 0);
    const snapshot = scheduler.snapshot();
    expect(snapshot.leases).toEqual([]);
    expect(snapshot.holders).toMatchObject([{ holder: modelWorkerHolder('fake@cpu'), users: 0, processes: 1 }]);
    expect(snapshot.leased.memory).toBe(1 * GiB);
    await provider.unload('fake@cpu');
    await until(() => scheduler.outstanding === 0);
    expect(alive(currentPid)).toBe(false);
    expect(releasedWhileAlive).toEqual([false]);
  });

  it('Model Worker 的需求按提交时要加载的权重估计（candle 在 CPU 上，计在内存）：没装的可选组件不计，装上之后计入；不知道权重多大时用固定值', async () => {
    const manifest = (repo: string, revision: string, size: number): RepoManifestSpec => ({
      repo,
      revision,
      files: [{ path: 'model.safetensors', size, sha256: null }],
      estimatedBytes: size,
      provenance: 'test',
    });
    const aligner = { family: 'qwen3-forced-aligner' as const, repo: 'test/aligner', revision: 'r-aligner', optional: true as const };
    await start({
      manifests: [
        manifest('test/asr', 'r-asr', 200 * MiB),
        manifest('test/vad', 'r-vad', 100 * MiB),
        manifest('test/aligner', 'r-aligner', 150 * MiB),
      ],
      bundles: BUNDLES.map((b) => ({ ...b, components: { ...b.components, aligner } })),
    });
    const holderDemand = async () => {
      const { jobId } = await submit();
      await manager.settled(jobId);
      expect(manager.inspect(jobId).state).toBe('completed');
      const demand = scheduler.snapshot().holders.find((h) => h.holder === modelWorkerHolder('fake@cpu'))!.demand;
      await provider.unload('fake@cpu');
      await until(() => scheduler.outstanding === 0);
      return demand;
    };
    // 对齐器没装：只有 300 MiB 的必需组件，加 1 GiB，计在内存、不占 GPU 内存（这台机器只有 1.5 GiB）。
    expect(await catalog.workerWeightBytes('fake@cpu')).toBe(300 * MiB);
    expect(await holderDemand()).toEqual({ ...MODEL_WORKER_DEMAND, memory: 1 * GiB + 300 * MiB, gpuMemory: 0 });
    // 装上之后的提交把它算进去。
    await writeRepo(path.join(dir, 'models'), 'test/aligner', 'r-aligner');
    expect(await catalog.workerWeightBytes('fake@cpu')).toBe(450 * MiB);
    expect(await holderDemand()).toEqual({ ...MODEL_WORKER_DEMAND, memory: 1 * GiB + 450 * MiB, gpuMemory: 0 });
    await manager.shutdown();

    await start();
    expect(await catalog.workerWeightBytes('fake@cpu')).toBeNull();
    const second = await submit();
    await manager.settled(second.jobId);
    expect(scheduler.snapshot().holders).toMatchObject([{ holder: modelWorkerHolder('fake@cpu'), demand: MODEL_WORKER_DEMAND }]);
    await provider.unload('fake@cpu');
    await until(() => scheduler.outstanding === 0);
  });

  it('取消（Worker 不理会取消）：进程被结束之前不归还，结束之后不泄漏', async () => {
    await start({ cancelGraceMs: 300 });
    const bundleId = 'fake@cpu#hang-on-cancel,slow';
    const { jobId } = await submit(bundleId);
    currentPid = await until(() => manager.inspect(jobId).phase === 'transcribing' && provider.workerPid(bundleId));
    const cancelled = manager.cancel(jobId);
    // 取消发出了，进程还活着：租约与 holder 都还在。
    expect(scheduler.snapshot().leases.map((l) => l.owner)).toEqual([jobId]);
    expect(scheduler.snapshot().holders).toMatchObject([{ holder: modelWorkerHolder(bundleId), processes: 1 }]);
    expect(await cancelled).toEqual({ state: 'cancelled' });
    expect(alive(currentPid)).toBe(false);
    await until(() => scheduler.outstanding === 0);
    expect(releasedWhileAlive).toEqual([false]);
  });

  it('Worker 崩溃后自动重试：同一份租约跨过两次尝试，结束后不泄漏', async () => {
    await start();
    const bundleId = 'fake@cpu#crash-once';
    const leased: boolean[] = [];
    manager.onChange((job) => {
      if (job.kind === 'transcribe' && (job.state === 'running' || job.state === 'interrupted')) {
        leased.push(scheduler.snapshot().leases.some((l) => l.owner === job.jobId));
      }
    });
    const { jobId } = await submit(bundleId);
    await manager.settled(jobId);
    expect(manager.inspect(jobId)).toMatchObject({ state: 'completed', attempt: 2 });
    expect(events.some((e) => e.jobId === jobId && e.state === 'interrupted')).toBe(true);
    expect(leased.length).toBeGreaterThan(2);
    expect(leased.every(Boolean)).toBe(true);
    currentPid = provider.workerPid(bundleId);
    await provider.unload(bundleId);
    await until(() => scheduler.outstanding === 0);
    // 崩溃的那个进程退出时也归还了它的一份（那时它已经不在了）。
    expect(releasedWhileAlive).toEqual([false, false]);
  });

  it('加载时取消：任务先归还租约，正在加载的进程照样计入，直到它退出', async () => {
    await start();
    const bundleId = 'fake@cpu#slow-load';
    const { jobId } = await submit(bundleId);
    await until(() => manager.inspect(jobId).phase === 'loading');
    expect(await manager.cancel(jobId)).toEqual({ state: 'cancelled' });
    await until(() => scheduler.snapshot().leases.length === 0);
    const snapshot = scheduler.snapshot();
    expect(snapshot.leases).toEqual([]);
    expect(snapshot.holders).toMatchObject([{ holder: modelWorkerHolder(bundleId), users: 0, processes: 1 }]);
    // 加载在后台完成，进程留着；卸载之后才归还。
    currentPid = await until(() => provider.workerPid(bundleId));
    await provider.unload(bundleId);
    await until(() => scheduler.outstanding === 0);
    expect(releasedWhileAlive).toEqual([false]);
  });

  it('空闲的 Model Worker 给排队的转写让位：卸载它、等它退出，再启动另一个模型包', async () => {
    await start();
    const first = await submit('fake@cpu');
    await manager.settled(first.jobId);
    currentPid = provider.workerPid('fake@cpu')!;
    const second = await submit('other@cpu');
    await manager.settled(second.jobId);
    expect(manager.inspect(second.jobId).state).toBe('completed');
    // 第二个任务等过内存（容量只放得下一个 Model Worker），等到第一个进程退出。
    expect(events.some((e) => e.jobId === second.jobId && e.wait?.reason === 'resources')).toBe(true);
    expect(releasedWhileAlive[0]).toBe(false);
    expect(alive(currentPid)).toBe(false);
    await until(() => scheduler.snapshot().leases.length === 0);
    expect(scheduler.snapshot().holders).toMatchObject([{ holder: modelWorkerHolder('other@cpu'), users: 0, processes: 1 }]);
  });

  it('空闲卸载与新任务交错：每个进程退出后都归还，不泄漏', async () => {
    await start({ idleMs: 30 });
    for (let i = 0; i < 4; i++) {
      const { jobId } = await submit();
      await manager.settled(jobId);
      expect(manager.inspect(jobId).state).toBe('completed');
    }
    await until(() => scheduler.outstanding === 0);
    expect(provider.workerPid('fake@cpu')).toBeNull();
  });

  it('停止 Runtime：排队的撤回、运行中的停下、Model Worker 退出之后租约全部归还', async () => {
    await start();
    const running = await submit('fake@cpu#slow');
    await until(() => manager.inspect(running.jobId).phase === 'transcribing');
    // 另一个模型包的 Model Worker 放不下（正在用的那个不能让位）。
    const queued = await submit('other@cpu');
    expect(manager.inspect(queued.jobId).wait).toMatchObject({ reason: 'resources', dimensions: ['memory'] });
    await manager.shutdown();
    expect(manager.inspect(running.jobId).state).toBe('interrupted');
    expect(manager.inspect(queued.jobId).state).toBe('interrupted');
    expect(scheduler.outstanding).toBe(0);
  });
});
