import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyJobsEvent, applyModelsEvent } from '@baocut/client';
import { FAKE_MODEL_WORKER } from '@baocut/jobs';
import { BUNDLES, INSTALL_RECORD_FILE, MOVE_JOURNAL_FILE, defaultTranscribeBundle } from '@baocut/models';
import { syntheticBytes, writeSyntheticRepo, type SyntheticRepo } from '@baocut/models/testing';
import { RpcError, WEB_DEFAULT_METHODS, WEB_READ_METHODS, type JobRecord, type JobsSnapshot, type ModelsSnapshot } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { until } from '../agent-tools/testing/fake-agent.ts';

/**
 * 模型目录端到端（架构设计 §6.3）：网关的 `models.getDir / inspectDir / setDir` → 模型目录服务 → 盘上的移动与回滚。
 * 模型是临时目录里合成的仓库（带清单的小文件），不碰真实的模型目录。临时目录都在同一块盘上，跨盘的复制与校验由
 * `@baocut/models` 的单元测试覆盖。
 */

/** 这台机器上的默认转写模型包：Apple Silicon 是 MLX 的，别的平台是 candle 的（同样的仓库）。 */
const DEFAULT_TRANSCRIBE_BUNDLE = defaultTranscribeBundle(process.platform, process.arch);

const def = BUNDLES.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!;
const repos: SyntheticRepo[] = [
  {
    repo: def.components.asr!.repo,
    revision: def.components.asr!.revision,
    files: { 'config.json': Buffer.from('{"synthetic":"asr"}'), 'model.safetensors': syntheticBytes(40_000, 21) },
  },
  {
    repo: def.components.vad!.repo,
    revision: def.components.vad!.revision,
    files: { 'config.json': Buffer.from('{}'), 'model.safetensors': syntheticBytes(6_000, 22) },
  },
  // 可选的对齐器：装了就是模型包的一部分，随目录一起移动。
  {
    repo: def.components.aligner!.repo,
    revision: def.components.aligner!.revision,
    files: { 'config.json': Buffer.from('{"synthetic":"aligner"}'), 'model.safetensors': syntheticBytes(3_000, 23) },
  },
];
const TOTAL = repos.reduce((sum, r) => sum + Object.values(r.files).reduce((s, b) => s + b.length, 0), 0);

interface Side {
  control: string;
  home: RuntimeHome;
  runtime: RunningRuntime;
  client: BaoCutClient;
  jobs: () => JobsSnapshot | null;
  models: () => ModelsSnapshot | null;
}

let tmp: string;
let side: Side | undefined;
const free = { bytes: (10 * 1024 * 1024 * 1024) as number | null };
/** 每个仓库放到位之前调一次：测试在这里卡住移动、或注入失败。 */
let beforePlace: (repo: string) => Promise<void> | void = () => {};
/** 临时目录都在同一块盘上；置为 false 时假装跨盘（复制、校验、删原文件）。 */
let sameDisk = true;
/** 卡住的移动在测试失败时也要放开，否则 Runtime 停不下来。 */
let releaseGate: () => void = () => {};

async function startSide(env: Record<string, string> = {}): Promise<Side> {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(tmp, 'home'), ...env });
  const control = path.join(tmp, 'fake-worker-control.json');
  await fs.writeFile(control, '{}');
  const runtime = await startRuntime({
    home,
    drivers: () => [],
    watchSpace: false,
    engineHost: null,
    modelWorker: { command: process.execPath, args: [FAKE_MODEL_WORKER, '--control', control] },
    jobIdleMs: 60_000,
    modelInstall: { installer: { freeBytes: async () => free.bytes } },
    modelsDirTesting: { beforePlace: (repo) => beforePlace(repo), sameVolume: async () => sameDisk },
  });
  const { endpoint, token } = runtime.discovery;
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint, token }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
  });
  await client.connect();
  let jobs: JobsSnapshot | null = null;
  let models: ModelsSnapshot | null = null;
  client.subscribeJobs({ snapshot: (s) => (jobs = s), event: (e) => (jobs = applyJobsEvent(jobs!, e)) });
  client.subscribeModels({ snapshot: (s) => (models = s), event: (e) => (models = applyModelsEvent(models!, e)) });
  await until(() => jobs && models);
  return { control, home, runtime, client, jobs: () => jobs, models: () => models };
}

async function stopSide(): Promise<void> {
  if (!side) return;
  side.client.close();
  await side.runtime.close();
  side = undefined;
}

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );
const rejection = async (promise: Promise<unknown>): Promise<RpcError> => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RpcError);
  return error as RpcError;
};
const codeOf = (error: RpcError) => (error.details as { code?: string } | undefined)?.code;
const bundleState = (s: Side) => s.models()?.bundles.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE);
const jobOf = (s: Side, jobId: string): JobRecord | undefined => s.jobs()?.jobs.find((j) => j.jobId === jobId);
const terminal = (job: JobRecord | undefined) => job && ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state) && job;
const repoDir = (root: string, repo: string) => path.join(root, ...repo.split('/'));

describe('模型目录', () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-models-dir-e2e-'));
    free.bytes = 10 * 1024 * 1024 * 1024;
    beforePlace = () => {};
    sameDisk = true;
    releaseGate = () => {};
  });

  afterEach(async () => {
    releaseGate();
    await stopSide();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('缺省目录；查看别的文件夹时认出已有的模型、不写入；只切换后模型照常可用并在重启后保持', async () => {
    side = await startSide();
    const defaultDir = path.join(tmp, 'home', 'models');
    const info = await side.client.request('models.getDir', {});
    expect(info).toMatchObject({
      path: defaultDir,
      source: 'default',
      defaultPath: defaultDir,
      exists: true,
      writable: true,
      usedBytes: 0,
      modelCount: 0,
      moveJobId: null,
    });

    const other = path.join(tmp, 'other');
    await fs.mkdir(other);
    for (const repo of repos) await writeSyntheticRepo(other, repo);
    const before = await fs.readdir(other);
    const inspection = await side.client.request('models.inspectDir', { path: other });
    expect(inspection).toMatchObject({ path: other, exists: true, writable: true, problem: null, freeBytes: free.bytes });
    expect(inspection.found.bundleIds).toContain(DEFAULT_TRANSCRIBE_BUNDLE);
    expect(inspection.found.bytes).toBe(TOTAL);
    expect(inspection.move).toMatchObject({ requiredBytes: 0, sameVolume: true, fits: true });
    expect(await fs.readdir(other)).toEqual(before);

    const result = await side.client.request('models.setDir', { path: other, mode: 'switch' });
    expect(result.jobId).toBeNull();
    expect(result.dir).toMatchObject({ path: other, source: 'setting', usedBytes: TOTAL });
    await until(() => bundleState(side!)?.components?.every((c) => c.state === 'installed'));
    expect((await side.client.request('settings.get', {})).settings['models.dir']).toBe(other);

    // 设置页的通用写法不能改它。
    const managed = await rejection(side.client.request('settings.set', { values: { 'models.dir': defaultDir } }));
    expect(codeOf(managed)).toBe('SETTING_MANAGED');

    await stopSide();
    side = await startSide();
    expect(await side.client.request('models.getDir', {})).toMatchObject({ path: other, source: 'setting', modelCount: 1 });

    // 恢复缺省：缺省目录是空的，只切换。
    const back = await side.client.request('models.setDir', { path: null, mode: 'switch' });
    expect(back.dir).toMatchObject({ path: defaultDir, source: 'default', usedBytes: 0 });
    expect((await side.client.request('settings.get', {})).settings['models.dir']).toBeNull();
    expect(await exists(repoDir(other, repos[0]!.repo))).toBe(true);
  });

  it.each([
    ['同一块盘', true],
    ['跨盘', false],
  ])('移动（%s）：作为任务按字节报告进度，期间模型不可用、不能再改；完成后换到新位置、删掉原目录里的文件', async (_label, same) => {
    sameDisk = same;
    side = await startSide();
    const defaultDir = path.join(tmp, 'home', 'models');
    for (const repo of repos) await writeSyntheticRepo(defaultDir, repo);
    await fs.writeFile(path.join(defaultDir, 'not-a-model.txt'), 'keep me');
    const target = path.join(tmp, 'target');
    await fs.mkdir(target);
    const inspection = await side.client.request('models.inspectDir', { path: target });
    expect(inspection.current.bytes).toBe(TOTAL);
    expect(inspection.move).toMatchObject({ requiredBytes: TOTAL, sameVolume: same, fits: true });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    releaseGate = release;
    let reached = false;
    beforePlace = async () => {
      reached = true;
      await gate;
    };
    const { jobId, dir } = await side.client.request('models.setDir', { path: target, mode: 'move' });
    expect(jobId).toBeTruthy();
    expect(dir.path).toBe(defaultDir);
    await until(() => reached);
    expect(await side.client.request('models.getDir', {})).toMatchObject({ moveJobId: jobId, moveTo: target });
    await until(() => bundleState(side!)?.reason === 'relocating');
    expect(jobOf(side, jobId!)).toMatchObject({ kind: 'modelsMove', state: 'running' });
    await until(() => jobOf(side!, jobId!)?.progress?.total === TOTAL);
    expect(jobOf(side, jobId!)).toMatchObject({ phase: same ? 'moving' : 'publishing', progress: { unit: 'bytes', total: TOTAL } });

    const busy = await rejection(side.client.request('models.setDir', { path: null, mode: 'switch' }));
    expect(codeOf(busy)).toBe('MODEL_IN_USE');
    expect((busy.details as { jobIds: string[] }).jobIds).toContain(jobId);
    const install = await rejection(side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE }));
    expect(codeOf(install)).toBe('MODEL_IN_USE');

    release();
    const job = await until(() => terminal(jobOf(side!, jobId!)));
    expect(job.state).toBe('completed');
    const info = await side.client.request('models.getDir', {});
    expect(info).toMatchObject({ path: target, source: 'setting', usedBytes: TOTAL, modelCount: 1, moveJobId: null });
    await until(() => bundleState(side!)?.components?.every((c) => c.state === 'installed'));
    for (const repo of repos) {
      expect(await exists(repoDir(target, repo.repo))).toBe(true);
      expect(await exists(repoDir(defaultDir, repo.repo))).toBe(false);
    }
    expect(await exists(path.join(defaultDir, 'not-a-model.txt'))).toBe(true);
    expect(await exists(path.join(defaultDir, MOVE_JOURNAL_FILE))).toBe(false);
    expect(await exists(path.join(defaultDir, INSTALL_RECORD_FILE))).toBe(false);
  });

  it('移动中途失败时回滚：设置与目录不变，模型照常可用', async () => {
    side = await startSide();
    const defaultDir = path.join(tmp, 'home', 'models');
    for (const repo of repos) await writeSyntheticRepo(defaultDir, repo);
    const target = path.join(tmp, 'target');
    await fs.mkdir(target);
    beforePlace = (repo) => {
      if (repo === repos[1]!.repo) throw new Error('注入的失败');
    };
    const { jobId } = await side.client.request('models.setDir', { path: target, mode: 'move' });
    const job = await until(() => terminal(jobOf(side!, jobId!)));
    expect(job).toMatchObject({ state: 'failed', error: { code: 'MODELS_DIR_MOVE_FAILED' } });
    expect(await side.client.request('models.getDir', {})).toMatchObject({
      path: defaultDir,
      source: 'default',
      usedBytes: TOTAL,
      moveJobId: null,
    });
    expect((await side.client.request('settings.get', {})).settings['models.dir']).toBeNull();
    for (const repo of repos) {
      expect(await exists(repoDir(defaultDir, repo.repo))).toBe(true);
      expect(await exists(repoDir(target, repo.repo))).toBe(false);
    }
    await until(() => bundleState(side!)?.reason !== 'relocating');
  });

  it('拒绝：不存在、不能写、互相包含、放不下', async () => {
    side = await startSide();
    const defaultDir = path.join(tmp, 'home', 'models');
    for (const repo of repos) await writeSyntheticRepo(defaultDir, repo);

    const missing = path.join(tmp, 'missing');
    expect((await side.client.request('models.inspectDir', { path: missing })).problem).toBe('missing');
    expect(codeOf(await rejection(side.client.request('models.setDir', { path: missing, mode: 'switch' })))).toBe('MODELS_DIR_MISSING');

    const nested = path.join(defaultDir, 'inner');
    await fs.mkdir(nested);
    expect(codeOf(await rejection(side.client.request('models.setDir', { path: nested, mode: 'move' })))).toBe('MODELS_DIR_NESTED');

    if (process.getuid?.() !== 0) {
      const locked = path.join(tmp, 'locked');
      await fs.mkdir(locked);
      await fs.chmod(locked, 0o555);
      expect((await side.client.request('models.inspectDir', { path: locked })).problem).toBe('not-writable');
      expect(codeOf(await rejection(side.client.request('models.setDir', { path: locked, mode: 'move' })))).toBe('MODELS_DIR_NOT_WRITABLE');
      await fs.chmod(locked, 0o755);
    }

    // 放不下：同一块盘时改名不占空间；跨盘时要能放下要移动的全部字节。只切换不受影响。
    free.bytes = 100;
    const small = path.join(tmp, 'small');
    await fs.mkdir(small);
    expect((await side.client.request('models.inspectDir', { path: small })).move).toMatchObject({
      requiredBytes: TOTAL,
      sameVolume: true,
      fits: true,
    });
    sameDisk = false;
    expect((await side.client.request('models.inspectDir', { path: small })).move).toMatchObject({
      requiredBytes: TOTAL,
      sameVolume: false,
      fits: false,
    });
    const nospace = await rejection(side.client.request('models.setDir', { path: small, mode: 'move' }));
    expect(codeOf(nospace)).toBe('MODELS_DIR_NO_SPACE');
    expect(nospace.details).toMatchObject({ requiredBytes: TOTAL, availableBytes: 100 });
    expect(await side.client.request('models.getDir', {})).toMatchObject({ path: defaultDir });
    expect((await side.client.request('models.setDir', { path: small, mode: 'switch' })).dir).toMatchObject({ path: small, usedBytes: 0 });
  });

  // 自检要用默认的转写模型包（MLX），只在 Apple Silicon 的 macOS 上能跑。
  it('有任务在用本地模型时拒绝（MODEL_IN_USE），结束后卸下空闲的 Worker 再换', async () => {
    side = await startSide();
    const defaultDir = path.join(tmp, 'home', 'models');
    for (const repo of repos) await writeSyntheticRepo(defaultDir, repo);
    const other = path.join(tmp, 'other');
    await fs.mkdir(other);
    for (const repo of repos) await writeSyntheticRepo(other, repo);

    await fs.writeFile(side.control, JSON.stringify({ faults: ['slow'] }));
    const { jobId: testJob } = await side.client.request('models.test', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    await until(() => jobOf(side!, testJob)?.progress, 10_000);
    for (const mode of ['switch', 'move'] as const) {
      const refused = await rejection(side.client.request('models.setDir', { path: other, mode }));
      expect(refused.details).toMatchObject({ code: 'MODEL_IN_USE', jobIds: [testJob] });
    }
    expect((await side.client.request('models.getDir', {})).path).toBe(defaultDir);

    await side.client.request('jobs.cancel', { jobId: testJob });
    await until(() => terminal(jobOf(side!, testJob)));
    // Worker 还加载着模型（空闲）：换目录时先卸下。
    await fs.writeFile(side.control, '{}');
    const result = await side.client.request('models.setDir', { path: other, mode: 'switch' });
    expect(result.dir).toMatchObject({ path: other, modelCount: 1 });
    const { jobId: again } = await side.client.request('models.test', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect((await until(() => terminal(jobOf(side!, again)), 15_000)).state).toBe('completed');
  });

  it('环境变量指定时只读', async () => {
    const envDir = path.join(tmp, 'env-models');
    await fs.mkdir(envDir);
    side = await startSide({ BAOCUT_MODELS_DIR: envDir });
    expect(await side.client.request('models.getDir', {})).toMatchObject({ path: envDir, source: 'env' });
    const other = path.join(tmp, 'other');
    await fs.mkdir(other);
    expect(codeOf(await rejection(side.client.request('models.setDir', { path: other, mode: 'switch' })))).toBe('MODELS_DIR_ENV_LOCKED');
    expect(codeOf(await rejection(side.client.request('models.setDir', { path: null, mode: 'switch' })))).toBe('MODELS_DIR_ENV_LOCKED');
  });

  it('不对浏览器开放', () => {
    for (const method of ['models.getDir', 'models.inspectDir', 'models.setDir']) {
      expect(WEB_DEFAULT_METHODS).not.toContain(method);
      expect(WEB_READ_METHODS).not.toContain(method);
    }
  });
});
