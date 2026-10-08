import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RpcError,
  type EditOperation,
  type JobGrantSettlementBasis,
  type JobGrantUse,
  type JobRecord,
  type JobState,
  type JobSubmitter,
  type SpeechModelInfo,
} from '@baocut/protocol';
import {
  ModelCatalog,
  type GenerationAttempt,
  type GenerationCapability,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSelection,
  type GenerationSink,
} from '@baocut/models';
import { JobManager, type JobVideos, type TranscribeRouter } from './job-manager.ts';
import type { JobAdmission } from './job-admission.ts';
import type { AppliedReceipt, ApplicationRun, JobFaultPoint } from './job-application.ts';
import type { StoredJob } from './job-ledger.ts';
import { cancellationFacts, recoveryAction, type RemoteTaskQuery, type RemoteTaskStatus } from './job-recovery.ts';
import { reconcileChoices } from './job-reconcile.ts';

/**
 * 重启恢复与对账（架构设计 §7.2–§7.5）：用故障注入在几个时刻模拟崩溃（产物写进产物库、结果还没记下；产物发布后、应用前；
 * 账本写下命令后、提交前；提交后、记回执前），丢下旧的 JobManager、在同一个目录上新建一个（就像进程重启），断言不重复写入、不重新生成、
 * 预算只结算一次、状态正确；再把 `jobs.reconcile` 的每个决定都走一遍。视频引擎是假的（记下按命令提交的回执），
 * 真实引擎的端到端测试在 runtime-core。
 */

const MODEL: SpeechModelInfo = {
  modelId: 'tts',
  label: 'tts',
  default: true,
  voices: [{ voiceId: 'alloy', label: 'Alloy' }],
  defaultVoice: 'alloy',
  voiceModes: ['preset'],
  languages: 'any',
  maxInputChars: 100,
  formats: ['mp3'],
  defaultFormat: 'mp3',
  acceptsInstructions: false,
  speedRange: null,
  acceptsSeed: false,
  cost: 'unknown',
};

const CONNECTION: JobSubmitter = { kind: 'connection', id: 'conn_1' };
const AGENT: JobSubmitter = { kind: 'agent', id: 'run_1', taskId: 'task_1' };

/** 在线（外发）的假生成器：默认写一个「mp3」；`hold()` 之后的调用永远不返回（模拟崩溃时还在跑）。 */
class FakeGenerator implements GenerationProvider {
  readonly id = 'fake';
  readonly runs: GenerationRun[] = [];
  #hold = false;

  hold(): void {
    this.#hold = true;
  }

  release(): void {
    this.#hold = false;
  }

  async generate(run: GenerationRun, sink: GenerationSink): Promise<GenerationAttempt> {
    this.runs.push(run);
    if (this.#hold) return new Promise(() => {});
    sink.generating();
    const bytes = Buffer.concat([Buffer.from('ID3'), Buffer.from(run.jobId)]);
    await fs.writeFile(path.join(run.staging, 'output-1.mp3'), bytes);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return {
      outcome: 'completed',
      workerVersion: 'fake@1',
      outputs: [{ path: 'output-1.mp3', sha256, byteLength: bytes.length, mediaType: 'audio/mpeg' }],
    };
  }

  async close(): Promise<void> {}
}

const PLACE = { root: '/fake/videos/mov_1', file: '.', scope: 'project' };

/** 假的视频与引擎：引擎按 `commandId` 记下回执（跨「重启」保留）；Runtime 重启后视频没有打开，按位置重新打开。 */
class FakeVideos implements JobVideos {
  open = true;
  /** 目录不见了：重新打开时 `missing`。 */
  gone = false;
  revision = 1;
  leases = 0;
  /** 真正落下的提交（引擎里的事务）。 */
  committed: Array<{ commandId: string; operations: EditOperation[] }> = [];
  receipts = new Map<string, AppliedReceipt>();
  receiptQueries: string[] = [];
  receiptFails = false;
  reopened = 0;
  /** 引擎侧的停止屏障：runId → 失效到的代。 */
  invalidated = new Map<string, number>();
  /** 带着 run 到达的提交（看提交有没有带上执行）。 */
  runs: Array<ApplicationRun | undefined> = [];

  retain(): void {
    this.leases++;
  }

  release(): void {
    this.leases--;
  }

  async source(): Promise<never> {
    throw new RpcError('not-found', '没有素材');
  }

  current() {
    return null;
  }

  videoRevision(videoId: string) {
    return videoId === 'mov_1' && this.open ? String(this.revision) : null;
  }

  place(videoId: string) {
    return this.videoRevision(videoId) === null ? null : PLACE;
  }

  async reopen(videoId: string, place: Record<string, unknown>): Promise<'opened' | 'missing' | 'mismatch'> {
    expect(place).toEqual(PLACE);
    if (videoId !== 'mov_1') return 'mismatch';
    if (this.gone) return 'missing';
    this.reopened++;
    this.open = true;
    this.leases++;
    return 'opened';
  }

  async invalidateRun(_videoId: string, run: ApplicationRun): Promise<boolean> {
    this.invalidated.set(run.runId, Math.max(this.invalidated.get(run.runId) ?? 0, Number(run.runGeneration)));
    return true;
  }

  async apply(
    _videoId: string,
    request: { commandId: string; expectedRevision: string; operations: EditOperation[]; run?: ApplicationRun },
  ) {
    this.runs.push(request.run);
    // 幂等：同一个命令再来一次只返回原来的回执。
    const existing = this.receipts.get(request.commandId);
    if (existing) return existing;
    const stopped = request.run && this.invalidated.get(request.run.runId);
    if (stopped !== undefined && stopped >= Number(request.run!.runGeneration)) {
      throw new RpcError('forbidden', '这次执行已被停止，修改没有提交', { code: 'TASK_STOPPED' });
    }
    if (request.expectedRevision !== String(this.revision)) throw new RpcError('conflict', '版本冲突');
    this.revision++;
    this.committed.push({ commandId: request.commandId, operations: request.operations });
    const n = this.committed.length;
    const receipt: AppliedReceipt = {
      transactionId: `txn_${n}`,
      videoRevision: String(this.revision),
      refs: Object.fromEntries(request.operations.map((op, i) => [(op as { ref: string }).ref, `ast_${n}_${i + 1}`])),
    };
    this.receipts.set(request.commandId, receipt);
    return receipt;
  }

  async receipt(_videoId: string, commandId: string): Promise<AppliedReceipt | null> {
    this.receiptQueries.push(commandId);
    if (this.receiptFails) throw new RpcError('engine-unavailable', '引擎不可用');
    return this.receipts.get(commandId) ?? null;
  }
}

/** 假的授权服务：开始执行过的预留按保守规则结算（与 grant-store 一致）；每笔预留只能结算一次。 */
class FakeAdmission implements JobAdmission {
  admitted = 0;
  started = new Set<string>();
  settles: Array<{ reservationId: string; basis: JobGrantSettlementBasis }> = [];

  admit(): JobGrantUse {
    this.admitted++;
    return {
      grantId: 'grt_1',
      generation: 1,
      reservationId: `rsv_${this.admitted}`,
      budgetMode: 'per-call-unknown-cost',
      dataKinds: ['transcript'],
      reserved: { calls: 1, amount: null },
      settled: null,
    };
  }

  /** 设了时，「已开始」落盘之后进程就没了（start 永远不兑现）。 */
  crashAfterStart = false;

  async start(use: JobGrantUse) {
    this.started.add(use.reservationId);
    if (this.crashAfterStart) return new Promise<null>(() => {});
    return null;
  }

  begun(use: JobGrantUse): boolean {
    return this.started.has(use.reservationId);
  }

  retry(use: JobGrantUse): JobGrantUse {
    return use;
  }

  settle(use: JobGrantUse, outcome: { state: JobState }): JobGrantUse {
    if (this.settles.some((s) => s.reservationId === use.reservationId)) throw new Error(`重复结算 ${use.reservationId}`);
    const basis: JobGrantSettlementBasis =
      outcome.state === 'completed' ? 'unknown' : this.started.has(use.reservationId) ? 'conservative' : 'released';
    this.settles.push({ reservationId: use.reservationId, basis });
    return { ...use, settled: { calls: basis === 'released' ? 0 : 1, amount: null, basis, at: new Date().toISOString() } };
  }
}

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('重启恢复与对账（JobManager）', () => {
  let dir: string;
  let paths: { jobsFile: string; stagingDir: string; artifactsDir: string; diagnosticsDir: string };
  let generator: FakeGenerator;
  let videos: FakeVideos;
  let admission: FakeAdmission;
  let manager: JobManager;
  let crashAt: { point: JobFaultPoint; action?: (jobId: string) => void } | null;
  let remoteTasks: RemoteTaskQuery | undefined;

  function create(): JobManager {
    const router: TranscribeRouter = {
      selectTranscribe: async () => {
        throw new Error('不用');
      },
      transcriber: () => null,
      executors: () => [],
      selectGeneration: async <C extends GenerationCapability>(capability: C) =>
        ({
          capability,
          providerId: 'fake',
          modelId: 'tts',
          kind: 'online',
          label: 'Fake',
          source: 'user-default',
          model: MODEL,
          generator,
          queue: { key: 'fake', concurrency: 1 },
        }) as unknown as GenerationSelection<C>,
      generators: () => [generator],
    };
    return new JobManager({
      paths,
      catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
      router,
      videos,
      admission,
      ...(remoteTasks ? { remoteTasks } : {}),
      probe: async () => ({ ok: true, media: { kind: 'audio', durationSec: 1, sampleRate: 24_000, channels: 1 } }),
      faults: (point, context) => {
        if (crashAt?.point !== point) return;
        if (crashAt.action) return crashAt.action(context.jobId);
        crashAt = null;
        return 'crash';
      },
    });
  }

  /** 丢下旧的 JobManager（不正常停止），在同一个目录上新建一个；Runtime 重启后视频没有打开。 */
  async function restart(): Promise<JobManager> {
    videos.open = false;
    videos.leases = 0;
    crashAt = null;
    manager = create();
    await manager.open();
    await manager.recover();
    return manager;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-job-recovery-'));
    paths = {
      jobsFile: path.join(dir, 'store', 'jobs.json'),
      stagingDir: path.join(dir, 'staging'),
      artifactsDir: path.join(dir, 'artifacts'),
      diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
    };
    generator = new FakeGenerator();
    videos = new FakeVideos();
    admission = new FakeAdmission();
    crashAt = null;
    remoteTasks = undefined;
    manager = create();
    await manager.open();
  });

  afterEach(async () => {
    await manager.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function speak(submitter: JobSubmitter = CONNECTION): Promise<JobRecord> {
    const { jobId } = await manager.submitSynthesizeSpeech({ text: '你好', videoId: 'mov_1', name: '旁白' }, submitter);
    await manager.settled(jobId);
    return manager.inspect(jobId);
  }

  async function stored(jobId: string): Promise<JobRecord | undefined> {
    const text = await fs.readFile(paths.jobsFile, 'utf8').catch(() => '{"jobs":[]}');
    const data = JSON.parse(text) as { jobs: StoredJob[] };
    return data.jobs.find((job) => job.record.jobId === jobId)?.record;
  }

  /** 应用账本（权威）里这个任务的应用：崩溃之后内存里的投影不再更新，看磁盘。 */
  async function ledgerApps(jobId: string): Promise<NonNullable<JobRecord['applications']>> {
    const data = JSON.parse(await fs.readFile(path.join(dir, 'store', 'applications.json'), 'utf8')) as {
      applications: Array<{ record: NonNullable<JobRecord['applications']>[number] }>;
    };
    return data.applications.map((item) => item.record).filter((app) => app.jobId === jobId);
  }

  /** 发布时按完成结算，之后无论应用怎样都不再结算。 */
  function expectSettledOnce(job: JobRecord): void {
    expect(job.grant?.settled).toMatchObject({ basis: 'unknown', calls: 1 });
    expect(admission.settles).toEqual([{ reservationId: job.grant!.reservationId, basis: 'unknown' }]);
  }

  it('产物发布后、应用前崩溃：重启后复用产物补做应用，不重新生成、只写一次', async () => {
    crashAt = { point: 'artifact-published' };
    const before = await speak();
    expect(before).toMatchObject({ state: 'running', phase: 'applying', result: { artifactId: expect.any(String) } });
    expect(before.applications).toEqual([expect.objectContaining({ state: 'pending', commandId: null, targetRefs: ['output1'] })]);
    expect(videos.committed).toHaveLength(0);

    await restart();
    const job = manager.inspect(before.jobId);
    expect(job.state).toBe('completed');
    expect(generator.runs).toHaveLength(1);
    expect(videos.reopened).toBe(1);
    expect(videos.committed).toHaveLength(1);
    const [app] = job.applications!;
    expect(app).toMatchObject({ state: 'committed', commandId: `cmd_${app!.applicationId}_1`, receipt: { transactionId: 'txn_1' } });
    expect(app!.receipt).not.toHaveProperty('recovered');
    expect(job.result).toMatchObject({ outputs: [{ assetId: 'ast_1_1' }] });
    expect(job.result!.artifactId).toBe(before.result!.artifactId);
    expectSettledOnce(job);
    // 视频的租约在结束时还回去。
    expect(videos.leases).toBe(0);
    expect(await stored(before.jobId)).toMatchObject({ state: 'completed' });
  });

  it('账本记下命令后、提交前崩溃：按旧命令查回执（没有），换新命令提交一次', async () => {
    crashAt = { point: 'application-recorded' };
    const before = await speak();
    const [pending] = await ledgerApps(before.jobId);
    expect(pending).toMatchObject({ state: 'validating', commandId: `cmd_${pending!.applicationId}_1`, baseVideoRevision: '1' });
    expect(videos.committed).toHaveLength(0);

    await restart();
    const job = manager.inspect(before.jobId);
    expect(job.state).toBe('completed');
    expect(videos.receiptQueries).toEqual([`cmd_${pending!.applicationId}_1`]);
    expect(videos.committed.map((c) => c.commandId)).toEqual([`cmd_${pending!.applicationId}_2`]);
    expect(job.applications).toEqual([expect.objectContaining({ applicationId: pending!.applicationId, state: 'committed' })]);
    expect(generator.runs).toHaveLength(1);
    expectSettledOnce(job);
  });

  it('提交后、记回执前崩溃：重启后按同一个命令查到回执，补记，不再写', async () => {
    crashAt = { point: 'application-committed' };
    const before = await speak();
    expect((await ledgerApps(before.jobId)).map((a) => a.state)).toEqual(['validating']);
    expect(videos.committed).toHaveLength(1);

    await restart();
    const job = manager.inspect(before.jobId);
    expect(job.state).toBe('completed');
    expect(videos.committed).toHaveLength(1);
    const [app] = job.applications!;
    expect(app).toMatchObject({ state: 'committed', receipt: { transactionId: 'txn_1', recovered: true, refs: { output1: 'ast_1_1' } } });
    expect(job.result).toMatchObject({ outputs: [{ assetId: 'ast_1_1' }] });
    expect(generator.runs).toHaveLength(1);
    expectSettledOnce(job);
  });

  it('重启后查不了回执：不换命令重写，应用记为 rejected（RECEIPT_UNKNOWN）；查得到之前 apply 也拒绝', async () => {
    crashAt = { point: 'application-committed' };
    const before = await speak();
    videos.receiptFails = true;
    await restart();
    const job = manager.inspect(before.jobId);
    expect(job).toMatchObject({ state: 'failed', error: { code: 'APPLY_FAILED', details: { reason: 'RECEIPT_UNKNOWN' } } });
    expect(job.result).not.toBeNull();
    expect(videos.committed).toHaveLength(1);
    expect(videos.leases).toBe(0);
    // 视频重新打开过，对账时仍然开着。
    expect(await manager.reconcile(before.jobId, 'apply').catch((e: unknown) => e)).toMatchObject({
      code: 'busy',
      details: { code: 'RECEIPT_UNKNOWN' },
    });
    expect(videos.committed).toHaveLength(1);
    // 引擎恢复：查到上次其实已经提交，补记回执，仍然只有一笔。
    videos.receiptFails = false;
    const applied = await manager.reconcile(before.jobId, 'apply');
    expect(applied.state).toBe('completed');
    expect(applied.applications!.at(-1)).toMatchObject({ state: 'committed', receipt: { recovered: true } });
    expect(videos.committed).toHaveLength(1);
    expect(videos.leases).toBe(0);
  });

  it('目标没了：应用 stale-input，产物留作候选，不猜相邻对象；视频打开之前 apply 拒绝', async () => {
    crashAt = { point: 'artifact-published' };
    const before = await speak();
    videos.gone = true;
    await restart();
    const job = manager.inspect(before.jobId);
    expect(job).toMatchObject({
      state: 'failed',
      error: {
        code: 'STALE_JOB_INPUT',
        details: { artifactIds: [before.result!.artifactId], applicationId: before.applications![0]!.applicationId },
      },
    });
    expect(job.error!.message).toContain('生成的结果已保留');
    expect(job.applications![0]).toMatchObject({ state: 'stale-input', error: { code: 'STALE_JOB_INPUT' } });
    expect(job.result).toMatchObject({ outputs: [{ assetId: null }] });
    expect(videos.committed).toHaveLength(0);
    expect(videos.leases).toBe(0);
    expect(await manager.reconcile(before.jobId, 'apply').catch((e: unknown) => e)).toMatchObject({
      code: 'not-found',
      details: { code: 'VIDEO_NOT_OPEN' },
    });
    // 用户重新打开视频后可以应用：新建一次应用。
    videos.open = true;
    const applied = await manager.reconcile(before.jobId, 'apply');
    expect(applied).toMatchObject({ state: 'completed', error: null });
    expect(applied.applications!.map((a) => a.state)).toEqual(['stale-input', 'committed']);
    expect(videos.committed).toHaveLength(1);
    expect(generator.runs).toHaveLength(1);
    expectSettledOnce(applied);
  });

  it('停止屏障：账本写下命令之后被取消，不再提交；结果留作候选，三件事实分开记；apply 之后应用', async () => {
    crashAt = { point: 'application-recorded', action: (jobId) => void manager.cancel(jobId) };
    const job = await speak();
    expect(job).toMatchObject({
      state: 'cancelled',
      cancellation: { remote: 'not-applicable', cost: 'charged', localStoppedAt: expect.any(String) },
    });
    expect(job.result).not.toBeNull();
    expect(job.applications![0]).toMatchObject({ state: 'cancelled', error: { code: 'APPLICATION_CANCELLED' } });
    expect(videos.committed).toHaveLength(0);
    expect(videos.leases).toBe(0);

    crashAt = null;
    const applied = await manager.reconcile(job.jobId, 'apply');
    expect(applied.state).toBe('completed');
    expect(applied).not.toHaveProperty('cancellation');
    // 先按被拦下的那条命令查回执（没有提交过），再新建一次应用。
    expect(videos.receiptQueries).toEqual([job.applications![0]!.commandId]);
    expect(applied.applications!.map((a) => a.state)).toEqual(['cancelled', 'committed']);
    expect(videos.committed).toHaveLength(1);
    expectSettledOnce(applied);
    // 已经应用过：不能再 apply。
    expect(await manager.reconcile(job.jobId, 'apply').catch((e: unknown) => e)).toMatchObject({
      code: 'conflict',
      details: { code: 'RECONCILE_NOT_ALLOWED', state: 'completed', allowed: [] },
    });
  });

  it('引擎侧的停止屏障：Node 侧检查之后才取消，交给引擎的那一笔被拒（TASK_STOPPED），应用记 cancelled，不查回执', async () => {
    crashAt = { point: 'application-submitting', action: (jobId) => void manager.cancel(jobId) };
    const job = await speak();
    expect(job).toMatchObject({ state: 'cancelled', cancellation: { remote: 'not-applicable', cost: 'charged' } });
    expect(job.applications![0]).toMatchObject({
      state: 'cancelled',
      error: { code: 'APPLICATION_CANCELLED', details: { barrier: 'engine' } },
    });
    // 提交带着这次执行；引擎拒绝，没有事务，也没有为它查回执。
    expect(videos.runs).toEqual([{ runId: job.jobId, runGeneration: '1' }]);
    expect(videos.invalidated.get(job.jobId)).toBe(1);
    expect(videos.committed).toHaveLength(0);
    expect(videos.receiptQueries).toEqual([]);
    expectSettledOnce(job);
    // 用户自己决定的 apply 不带执行，不受屏障影响。
    crashAt = null;
    const applied = await manager.reconcile(job.jobId, 'apply');
    expect(applied.state).toBe('completed');
    expect(videos.runs.at(-1)).toBeUndefined();
    expect(videos.committed).toHaveLength(1);
  });

  it('产物写进产物库、结果还没记下时崩溃：重启后按发布意图认领产物补做应用，不重新生成、预算只结算一次', async () => {
    crashAt = { point: 'artifact-stored' };
    const before = await speak();
    expect(before).toMatchObject({ state: 'running', phase: 'publishing', result: null });
    expect(before).not.toHaveProperty('applications');
    const ledger = JSON.parse(await fs.readFile(paths.jobsFile, 'utf8')) as { jobs: StoredJob[] };
    const intent = ledger.jobs.find((j) => j.record.jobId === before.jobId)!.publishing!;
    expect(intent).toMatchObject({ artifactIds: [expect.stringMatching(/^sha256:/)], targetRefs: ['output1'] });

    await restart();
    const job = manager.inspect(before.jobId);
    expect(job.state).toBe('completed');
    expect(generator.runs).toHaveLength(1);
    expect(videos.committed).toHaveLength(1);
    expect(job.result!.artifactId).toBe(intent.artifactIds[0]);
    expect(job.result).toMatchObject({ outputs: [{ assetId: 'ast_1_1' }] });
    expect(job.applications).toEqual([expect.objectContaining({ state: 'committed', artifactIds: intent.artifactIds })]);
    expectSettledOnce(job);
    expect(videos.leases).toBe(0);
    // 意图在结果与应用记下之后清掉。
    const after = JSON.parse(await fs.readFile(paths.jobsFile, 'utf8')) as { jobs: StoredJob[] };
    expect(after.jobs.find((j) => j.record.jobId === before.jobId)).not.toHaveProperty('publishing');
  });

  it('发布意图记下了、产物却不全：丢掉意图，按原来的矩阵处理（外发调用等对账，不重发）', async () => {
    crashAt = { point: 'artifact-stored' };
    const before = await speak();
    await fs.rm(paths.artifactsDir, { recursive: true, force: true });
    await restart();
    expect(manager.inspect(before.jobId)).toMatchObject({
      state: 'needs-reconciliation',
      result: null,
      grant: { settled: { basis: 'conservative' } },
    });
    expect(generator.runs).toHaveLength(1);
    expect(videos.committed).toHaveLength(0);
  });

  it('「已开始」落盘之后、记下 running 之前崩溃：重启时不当成没开始重新排队，等对账，预算保守扣一次', async () => {
    admission.crashAfterStart = true;
    const { jobId } = await manager.submitSynthesizeSpeech({ text: '一', videoId: 'mov_1' }, CONNECTION);
    await until(async () => admission.started.has('rsv_1') && (await stored(jobId))?.state === 'queued');
    // 进程没了：旧的 JobManager 丢下（它停在「已开始」之后），账本里还是排队。
    admission.crashAfterStart = false;

    await restart();
    expect(manager.inspect(jobId)).toMatchObject({
      state: 'needs-reconciliation',
      grant: { reservationId: 'rsv_1', settled: { basis: 'conservative', calls: 1 } },
    });
    expect(admission.admitted).toBe(1);
    expect(admission.settles).toEqual([{ reservationId: 'rsv_1', basis: 'conservative' }]);
  });

  it.each(['artifact-stored', 'artifact-published'] as const)(
    '智能体提交的任务在 %s 之后崩溃：重启后先查回执，没有提交过就不自动应用（它的 Run 已经结束），留给用户 apply',
    async (point) => {
      crashAt = { point };
      const before = await speak(AGENT);
      await restart();
      const job = manager.inspect(before.jobId);
      expect(job).toMatchObject({ state: 'cancelled', cancellation: { remote: 'not-applicable', cost: 'charged' } });
      expect(job.applications![0]!.state).toBe('cancelled');
      expect(videos.committed).toHaveLength(0);
      expect((await manager.reconcile(before.jobId, 'apply')).state).toBe('completed');
      expect(videos.committed).toHaveLength(1);
      expect(generator.runs).toHaveLength(1);
    },
  );

  it('智能体提交的任务提交后崩溃：查到回执照样补记（已经写了的就是写了）', async () => {
    crashAt = { point: 'application-committed' };
    const before = await speak(AGENT);
    await restart();
    expect(manager.inspect(before.jobId)).toMatchObject({ state: 'completed', applications: [{ receipt: { recovered: true } }] });
    expect(videos.committed).toHaveLength(1);
  });

  it('崩溃时在跑的外发调用 needs-reconciliation（预算保守扣），排队的重新校验后排队；retry', async () => {
    generator.hold();
    const running = await manager.submitSynthesizeSpeech({ text: '一', videoId: 'mov_1' }, CONNECTION);
    const queued = await manager.submitSynthesizeSpeech({ text: '二', videoId: 'mov_1' }, CONNECTION);
    const agent = await manager.submitSynthesizeSpeech({ text: '三', videoId: 'mov_1' }, AGENT);
    await until(async () => (await stored(running.jobId))?.state === 'running' && (await stored(agent.jobId))?.state === 'queued');
    // 进程没了：旧的 JobManager 丢下（它的生成永远不返回）。
    generator.release();
    // 只有第一个开始了；排队的只预留。
    expect([...admission.started]).toEqual(['rsv_1']);

    await restart();
    expect(manager.inspect(running.jobId)).toMatchObject({
      state: 'needs-reconciliation',
      error: { code: 'JOB_NEEDS_RECONCILIATION' },
      grant: { reservationId: 'rsv_1', settled: { basis: 'conservative', calls: 1 } },
    });
    // 智能体提交的排队任务：中断，不执行已经停止的旧 Run。
    expect(manager.inspect(agent.jobId)).toMatchObject({ state: 'interrupted', error: { code: 'JOB_INTERRUPTED' } });
    // 排队的重新准入（旧的预留释放），同一次尝试；跑完并应用。
    expect(await manager.settled(queued.jobId)).toBe('completed');
    const requeued = manager.inspect(queued.jobId);
    expect(requeued).toMatchObject({ attempt: 1, grant: { reservationId: 'rsv_4', settled: { basis: 'unknown' } } });
    expect(admission.settles).toEqual([
      { reservationId: 'rsv_1', basis: 'conservative' },
      { reservationId: 'rsv_2', basis: 'released' },
      { reservationId: 'rsv_3', basis: 'released' },
      { reservationId: 'rsv_4', basis: 'unknown' },
    ]);
    // 只有重新排队的跑了生成；needs-reconciliation 的从不自动重发。
    expect(generator.runs.map((r) => r.jobId)).toEqual([running.jobId, queued.jobId]);
    expect(videos.committed).toHaveLength(1);

    // 不合法的决定：结果不明的调用没有产物，不能 apply。
    expect(await manager.reconcile(running.jobId, 'apply').catch((e: unknown) => e)).toMatchObject({
      code: 'conflict',
      details: { code: 'RECONCILE_NOT_ALLOWED', state: 'needs-reconciliation', decision: 'apply', allowed: ['retry', 'discard'] },
    });
    // retry：同一个任务回到排队，attempt 加一，新的预留；上一次的保守结算留在历史里。
    const retried = await manager.reconcile(running.jobId, 'retry');
    expect(retried).toMatchObject({ state: 'queued', attempt: 2, error: null, result: null, grant: { reservationId: 'rsv_5' } });
    expect(retried.grant!.retries).toEqual([expect.objectContaining({ basis: 'conservative' })]);
    expect(await manager.settled(running.jobId)).toBe('completed');
    expect(generator.runs).toHaveLength(3);
    // interrupted 的智能体任务：用户可以 retry，不能 discard。
    expect(await manager.reconcile(agent.jobId, 'discard').catch((e: unknown) => e)).toMatchObject({
      details: { code: 'RECONCILE_NOT_ALLOWED', allowed: ['retry'] },
    });
    expect(await manager.reconcile(agent.jobId, 'retry')).toMatchObject({ state: 'queued', attempt: 2 });
    expect(await manager.settled(agent.jobId)).toBe('completed');
    expect(videos.committed).toHaveLength(3);
    expect(videos.leases).toBe(0);
  });

  it('discard：放弃结果不明的调用，记下三件事实，保守扣下的预算不退；视频没打开时 retry 拒绝', async () => {
    generator.hold();
    const { jobId } = await manager.submitSynthesizeSpeech({ text: '一', videoId: 'mov_1' }, CONNECTION);
    await until(async () => (await stored(jobId))?.state === 'running');
    generator.release();
    await restart();
    expect(await manager.reconcile(jobId, 'retry').catch((e: unknown) => e)).toMatchObject({
      code: 'not-found',
      details: { code: 'VIDEO_NOT_OPEN' },
    });
    const discarded = await manager.reconcile(jobId, 'discard');
    expect(discarded).toMatchObject({
      state: 'cancelled',
      error: null,
      cancellation: { remote: 'unknown', cost: 'possible' },
      grant: { settled: { basis: 'conservative' } },
    });
    expect(await manager.reconcile(jobId, 'discard').catch((e: unknown) => e)).toMatchObject({
      code: 'conflict',
      details: { code: 'RECONCILE_NOT_ALLOWED', allowed: [] },
    });
    expect(await manager.reconcile('job_none', 'discard').catch((e: unknown) => e)).toMatchObject({ code: 'not-found' });
    expect(generator.runs).toHaveLength(1);
    // 重启后仍是这个结果。
    await manager.shutdown();
    await restart();
    expect(manager.inspect(jobId)).toMatchObject({ state: 'cancelled', cancellation: { remote: 'unknown' } });
    expect(admission.settles).toHaveLength(1);
  });

  it('排队任务重启时视频目录不见了：失败（STALE_JOB_INPUT），不执行', async () => {
    generator.hold();
    const first = await manager.submitSynthesizeSpeech({ text: '一', videoId: 'mov_1' }, CONNECTION);
    const queued = await manager.submitSynthesizeSpeech({ text: '二', videoId: 'mov_1' }, CONNECTION);
    await until(async () => (await stored(first.jobId))?.state === 'running' && (await stored(queued.jobId))?.state === 'queued');
    generator.release();
    videos.gone = true;
    await restart();
    expect(manager.inspect(queued.jobId)).toMatchObject({ state: 'failed', error: { code: 'STALE_JOB_INPUT' } });
    expect(generator.runs).toHaveLength(1);
    expect(admission.settles).toContainEqual({ reservationId: 'rsv_2', basis: 'released' });
  });

  it('可查询的远端任务：失败的 failed、没到达的 interrupted、还在跑的等对账，从不重新提交', async () => {
    generator.hold();
    const ids: string[] = [];
    for (const text of ['一', '二', '三']) {
      const { jobId } = await manager.submitSynthesizeSpeech({ text }, CONNECTION);
      ids.push(jobId);
      await until(async () => (await stored(jobId))?.state === 'running');
      // 把这个「崩溃时在跑」的记录留在账本里，换一个新的 JobManager 造下一个。
      manager = create();
      await manager.open();
    }
    generator.release();
    // 给记录补上远端任务 ID（现有的适配器都没有，这里模拟一个支持查询的 Provider），恢复成崩溃时在跑的样子。
    const data = JSON.parse(await fs.readFile(paths.jobsFile, 'utf8')) as { jobs: StoredJob[] };
    expect(data.jobs.map((j) => j.record.state)).toEqual(['needs-reconciliation', 'needs-reconciliation', 'needs-reconciliation']);
    for (const job of data.jobs) {
      Object.assign(job.record, { state: 'running', error: null, endedAt: null });
      job.remoteTaskId = `remote_${ids.indexOf(job.record.jobId)}`;
    }
    await fs.writeFile(paths.jobsFile, JSON.stringify(data));
    const statuses: RemoteTaskStatus[] = [{ status: 'failed', message: '远端失败' }, { status: 'not-found' }, { status: 'running' }];
    const queried: string[] = [];
    remoteTasks = {
      supports: (providerId) => providerId === 'fake',
      query: async ({ remoteTaskId }) => {
        queried.push(remoteTaskId);
        return statuses[Number(remoteTaskId.split('_')[1])]!;
      },
    };
    await restart();
    expect(queried.sort()).toEqual(['remote_0', 'remote_1', 'remote_2']);
    expect(manager.inspect(ids[0]!)).toMatchObject({
      state: 'failed',
      error: { code: 'PROVIDER_REJECTED', details: { remoteTaskId: 'remote_0' } },
    });
    expect(manager.inspect(ids[1]!)).toMatchObject({ state: 'interrupted', error: { code: 'JOB_INTERRUPTED' } });
    expect(manager.inspect(ids[2]!)).toMatchObject({
      state: 'needs-reconciliation',
      error: { code: 'JOB_NEEDS_RECONCILIATION', details: { remoteTaskId: 'remote_2', remote: 'running' } },
    });
    expect(generator.runs).toHaveLength(3);
  });
});

describe('恢复矩阵与对账的规则', () => {
  const job = (patch: Partial<JobRecord>, spec: unknown = { capability: 'synthesizeSpeech' }): StoredJob => ({
    record: {
      jobId: 'job_1',
      kind: 'synthesizeSpeech',
      state: 'running',
      providerId: 'fake',
      submitter: CONNECTION,
      videoId: 'mov_1',
      parentJobId: null,
      result: null,
      ...patch,
    } as JobRecord,
    spec: spec as StoredJob['spec'],
    workerVersion: null,
  });
  const app = (state: string) => ({ state }) as NonNullable<JobRecord['applications']>[number];

  it('按停在哪里决定', () => {
    expect(recoveryAction(job({ state: 'completed' }), undefined, undefined)).toEqual({ kind: 'keep' });
    expect(recoveryAction(job({ state: 'queued' }), undefined, undefined)).toEqual({ kind: 'requeue' });
    expect(recoveryAction(job({ state: 'queued', submitter: AGENT }), undefined, undefined)).toEqual({ kind: 'interrupt' });
    expect(recoveryAction(job({ state: 'queued', submitter: { kind: 'node', id: 'nod_1' } }), undefined, undefined)).toEqual({
      kind: 'interrupt',
    });
    expect(recoveryAction(job({ providerId: 'local' }), undefined, undefined)).toEqual({ kind: 'interrupt' });
    expect(recoveryAction(job({ providerId: 'node:nod_1' }), undefined, undefined)).toEqual({ kind: 'interrupt' });
    expect(recoveryAction(job({}), undefined, undefined)).toEqual({ kind: 'reconcile' });
    // 不能由用户重试的在线调用只是中断：固定流程的步骤、没有视频的转写、不经模型的任务。
    expect(recoveryAction(job({ parentJobId: 'job_p' }), undefined, undefined)).toEqual({ kind: 'interrupt' });
    expect(recoveryAction(job({ kind: 'transcribe', videoId: null }, { track: 0 }), undefined, undefined)).toEqual({ kind: 'interrupt' });
    expect(recoveryAction(job({ kind: 'export' }, { task: 'export' }), undefined, undefined)).toEqual({ kind: 'interrupt' });
    expect(recoveryAction(job({}, { hosted: { kind: 'export' } }), undefined, undefined)).toEqual({ kind: 'interrupt' });
    const remote: RemoteTaskQuery = { supports: (id) => id === 'fake', query: async () => ({ status: 'running' }) };
    expect(recoveryAction({ ...job({}), remoteTaskId: 'r1' }, undefined, remote)).toEqual({ kind: 'query-remote', remoteTaskId: 'r1' });
    expect(recoveryAction({ ...job({ providerId: 'other' }), remoteTaskId: 'r1' }, undefined, remote)).toEqual({ kind: 'reconcile' });
    // 应用没有结束的，先补做应用。
    expect(recoveryAction(job({}), app('validating'), undefined)).toEqual({ kind: 'resume-application' });
    expect(recoveryAction(job({ state: 'completed' }), app('committed'), undefined)).toEqual({ kind: 'keep' });
  });

  it('取消的三件事实', () => {
    const at = '2026-01-01T00:00:00.000Z';
    expect(cancellationFacts({ providerId: 'fake' }, 'queued', at, { now: at })).toEqual({
      requestedAt: at,
      localStoppedAt: at,
      remote: 'not-submitted',
      cost: 'none',
    });
    expect(cancellationFacts({ providerId: 'local' }, 'queued', at)).toMatchObject({ remote: 'not-applicable', cost: 'none' });
    expect(cancellationFacts({ providerId: 'fake' }, 'running', at)).toMatchObject({ remote: 'cancel-unsupported', cost: 'possible' });
    expect(cancellationFacts({ providerId: 'node:nod_1' }, 'running', at)).toMatchObject({ remote: 'unknown', cost: 'none' });
    expect(cancellationFacts({ providerId: 'node:nod_1' }, 'running', at, { confirmed: true })).toMatchObject({ remote: 'cancelled' });
    expect(cancellationFacts({ providerId: 'fake' }, 'after-result', at)).toMatchObject({ remote: 'not-applicable', cost: 'charged' });
    expect(cancellationFacts({ providerId: 'local' }, 'after-result', at)).toMatchObject({ cost: 'none' });
    expect(cancellationFacts({ providerId: 'fake' }, 'unknown', at)).toMatchObject({ remote: 'unknown', cost: 'possible' });
  });

  it('对账决定只在合法的状态下可用', () => {
    expect(reconcileChoices(job({ state: 'needs-reconciliation' }), undefined)).toEqual(['retry', 'discard']);
    expect(reconcileChoices(job({ state: 'interrupted' }), undefined)).toEqual(['retry']);
    expect(reconcileChoices(job({ state: 'interrupted', submitter: { kind: 'pipeline', id: 'job_p' } }), undefined)).toEqual([]);
    expect(reconcileChoices(job({ state: 'needs-reconciliation', parentJobId: 'job_p' }), undefined)).toEqual(['discard']);
    expect(reconcileChoices(job({ state: 'completed' }), undefined)).toEqual([]);
    const result = { artifactId: 'sha256:x' } as unknown as JobRecord['result'];
    expect(reconcileChoices(job({ state: 'failed', result }), app('stale-input'))).toEqual(['apply']);
    expect(reconcileChoices(job({ state: 'failed', result }), app('rejected'))).toEqual(['apply']);
    expect(reconcileChoices(job({ state: 'cancelled', result }), app('cancelled'))).toEqual(['apply']);
    expect(reconcileChoices(job({ state: 'completed', result }), app('committed'))).toEqual([]);
    expect(reconcileChoices(job({ state: 'failed', result: null }), app('stale-input'))).toEqual([]);
    expect(reconcileChoices(job({ state: 'failed', result, videoId: null }), app('stale-input'))).toEqual([]);
    // 转写：有视频的可以重试，没有视频的（模型接口服务的转写）不行。
    const transcribe = { track: 0 };
    expect(reconcileChoices(job({ state: 'interrupted', kind: 'transcribe' }, transcribe), undefined)).toEqual(['retry']);
    expect(reconcileChoices(job({ state: 'interrupted', kind: 'transcribe', videoId: null }, transcribe), undefined)).toEqual([]);
  });
});
