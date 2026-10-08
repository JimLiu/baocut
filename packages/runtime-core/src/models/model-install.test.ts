import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyJobsEvent, applyModelsEvent } from '@baocut/client';
import { FAKE_MODEL_WORKER } from '@baocut/jobs';
import { BUNDLES, MODELS_ENDPOINT_ENV, MODEL_ASSETS_ENV, defaultTranscribeBundle, resolveModelAssetsDir } from '@baocut/models';
import {
  serveRepo,
  startFakeModelSource,
  syntheticBytes,
  syntheticManifest,
  type FakeModelSource,
  type SyntheticRepo,
} from '@baocut/models/testing';
import {
  RpcError,
  newId,
  type JobRecord,
  type JobsSnapshot,
  type ModelBundleStatus,
  type ModelsEvent,
  type ModelsSnapshot,
} from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { ToolDriver, mcp, tool, until } from '../agent-tools/testing/fake-agent.ts';

/**
 * 模型安装端到端（架构设计 §6.3）：网关的 `models.install / cancelInstall / repair / remove / test` → JobManager → 下载器 →
 * 本机回环地址上的假模型来源（合成的仓库与清单）；自检走假的 Model Worker。模型目录是临时目录，不访问真实网络、不下载
 * 真实的模型。转写用这台机器默认的模型包（Apple Silicon 是 MLX 的，别的平台是 candle 的）；语音合成的模型包是 MLX 的，
 * 只在 Apple Silicon 的 macOS 上测。
 */

/** 这台机器上的默认转写模型包：Apple Silicon 是 MLX 的，别的平台是 candle 的（同样的仓库）。 */
const DEFAULT_TRANSCRIBE_BUNDLE = defaultTranscribeBundle(process.platform, process.arch);

const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
if (!appleSilicon) console.warn('跳过语音合成模型包的安装测试：它们是 MLX 的，只在 Apple Silicon 的 macOS 上可用');

const def = BUNDLES.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!;
const repos: SyntheticRepo[] = [
  {
    repo: def.components.asr!.repo,
    revision: def.components.asr!.revision,
    files: { 'config.json': Buffer.from('{"synthetic":"asr"}'), 'model.safetensors': syntheticBytes(400_000, 11) },
  },
  {
    repo: def.components.vad!.repo,
    revision: def.components.vad!.revision,
    files: { 'config.json': Buffer.from('{}'), 'model.safetensors': syntheticBytes(60_000, 12) },
  },
  // 可选的对齐器：安装与修复照样下载它。
  {
    repo: def.components.aligner!.repo,
    revision: def.components.aligner!.revision,
    files: { 'config.json': Buffer.from('{"synthetic":"aligner"}'), 'model.safetensors': syntheticBytes(30_000, 14) },
  },
];
/** 本地语音合成：只有一个组件的模型包，自检用默认声音合成一句（假 Worker 写 1 秒的正弦 WAV，`silent-output` 时是静音）。 */
const SPEECH_BUNDLE = 'voxcpm2@mlx-int8';
const speechDef = BUNDLES.find((b) => b.bundleId === SPEECH_BUNDLE)!;
const speechRepo: SyntheticRepo = {
  repo: speechDef.components.tts!.repo,
  revision: speechDef.components.tts!.revision,
  files: { 'config.json': Buffer.from('{"synthetic":"tts"}'), 'model.safetensors': syntheticBytes(80_000, 13) },
};
/** 本地文生图：整个仓库是一个 `image` 组件，自检用固定的提示词与 seed 少步数生成一张 256² 的图（假 Worker 写渐变 PNG）。 */
const IMAGE_BUNDLE = 'qwen-image-2.1@mlx-4bit';
const imageDef = BUNDLES.find((b) => b.bundleId === IMAGE_BUNDLE)!;
const imageRepo: SyntheticRepo = {
  repo: imageDef.components.image!.repo,
  revision: imageDef.components.image!.revision,
  files: { 'model_index.json': Buffer.from('{"synthetic":"image"}'), 'vae/model.safetensors': syntheticBytes(50_000, 15) },
};
/** 本地人声分离：只有 `separator` 一个组件，自检把识别的样本分成两路（假 Worker 写人声与低 12 dB 的背景）。 */
const SEPARATE_BUNDLE = 'htdemucs-ft@mlx';
const separateDef = BUNDLES.find((b) => b.bundleId === SEPARATE_BUNDLE)!;
const separateRepo: SyntheticRepo = {
  repo: separateDef.components.separator!.repo,
  revision: separateDef.components.separator!.revision,
  files: { 'htdemucs_ft_config.json': Buffer.from('{"synthetic":"sep"}'), 'htdemucs_ft.safetensors': syntheticBytes(50_000, 15) },
};
/** 「说话人区分」模型包（这台机器上默认转写模型包用的那个）：Pyannote 分段与 WeSpeaker 两个组件，没有单独的检查。 */
const diarizationDef = BUNDLES.find((b) => b.bundleId === def.diarization)!;
const diarizationRepos: SyntheticRepo[] = [
  {
    repo: diarizationDef.components.segmentation!.repo,
    revision: diarizationDef.components.segmentation!.revision,
    files: { 'config.json': Buffer.from('{"synthetic":"seg"}'), 'model.safetensors': syntheticBytes(20_000, 16) },
  },
  {
    repo: diarizationDef.components.speaker!.repo,
    revision: diarizationDef.components.speaker!.revision,
    files: { 'config.json': Buffer.from('{"synthetic":"spk"}'), 'model.safetensors': syntheticBytes(20_000, 17) },
  },
];
const TOTAL = repos.reduce((sum, r) => sum + Object.values(r.files).reduce((s, b) => s + b.length, 0), 0);

interface Side {
  dir: string;
  home: RuntimeHome;
  runtime: RunningRuntime;
  client: BaoCutClient;
  driver: ToolDriver;
  control: string;
  jobs: () => JobsSnapshot | null;
  models: () => ModelsSnapshot | null;
  modelEvents: ModelsEvent[];
}

async function startSide(source: FakeModelSource, free: { bytes: number | null }): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-model-install-'));
  const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  const control = path.join(dir, 'fake-worker-control.json');
  await fs.writeFile(control, '{}');
  const driver = new ToolDriver();
  const runtime = await startRuntime({
    home,
    drivers: () => [driver],
    watchSpace: false,
    engineHost: null,
    modelWorker: { command: process.execPath, args: [FAKE_MODEL_WORKER, '--control', control] },
    jobIdleMs: 60_000,
    modelInstall: {
      env: { [MODELS_ENDPOINT_ENV]: source.endpoint },
      installer: {
        manifests: [...repos, ...diarizationRepos, speechRepo, imageRepo, separateRepo].map((r) => syntheticManifest(r)),
        freeBytes: async () => free.bytes,
        backoffMs: () => 5,
      },
    },
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
  const modelEvents: ModelsEvent[] = [];
  client.subscribeJobs({
    snapshot: (snapshot) => (jobs = snapshot),
    event: (event) => (jobs = applyJobsEvent(jobs!, event)),
  });
  client.subscribeModels({
    snapshot: (snapshot) => (models = snapshot),
    event: (event) => {
      modelEvents.push(event);
      models = applyModelsEvent(models!, event);
    },
  });
  await until(() => jobs && models);
  return { dir, home, runtime, client, driver, control, jobs: () => jobs, models: () => models, modelEvents };
}

async function stopSide(side: Side | undefined): Promise<void> {
  if (!side) return;
  side.client.close();
  await side.runtime.close();
  await fs.rm(side.dir, { recursive: true, force: true });
}

const bundleOf = (side: Side): ModelBundleStatus | undefined =>
  side.models()?.bundles.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE);
const jobOf = (side: Side, jobId: string): JobRecord | undefined => side.jobs()?.jobs.find((j) => j.jobId === jobId);
const terminal = (job: JobRecord | undefined) => job && ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state) && job;

describe('模型安装（假模型来源 + 假 Model Worker）', () => {
  let source: FakeModelSource;
  let side: Side | undefined;
  const free = { bytes: (10 * 1024 * 1024 * 1024) as number | null };

  beforeEach(async () => {
    source = await startFakeModelSource();
    for (const repo of [...repos, ...diarizationRepos, speechRepo, imageRepo, separateRepo]) serveRepo(source, repo);
    free.bytes = 10 * 1024 * 1024 * 1024;
  });

  afterEach(async () => {
    await stopSide(side);
    side = undefined;
    await source.close();
  });

  it('两步安装：先给大小，确认后是普通任务；进度在 jobs 主题（字节），状态在 models 主题；取消即暂停，再装续传；自检通过', async () => {
    side = await startSide(source, free);
    expect(bundleOf(side)).toMatchObject({ state: 'not-installed', reason: 'missing-manifest' });

    // 第一步：只给计划，不创建任务。
    const first = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(first.jobId).toBeNull();
    expect(first.plan).toMatchObject({
      downloadBytes: TOTAL,
      confirmBytes: TOTAL,
      resumedBytes: 0,
      source: source.endpoint,
      upToDate: false,
    });
    expect((await side.client.request('jobs.list', {})).jobs).toEqual([]);

    // 字节数对不上：拒绝并给新的计划。
    const changed = await side.client
      .request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE, confirmBytes: TOTAL + 1 })
      .catch((e: unknown) => e);
    expect(changed).toBeInstanceOf(RpcError);
    expect(changed).toMatchObject({ code: 'conflict', details: { code: 'MODEL_INSTALL_SIZE_CHANGED', plan: { confirmBytes: TOTAL } } });

    // 第二步：确认。下载放慢，好在中途取消。
    source.throttle(8 * 1024, 20);
    const submitted = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE, confirmBytes: TOTAL });
    const jobId = submitted.jobId!;
    expect(jobId).toMatch(/^job_/);
    // 同一个模型包正在安装：再提交返回同一个任务。
    expect((await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE, confirmBytes: TOTAL })).jobId).toBe(jobId);

    const downloading = await until(() => {
      const job = jobOf(side!, jobId);
      return job?.phase === 'downloading' && job.progress && job.progress.done > 20_000 && job;
    });
    expect(downloading).toMatchObject({
      kind: 'modelInstall',
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      progress: { unit: 'bytes', total: TOTAL },
    });
    expect(downloading.submitter).toMatchObject({ kind: 'connection' });
    const status = await until(() => bundleOf(side!)?.state === 'downloading' && bundleOf(side!));
    expect(status.install).toMatchObject({ jobId, state: 'downloading', totalBytes: TOTAL });
    expect(side.modelEvents.some((e) => e.type === 'bundle.updated' && e.bundle.state === 'downloading')).toBe(true);
    // 下载中不能自检。
    const busy = await side.client.request('models.test', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE }).catch((e: unknown) => e);
    expect(busy).toMatchObject({ code: 'conflict', details: { code: 'MODEL_UNAVAILABLE' } });

    // 取消：任务 cancelled，暂存区留着，模型包报告暂停。
    const cancelled = await side.client.request('models.cancelInstall', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(cancelled.bundle).toMatchObject({ state: 'not-installed', install: { state: 'paused', jobId: null, totalBytes: TOTAL } });
    const paused = cancelled.bundle.install!.receivedBytes;
    expect(paused).toBeGreaterThan(0);
    expect(paused).toBeLessThan(TOTAL);
    expect((await until(() => terminal(jobOf(side!, jobId)))).state).toBe('cancelled');
    await until(() => bundleOf(side!)?.install?.state === 'paused');

    // 再装：只算剩下的字节，续传。
    source.throttle(64 * 1024, 0);
    const again = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(again.plan.resumedBytes).toBe(paused);
    expect(again.plan.downloadBytes).toBe(TOTAL - paused);
    const before = source.requests.length;
    const resumed = await side.client.request('models.install', {
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      confirmBytes: again.plan.confirmBytes,
    });
    const done = await until(() => terminal(jobOf(side!, resumed.jobId!)));
    expect(done.state).toBe('completed');
    expect(done.result).toMatchObject({ documentId: null, artifactId: expect.any(String) });
    expect(source.requests.slice(before).some((r) => r.range !== null)).toBe(true);
    await until(() => bundleOf(side!)?.state === 'installed');
    expect(bundleOf(side!)!.install).toBeUndefined();
    const listed = (await side.client.request('models.list', {})).bundles.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!;
    expect(listed).toMatchObject({ state: 'installed' });
    expect(listed.components!.map((c) => c.state)).toEqual(['installed', 'installed', 'installed']);
    // 本机转写的能力随之可用。
    await until(async () => {
      const { capabilities } = await side!.client.request('models.capabilities', {});
      const local = capabilities.transcribe.providers.find((p) => p.providerId === 'local');
      return local?.available === true;
    });
    expect((await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE })).plan.upToDate).toBe(true);

    // 自检：样本走完整的 Worker 流程，结果记在模型包上。
    const { jobId: testJob } = await side.client.request('models.test', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    const tested = await until(() => terminal(jobOf(side!, testJob)), 15_000);
    expect(tested).toMatchObject({ kind: 'modelTest', state: 'completed', bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(tested.result).toMatchObject({ documentId: null, artifactId: expect.any(String) });
    const selfTest = await until(() => bundleOf(side!)?.selfTest);
    expect(selfTest).toMatchObject({ state: 'passed', jobId: testJob });
    expect(selfTest.detail).toContain('testing one two three');
    // 两种任务都不属于智能体任务。
    expect(side.jobs()!.jobs.every((j) => j.submitter.kind === 'connection')).toBe(true);
  });

  it('删除：自检进行中拒绝（MODEL_IN_USE），结束后删除；修复只补缺的文件；严格离线拒绝下载', async () => {
    side = await startSide(source, free);
    const plan = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    const { jobId } = await side.client.request('models.install', {
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      confirmBytes: plan.plan.confirmBytes,
    });
    expect((await until(() => terminal(jobOf(side!, jobId!)))).state).toBe('completed');

    // 修复：删掉一个文件、改坏另一个（同样大小），只重下这两个。
    const asrDir = path.join(side.home.modelsDir, ...repos[0]!.repo.split('/'));
    await fs.rm(path.join(asrDir, 'config.json'));
    const weights = Buffer.from(repos[0]!.files['model.safetensors']!);
    weights[0] = weights[0]! ^ 0xff;
    await fs.writeFile(path.join(asrDir, 'model.safetensors'), weights);
    const repair = await side.client.request('models.repair', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(repair.plan.components.map((c) => [c.component, c.action, c.files])).toEqual([
      ['asr', 'download', ['config.json', 'model.safetensors']],
      ['vad', 'keep', []],
      ['aligner', 'keep', []],
    ]);
    const before = source.requests.length;
    const repaired = await side.client.request('models.repair', {
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      confirmBytes: repair.plan.confirmBytes,
    });
    expect((await until(() => terminal(jobOf(side!, repaired.jobId!)))).state).toBe('completed');
    expect(
      source.requests
        .slice(before)
        .filter((r) => r.method === 'GET')
        .map((r) => `${r.repo}:${r.file}`),
    ).toEqual([`${repos[0]!.repo}:config.json`, `${repos[0]!.repo}:model.safetensors`]);
    expect(await fs.readFile(path.join(asrDir, 'model.safetensors'))).toEqual(repos[0]!.files['model.safetensors']);

    // 慢的自检在跑：删除被拒绝。
    await fs.writeFile(side.control, JSON.stringify({ faults: ['slow'] }));
    const { jobId: testJob } = await side.client.request('models.test', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    // Worker 已经在执行（有了进度），不只是排上队。
    await until(() => jobOf(side!, testJob)?.progress, 10_000);
    const refused = await side.client.request('models.remove', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'conflict', details: { code: 'MODEL_IN_USE', jobIds: [testJob] } });
    expect((await fs.stat(asrDir)).isDirectory()).toBe(true);

    await side.client.request('jobs.cancel', { jobId: testJob });
    await until(() => terminal(jobOf(side!, testJob)));
    // 转写有出厂默认：指向被删模型包的默认值保留，报告为不可用（§6.8）。
    await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'local', modelId: DEFAULT_TRANSCRIBE_BUNDLE });
    const removed = await side.client.request('models.remove', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(removed.removed.sort()).toEqual(repos.map((r) => r.repo).sort());
    expect(removed.kept).toEqual([]);
    expect(removed.bundle).toMatchObject({ state: 'not-installed', reason: 'missing-manifest' });
    expect(await fs.stat(asrDir).catch(() => null)).toBeNull();
    await until(() => bundleOf(side!)?.state === 'not-installed');
    const kept = (await side.client.request('models.capabilities', {})).capabilities.transcribe;
    expect(kept.default).toEqual({ providerId: 'local', modelId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(kept.effective).toBeNull();

    // 空间不足：确认后的任务失败，错误带补救说明。
    free.bytes = 1000;
    const tight = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(tight.plan.availableBytes).toBe(1000);
    const failing = await side.client.request('models.install', {
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      confirmBytes: tight.plan.confirmBytes,
    });
    const failed = await until(() => terminal(jobOf(side!, failing.jobId!)));
    expect(failed).toMatchObject({
      state: 'failed',
      error: {
        code: 'MODEL_DOWNLOAD_NO_SPACE',
        details: { requiredBytes: TOTAL, availableBytes: 1000, remedy: expect.stringContaining('磁盘空间不足') },
      },
    });

    // 严格离线：不下载。
    await side.client.request('settings.set', { values: { 'offline.strict': true } });
    const offline = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE }).catch((e: unknown) => e);
    expect(offline).toMatchObject({ code: 'conflict', details: { code: 'OFFLINE_STRICT' } });
    const unknown = await side.client.request('models.remove', { bundleId: 'nope' }).catch((e: unknown) => e);
    expect(unknown).toMatchObject({ code: 'not-found' });
  });

  it('补齐可选组件：装好的模型包缺对齐器时照常算装好，安装只下载它；装好后空闲的 Worker 先卸下，下一个任务带上它', async () => {
    side = await startSide(source, free);
    const plan = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    const { jobId } = await side.client.request('models.install', {
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      confirmBytes: plan.plan.confirmBytes,
    });
    expect((await until(() => terminal(jobOf(side!, jobId!)))).state).toBe('completed');
    // 自检加载了 Worker，跑完空闲着（`jobIdleMs` 是一分钟）。
    const { jobId: testJob } = await side.client.request('models.test', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect((await until(() => terminal(jobOf(side!, testJob)), 15_000)).state).toBe('completed');
    const provider = side.runtime.models.provider;
    expect(provider.workerPid(DEFAULT_TRANSCRIBE_BUNDLE)).not.toBeNull();

    // 对齐器不在了：模型包还算装好，组件报告缺。
    const aligner = repos[2]!;
    await fs.rm(path.join(side.home.modelsDir, ...aligner.repo.split('/')), { recursive: true });
    const listed = (await side.client.request('models.list', {})).bundles.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!;
    expect(listed.state).not.toBe('not-installed');
    expect(listed.components!.find((c) => c.component === 'aligner')).toMatchObject({ optional: true, state: 'missing', bytes: null });

    // 安装只下载对齐器，装好的组件不动。
    const complete = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    expect(complete.plan.upToDate).toBe(false);
    expect(complete.plan.components.map((c) => [c.component, c.action])).toEqual([
      ['asr', 'keep'],
      ['vad', 'keep'],
      ['aligner', 'download'],
    ]);
    const before = source.requests.length;
    const completed = await side.client.request('models.install', {
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      confirmBytes: complete.plan.confirmBytes,
    });
    expect((await until(() => terminal(jobOf(side!, completed.jobId!)))).state).toBe('completed');
    expect(new Set(source.requests.slice(before).filter((r) => r.method === 'GET').map((r) => r.repo))).toEqual(new Set([aligner.repo]));
    // 旧的 Worker 没有对齐器：空闲的卸下，下一个任务重新加载。
    await until(() => provider.workerPid(DEFAULT_TRANSCRIBE_BUNDLE) === null);
    expect((await side.client.request('models.list', {})).bundles.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!.components!.map((c) => c.state)).toEqual([
      'installed',
      'installed',
      'installed',
    ]);
  });

  it('「说话人区分」模型包：装好后识别模型包报告能区分说话人；没有单独的检查；识别模型包在用时不能删', async () => {
    side = await startSide(source, free);
    const install = async (bundleId: string) => {
      const plan = (await side!.client.request('models.install', { bundleId })).plan;
      const { jobId } = await side!.client.request('models.install', { bundleId, confirmBytes: plan.confirmBytes });
      expect((await until(() => terminal(jobOf(side!, jobId!)), 15_000)).state).toBe('completed');
    };
    const speakers = async () =>
      (await side!.client.request('models.capabilities', {})).capabilities.transcribe.providers
        .find((p) => p.providerId === 'local')!
        .models.find((m) => m.modelId === DEFAULT_TRANSCRIBE_BUNDLE)?.speakers;
    await install(DEFAULT_TRANSCRIBE_BUNDLE);
    expect(await speakers()).toBe('none');
    expect(side.models()!.bundles.find((b) => b.bundleId === diarizationDef.bundleId)).toMatchObject({
      capability: 'diarize',
      state: 'not-installed',
    });

    await install(diarizationDef.bundleId);
    expect(await speakers()).toBe('pack');
    const untestable = await side.client.request('models.test', { bundleId: diarizationDef.bundleId }).catch((e: unknown) => e);
    expect(untestable).toBeInstanceOf(RpcError);
    expect(untestable).toMatchObject({ code: 'unsupported' });

    // 识别模型包的慢自检在跑：它的 Worker 加载着这个模型包的组件，删除被拒绝。
    await fs.writeFile(side.control, JSON.stringify({ faults: ['slow'] }));
    const { jobId: testJob } = await side.client.request('models.test', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    await until(() => jobOf(side!, testJob)?.progress, 10_000);
    const refused = await side.client.request('models.remove', { bundleId: diarizationDef.bundleId }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'conflict', details: { code: 'MODEL_IN_USE', jobIds: [testJob] } });
    await side.client.request('jobs.cancel', { jobId: testJob });
    await until(() => terminal(jobOf(side!, testJob)));

    const removed = await side.client.request('models.remove', { bundleId: diarizationDef.bundleId });
    expect(removed.removed.sort()).toEqual(diarizationRepos.map((r) => r.repo).sort());
    expect(await speakers()).toBe('none');
  });

  it.skipIf(!appleSilicon)(
    '语音合成模型包：装好后自检合成一句，WAV 能解码、时长合理、有声音才通过；静音判为不通过；删掉默认的那只时清掉默认值',
    async () => {
      side = await startSide(source, free);
      await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'synthesize'] }));
      const plan = (await side.client.request('models.install', { bundleId: SPEECH_BUNDLE })).plan;
      const { jobId } = await side.client.request('models.install', { bundleId: SPEECH_BUNDLE, confirmBytes: plan.confirmBytes });
      expect((await until(() => terminal(jobOf(side!, jobId!)), 15_000)).state).toBe('completed');
      const speechOf = () => side!.models()?.bundles.find((b) => b.bundleId === SPEECH_BUNDLE);
      await until(() => speechOf()?.state === 'installed');
      expect(speechOf()).toMatchObject({ capability: 'synthesize', label: 'VoxCPM2', license: { commercialUse: true } });

      const { jobId: testJob } = await side.client.request('models.test', { bundleId: SPEECH_BUNDLE });
      const tested = await until(() => terminal(jobOf(side!, testJob)), 15_000);
      expect(tested).toMatchObject({ kind: 'modelTest', state: 'completed', bundleId: SPEECH_BUNDLE });
      expect(tested.result).toMatchObject({ artifactId: expect.stringMatching(/^sha256:/) });
      expect(await until(() => speechOf()?.selfTest)).toMatchObject({ state: 'passed', jobId: testJob, detail: '1.00 秒 · 24000 Hz' });

      // 合成出静音：自检失败，原因写在模型包上。
      await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'synthesize'], faults: ['silent-output'] }));
      const { jobId: silentJob } = await side.client.request('models.test', { bundleId: SPEECH_BUNDLE });
      const silent = await until(() => terminal(jobOf(side!, silentJob)), 15_000);
      expect(silent).toMatchObject({
        state: 'failed',
        error: { code: 'MODEL_SELF_TEST_FAILED', details: { check: 'MODEL_OUTPUT_WRONG' } },
      });
      expect(await until(() => speechOf()?.selfTest?.jobId === silentJob && speechOf()!.selfTest)).toMatchObject({
        state: 'failed',
        detail: '输出是静音',
        code: 'MODEL_OUTPUT_WRONG',
      });

      // 删除默认的合成模型包：语音合成没有出厂默认，指向它的默认值一并清掉（「未设置」），并发 capabilities.updated。
      await side.client.request('models.setDefault', { capability: 'synthesizeSpeech', providerId: 'local', modelId: SPEECH_BUNDLE });
      expect((await side.client.request('models.capabilities', {})).capabilities.synthesizeSpeech.default).toEqual({
        providerId: 'local',
        modelId: SPEECH_BUNDLE,
      });
      const eventsBefore = side.modelEvents.length;
      await side.client.request('models.remove', { bundleId: SPEECH_BUNDLE });
      expect((await side.client.request('models.capabilities', {})).capabilities.synthesizeSpeech.default).toBeNull();
      await until(() => side!.models()?.capabilities.synthesizeSpeech.default === null);
      expect(
        side.modelEvents
          .slice(eventsBefore)
          .some((e) => e.type === 'capabilities.updated' && e.capabilities.synthesizeSpeech.default === null),
      ).toBe(true);
    },
  );

  it.skipIf(!appleSilicon)(
    '文生图模型包：装好后自检生成一张 256² 的小图（4 步、固定 seed），PNG 能解码、尺寸对、不是纯色才通过',
    async () => {
      side = await startSide(source, free);
      const runs = path.join(side.dir, 'runs.jsonl');
      await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'image'], record: runs }));
      const plan = (await side.client.request('models.install', { bundleId: IMAGE_BUNDLE })).plan;
      const { jobId } = await side.client.request('models.install', { bundleId: IMAGE_BUNDLE, confirmBytes: plan.confirmBytes });
      expect((await until(() => terminal(jobOf(side!, jobId!)), 15_000)).state).toBe('completed');
      const imageOf = () => side!.models()?.bundles.find((b) => b.bundleId === IMAGE_BUNDLE);
      await until(() => imageOf()?.state === 'installed');
      expect(imageOf()).toMatchObject({ capability: 'image', label: 'Qwen-Image-2.1', license: { commercialUse: false } });
      // 装好之后 local 提供 generateImage；没有出厂默认，不指定就不会用它。
      const capabilities = (await side.client.request('models.capabilities', {})).capabilities;
      expect(capabilities.generateImage.providers.find((p) => p.providerId === 'local')).toMatchObject({ available: true });
      expect(capabilities.generateImage.effective).toBeNull();

      const { jobId: testJob } = await side.client.request('models.test', { bundleId: IMAGE_BUNDLE });
      const tested = await until(() => terminal(jobOf(side!, testJob)), 15_000);
      expect(tested).toMatchObject({ kind: 'modelTest', state: 'completed', bundleId: IMAGE_BUNDLE });
      expect(await until(() => imageOf()?.selfTest)).toMatchObject({ state: 'passed', jobId: testJob, detail: '256×256 · 4 步' });
      const [run] = (await fs.readFile(runs, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(run).toMatchObject({ capability: 'image', options: { width: 256, height: 256, steps: 4, seed: 7 } });

      // 出一整片纯色：自检失败，原因写在模型包上。
      await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'image'], faults: ['flat-output'] }));
      const { jobId: flatJob } = await side.client.request('models.test', { bundleId: IMAGE_BUNDLE });
      const flat = await until(() => terminal(jobOf(side!, flatJob)), 15_000);
      expect(flat).toMatchObject({ state: 'failed', error: { code: 'MODEL_SELF_TEST_FAILED', details: { check: 'MODEL_OUTPUT_WRONG' } } });
      expect(await until(() => imageOf()?.selfTest?.jobId === flatJob && imageOf()!.selfTest)).toMatchObject({
        state: 'failed',
        code: 'MODEL_OUTPUT_WRONG',
        detail: expect.stringContaining('纯色'),
      });
    },
  );

  it.skipIf(!appleSilicon)('人声分离模型包：装好后自检把样本分成两路，等长、人声明显比背景响才通过；人声是静音判为不通过', async () => {
    side = await startSide(source, free);
    await fs.writeFile(side.control, JSON.stringify({ capabilities: ['separate'] }));
    const plan = (await side.client.request('models.install', { bundleId: SEPARATE_BUNDLE })).plan;
    const { jobId } = await side.client.request('models.install', { bundleId: SEPARATE_BUNDLE, confirmBytes: plan.confirmBytes });
    expect((await until(() => terminal(jobOf(side!, jobId!)), 15_000)).state).toBe('completed');
    const separateOf = () => side!.models()?.bundles.find((b) => b.bundleId === SEPARATE_BUNDLE);
    await until(() => separateOf()?.state === 'installed');
    expect(separateOf()).toMatchObject({ capability: 'separate', label: 'HTDemucs-FT', license: { name: 'MIT', commercialUse: true } });
    // 能力视图：人声分离的出厂默认是本机装好的分离模型包；可以设成用户默认值（与语音识别同样的设法）。
    const separateView = async () => (await side!.client.request('models.capabilities', {})).capabilities.separateAudio;
    expect(await separateView()).toMatchObject({
      default: null,
      effective: { providerId: 'local', modelId: SEPARATE_BUNDLE, source: 'factory-default' },
      providers: [
        {
          providerId: 'local',
          available: true,
          models: [{ modelId: SEPARATE_BUNDLE, label: 'HTDemucs-FT', default: true, cost: 'free-local' }],
        },
      ],
    });
    const { default: chosen } = await side.client.request('models.setDefault', { capability: 'separateAudio', providerId: 'local' });
    expect(chosen).toEqual({ providerId: 'local', modelId: SEPARATE_BUNDLE });
    expect((await separateView()).effective).toEqual({ providerId: 'local', modelId: SEPARATE_BUNDLE, source: 'user-default' });

    const { jobId: testJob } = await side.client.request('models.test', { bundleId: SEPARATE_BUNDLE });
    const tested = await until(() => terminal(jobOf(side!, testJob)), 15_000);
    expect(tested, JSON.stringify(tested.error)).toMatchObject({ kind: 'modelTest', state: 'completed', bundleId: SEPARATE_BUNDLE });
    expect(await until(() => separateOf()?.selfTest)).toMatchObject({
      state: 'passed',
      jobId: testJob,
      detail: expect.stringMatching(/^\d+\.\d\d 秒 · 44100 Hz · 人声比背景高 12 dB$/),
    });

    await fs.writeFile(side.control, JSON.stringify({ capabilities: ['separate'], faults: ['silent-output'] }));
    const { jobId: silentJob } = await side.client.request('models.test', { bundleId: SEPARATE_BUNDLE });
    const silent = await until(() => terminal(jobOf(side!, silentJob)), 15_000);
    expect(silent).toMatchObject({ state: 'failed', error: { code: 'MODEL_SELF_TEST_FAILED', details: { check: 'MODEL_OUTPUT_WRONG' } } });
    expect(await until(() => separateOf()?.selfTest?.jobId === silentJob && separateOf()!.selfTest)).toMatchObject({
      state: 'failed',
      detail: '人声是静音',
      code: 'MODEL_OUTPUT_WRONG',
    });
  });

  it.skipIf(!appleSilicon)(
    '检查没通过的原因：加载时文件缺失或损坏是模型文件的问题，资源不足是内存不够；记在模型包上，技术细节里有 Worker 的错误码',
    async () => {
      side = await startSide(source, free);
      await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'synthesize'] }));
      const plan = (await side.client.request('models.install', { bundleId: SPEECH_BUNDLE })).plan;
      const { jobId } = await side.client.request('models.install', { bundleId: SPEECH_BUNDLE, confirmBytes: plan.confirmBytes });
      expect((await until(() => terminal(jobOf(side!, jobId!)), 15_000)).state).toBe('completed');
      const speechOf = () => side!.models()?.bundles.find((b) => b.bundleId === SPEECH_BUNDLE);
      for (const [fault, code] of [
        ['load-fail:MODEL_NOT_INSTALLED', 'MODEL_FILES_DAMAGED'],
        ['load-fail:MODEL_RESOURCE', 'MODEL_OUT_OF_MEMORY'],
      ] as const) {
        // 上一次加载失败把模型包挡下了：重新启用之后才能再检查。
        await side.client.request('models.enable', { bundleId: SPEECH_BUNDLE });
        await until(() => speechOf()?.state === 'installed');
        await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'synthesize'], faults: [fault] }));
        const { jobId: loadJob } = await side.client.request('models.test', { bundleId: SPEECH_BUNDLE });
        const failed = await until(() => terminal(jobOf(side!, loadJob)), 15_000);
        expect(failed, fault).toMatchObject({ state: 'failed', error: { code: 'MODEL_SELF_TEST_FAILED', details: { check: code } } });
        const recorded = await until(() => speechOf()?.selfTest?.jobId === loadJob && speechOf()!.selfTest);
        expect(recorded, fault).toMatchObject({ state: 'failed', code });
        expect(recorded.facts, fault).toEqual(expect.arrayContaining([`workerCode: ${fault.slice('load-fail:'.length)}`]));
        expect(recorded.facts!.join('\n'), fault).not.toContain(side.dir);
      }
    },
  );

  it.skipIf(!appleSilicon)(
    '随应用分发的文件不在：自检在提交时以 APP_FILE_MISSING 拒绝（转写的样本、合成的内置音色录音）；执行前才不见的，任务以 APP_FILE_MISSING 失败、不记成自测没通过',
    async () => {
      const assets = path.join(os.tmpdir(), `baocut-model-assets-${newId('t')}`);
      await fs.cp(resolveModelAssetsDir()!, assets, { recursive: true });
      const saved = process.env[MODEL_ASSETS_ENV];
      try {
        side = await startSide(source, free);
        await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'synthesize'] }));
        for (const bundleId of [DEFAULT_TRANSCRIBE_BUNDLE, SPEECH_BUNDLE]) {
          const plan = (await side.client.request('models.install', { bundleId })).plan;
          const { jobId } = await side.client.request('models.install', { bundleId, confirmBytes: plan.confirmBytes });
          expect((await until(() => terminal(jobOf(side!, jobId!)), 15_000)).state).toBe('completed');
        }
        const statusOf = (bundleId: string) => side!.models()?.bundles.find((b) => b.bundleId === bundleId);
        await until(() => statusOf(SPEECH_BUNDLE)?.state === 'installed' && statusOf(DEFAULT_TRANSCRIBE_BUNDLE)?.state === 'installed');

        // 提交时：模型数据目录是空的。
        const empty = path.join(assets, 'empty');
        await fs.mkdir(empty);
        process.env[MODEL_ASSETS_ENV] = empty;
        const jobsBefore = side.jobs()!.jobs.length;
        for (const bundleId of [DEFAULT_TRANSCRIBE_BUNDLE, SPEECH_BUNDLE]) {
          const refused = await side.client.request('models.test', { bundleId }).catch((e: unknown) => e);
          expect(refused).toBeInstanceOf(RpcError);
          expect(refused).toMatchObject({ code: 'conflict', details: { code: 'APP_FILE_MISSING', file: expect.stringContaining(empty) } });
          expect((refused as RpcError).message).toContain('重新安装 BaoCut');
          expect((refused as RpcError).message).not.toContain(empty);
        }
        expect(side.jobs()!.jobs.length).toBe(jobsBefore);

        // 执行前：第一个自检占着这个模型包的队列（假 Worker 放慢），第二个排着；这时删掉内置音色的录音。
        process.env[MODEL_ASSETS_ENV] = assets;
        await fs.writeFile(side.control, JSON.stringify({ capabilities: ['transcribe', 'synthesize'], faults: ['slow'] }));
        const { jobId: first } = await side.client.request('models.test', { bundleId: SPEECH_BUNDLE });
        await until(() => (jobOf(side!, first)?.progress?.done ?? 0) > 0, 15_000);
        const { jobId: second } = await side.client.request('models.test', { bundleId: SPEECH_BUNDLE });
        await fs.rm(path.join(assets, 'tts-voices'), { recursive: true });
        expect(await until(() => terminal(jobOf(side!, first)), 15_000)).toMatchObject({ state: 'completed' });
        const failed = await until(() => terminal(jobOf(side!, second)), 15_000);
        expect(failed).toMatchObject({
          kind: 'modelTest',
          state: 'failed',
          error: { code: 'APP_FILE_MISSING', details: { check: 'APP_FILE_MISSING' } },
        });
        expect(failed.error!.message).toContain('重新安装 BaoCut');
        expect(failed.error!.message).not.toContain(assets);
        // 模型包上的自测结果还是第一次的：安装不完整不算模型自测没通过。
        expect(statusOf(SPEECH_BUNDLE)?.selfTest).toMatchObject({ state: 'passed', jobId: first });
      } finally {
        if (saved === undefined) delete process.env[MODEL_ASSETS_ENV];
        else process.env[MODEL_ASSETS_ENV] = saved;
        await fs.rm(assets, { recursive: true, force: true });
      }
    },
  );

  it('暂停后丢弃：cancelInstall 带 discard 删掉暂存区', async () => {
    side = await startSide(source, free);
    source.throttle(8 * 1024, 20);
    const { plan } = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE });
    const { jobId } = await side.client.request('models.install', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE, confirmBytes: plan.confirmBytes });
    await until(() => (jobOf(side!, jobId!)?.progress?.done ?? 0) > 10_000);
    const result = await side.client.request('models.cancelInstall', { bundleId: DEFAULT_TRANSCRIBE_BUNDLE, discard: true });
    expect(result.bundle.install).toBeUndefined();
    expect(await fs.readdir(side.home.modelsDir)).toEqual([]);
  });

  it('智能体的下载工具：先给大小、按 command 确认，结果带大小；MCP 对外服务没有安装与删除', async () => {
    side = await startSide(source, free);
    const { project } = await side.client.request('projects.create', { name: '模型安装' });
    const {
      conversation: { id: conversationId },
    } = await side.client.request('conversations.create', { projectId: project.id });
    await side.client.request('conversations.send', {
      conversationId,
      text: '转写',
      commandId: newId('cmd'),
      accessMode: 'autoAcceptEdits',
    });
    const session = await until(() => side!.driver.sessions[0]);
    await until(() => session.turnId);

    const listed = await mcp(session, 'tools/list');
    expect((listed.result!.tools as { name: string }[]).map((t) => t.name)).toContain('models_install');

    const calling = tool(session, 'models_install', {});
    const pending = await until(() => side!.runtime.harness.approvals.pending()[0]);
    expect(pending).toMatchObject({ action: { name: 'models_install' }, risk: 'command' });
    expect(JSON.stringify(pending)).toContain(source.endpoint);
    expect((await side.client.request('jobs.list', {})).jobs).toEqual([]);
    await side.client.request('approvals.respond', { approvalId: pending.approvalId, decision: 'allow' });
    const result = await calling;
    expect(result.isError).toBe(false);
    expect(result.body).toMatchObject({
      jobId: expect.stringMatching(/^job_/),
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      downloadBytes: TOTAL,
      size: expect.stringMatching(/KB$/),
      source: source.endpoint,
      approval: { mode: 'autoAcceptEdits', risk: 'command', decidedBy: 'user' },
    });
    const job = await until(() => terminal(jobOf(side!, result.body.jobId)));
    expect(job).toMatchObject({ kind: 'modelInstall', state: 'completed', submitter: { kind: 'agent' } });

    // 已经装好：不再确认，jobId 为 null。
    const again = await tool(session, 'models_install', {});
    expect(again.body).toMatchObject({ jobId: null, downloadBytes: 0 });
    expect(side.runtime.harness.approvals.pending()).toEqual([]);
  });
});
