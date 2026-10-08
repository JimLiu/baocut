import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexDriver } from '@baocut/agent-drivers';
import { createFakeCodex, type FakeCodex, type FakeCodexScenario } from '@baocut/agent-drivers/testing';
import { BaoCutClient, applyJobsEvent } from '@baocut/client';
import { corruptPngFixture, pngFixture } from '@baocut/providers/testing';
import {
  RpcError,
  capabilityRemedyCommands,
  type CapabilityNotConfiguredDetails,
  type ImageModelInfo,
  type JobRecord,
  type JobsSnapshot,
} from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * 智能体作为图片 Provider（`agent:codex`，架构设计 §6.9）经网关端到端：Codex Driver 对着假 codex（`@baocut/agent-drivers/testing`，
 * 一个 node 脚本，按场景把真实的小 PNG 写进会话的工作目录），JobManager → ffprobe 解码校验 → 产物；给了视频时经真实引擎
 * 导入为候选素材。从不启动本机真实的 codex，不联网，不读任何账号文件。
 */

const engine = resolveEngineHostCommand();
const ffprobe = (() => {
  try {
    execFileSync(process.env.BAOCUT_FFPROBE || 'ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!ffprobe) console.warn('跳过智能体图片 Provider 的执行测试：没有 ffprobe');
if (!engine) console.warn('跳过智能体图片导入视频的测试：没有构建 engine-host');

const PROVIDER = 'agent:codex';
const b64 = (bytes: Buffer) => bytes.toString('base64');
/** 一个真实的 1×1 GIF：文件头不是 PNG。 */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Side {
  dir: string;
  home: RuntimeHome;
  fake: FakeCodex;
  runtime: RunningRuntime;
  client: BaoCutClient;
  jobs(): JobsSnapshot | null;
}

async function startSide(scenario: Partial<FakeCodexScenario> = {}, withEngine = false): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agent-provider-'));
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  const fake = await createFakeCodex(path.join(dir, 'fake-codex'), scenario);
  const runtime = await startRuntime({
    home,
    drivers: (log) => [new CodexDriver(log, { locate: fake.locate })],
    watchSpace: false,
    engineHost: withEngine ? engine : null,
    videoGraceMs: 100,
    modelWorker: null,
    jobIdleMs: 60_000,
    agentProviders: { probeMaxAgeMs: 0, turnTimeoutMs: 20_000 },
  });
  const { endpoint, token } = runtime.discovery;
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint, token }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
  });
  await client.connect();
  let jobs: JobsSnapshot | null = null;
  client.subscribeJobs({
    snapshot: (snapshot) => {
      jobs = snapshot;
    },
    event: (event) => {
      jobs = applyJobsEvent(jobs!, event);
    },
  });
  await until(() => jobs);
  return { dir, home, fake, runtime, client, jobs: () => jobs };
}

async function stopSide(side: Side | undefined): Promise<void> {
  if (!side) return;
  side.client.close();
  await side.runtime.close();
  await fs.rm(side.dir, { recursive: true, force: true });
}

function settled(side: Side, jobId: string): Promise<JobRecord> {
  return until(() => side.jobs()!.jobs.find((j) => j.jobId === jobId && ['completed', 'failed', 'cancelled'].includes(j.state)));
}

async function agentEntry(side: Side) {
  const { capabilities } = await side.client.request('models.capabilities', {});
  return capabilities.generateImage.providers.find((p) => p.providerId === PROVIDER);
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcError);
  return error as RpcError;
}

/** 假 codex 启动过几个 app-server（每次生成一个专用会话）。 */
const sessions = (fake: FakeCodex) => fake.log().filter((e) => e.kind === 'start');

describe('智能体图片 Provider：列出、可用性与配置（不需要 ffprobe）', () => {
  let side: Side | undefined;

  afterEach(async () => {
    await stopSide(side);
    side = undefined;
  });

  it('如实描述：一次一张、只有 PNG、尺寸与 seed 不可指定、订阅内额度未知；只出现在 generateImage', async () => {
    side = await startSide();
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.transcribe.providers.some((p) => p.providerId === PROVIDER)).toBe(false);
    expect(capabilities.synthesizeSpeech.providers.some((p) => p.providerId === PROVIDER)).toBe(false);
    const entry = capabilities.generateImage.providers.find((p) => p.providerId === PROVIDER)!;
    expect(entry).toMatchObject({
      kind: 'agent',
      label: 'Codex',
      available: false,
      unavailableReason: 'not-configured',
      config: { enabled: false, enabledAt: null, credential: 'none' },
    });
    const [model] = entry.models as ImageModelInfo[];
    expect(model).toMatchObject({
      modelId: 'image-gen',
      default: true,
      sizes: [],
      aspectRatios: [],
      defaultSize: null,
      maxCount: 1,
      formats: ['png'],
      defaultFormat: 'png',
      acceptsSeed: false,
      referenceImages: null,
      cost: 'subscription',
    });
    expect(model!.notes).toMatch(/一张/);
    expect(model!.notes).toMatch(/同一时间只跑一个/);
    expect(model!.notes).toMatch(/额度未知/);
    // 不是出厂默认。
    expect(capabilities.generateImage).toMatchObject({ default: null, effective: null });
  });

  it('不可用的原因与补救：没有安装、没有登录、版本太旧、没有启用', async () => {
    side = await startSide({ installed: false });
    const cases: Array<[Partial<FakeCodexScenario>, string, string, string]> = [
      [{ installed: false }, 'not-installed', 'not-installed', 'setup-agent'],
      [{ installed: true, loggedIn: false }, 'signed-out', 'signed-out', 'setup-agent'],
      [{ loggedIn: true, version: '0.120.0' }, 'outdated', 'outdated', 'setup-agent'],
      [{ version: '0.160.0' }, 'not-configured', 'disabled', 'enable-provider'],
    ];
    for (const [scenario, reason, selectionReason, action] of cases) {
      side.fake.scenario(scenario);
      const entry = (await agentEntry(side))!;
      expect(entry, reason).toMatchObject({ available: false, unavailableReason: reason });
      expect(entry.detail, reason).toMatch(/./);
      // 这里写成的说明带着引用（界面按当前语言重新生成）；Driver 探测的说明带着探测自己的引用。
      if (reason === 'outdated') expect(entry.detailRef, reason).toMatchObject({ key: 'providersConfig.versionTooOld' });
      if (reason === 'not-configured') expect(entry.detailRef, reason).toEqual({ key: 'providersConfig.notEnabled' });
      const error = await rejection(side.client.request('models.generateImage', { prompt: 'a cat', provider: PROVIDER }));
      expect(error, reason).toMatchObject({
        code: 'conflict',
        details: {
          code: 'CAPABILITY_NOT_CONFIGURED',
          capability: 'generateImage',
          reason: selectionReason,
          providerId: PROVIDER,
          remedy: { action, providerId: PROVIDER },
        },
      });
      const details = error.details as CapabilityNotConfiguredDetails;
      if (reason === 'signed-out') expect(details.remedy.hint).toContain('codex login');
      if (reason === 'outdated') expect(details.remedy.hint).toContain('0.158.0');
      if (reason === 'not-configured') expect(capabilityRemedyCommands(details)).toEqual([`baocut models configure ${PROVIDER} --enable`]);
    }
    expect(await side.client.request('jobs.list', {})).toEqual({ jobs: [] });
    // 只探测过，没有开过会话。
    expect(sessions(side.fake)).toHaveLength(0);
  });

  it('配置只有开关：密钥、端点、模型与验证都拒绝；启用后可用，停用后又不可用', async () => {
    side = await startSide();
    for (const extra of [{ credential: 'sk-x' }, { endpoint: 'http://127.0.0.1:1' }, { models: [{ modelId: 'm' }] }, { verify: true }]) {
      const error = await rejection(side.client.request('models.configure', { providerId: PROVIDER, enabled: true, ...extra }));
      expect(error.code).toBe('invalid-request');
    }
    expect((await rejection(side.client.request('models.configure', { providerId: PROVIDER }))).code).toBe('invalid-request');
    expect((await rejection(side.client.request('models.configure', { providerId: 'agent:other', enabled: true }))).code).toBe('not-found');

    const { provider } = await side.client.request('models.configure', { providerId: PROVIDER, enabled: true });
    expect(provider).toMatchObject({
      providerId: PROVIDER,
      kind: 'agent',
      config: { enabled: true, credential: 'none', enabledAt: expect.any(String) },
      capabilities: { generateImage: { available: true } },
    });
    expect(await agentEntry(side)).toMatchObject({ available: true });
    // 配置文件里没有密钥一类的东西。
    expect(JSON.parse(await fs.readFile(side.home.modelServicesFile, 'utf8')).providers[PROVIDER]).toEqual({
      enabled: true,
      enabledAt: expect.any(String),
    });

    // 启用了也不是出厂默认：不指定 provider 时提示设默认值。
    const error = await rejection(side.client.request('models.generateImage', { prompt: 'a cat' }));
    expect(error.details).toMatchObject({ reason: 'no-default', remedy: { action: 'set-default', providerId: PROVIDER } });

    await side.client.request('models.configure', { providerId: PROVIDER, enabled: false });
    expect(await agentEntry(side)).toMatchObject({ available: false, unavailableReason: 'not-configured' });
  });

  it('不接受的参数在提交时拒绝（不悄悄忽略）：尺寸、宽高比、seed、多张、别的格式、超长提示词', async () => {
    side = await startSide();
    await side.client.request('models.configure', { providerId: PROVIDER, enabled: true });
    for (const extra of [
      { size: '1024x1024' },
      { size: '16:9' },
      { seed: 7 },
      { count: 2 },
      { format: 'jpeg' as const },
      { prompt: 'x'.repeat(4001) },
    ]) {
      const error = await rejection(side.client.request('models.generateImage', { prompt: 'a cat', provider: PROVIDER, ...extra }));
      expect(error.code, JSON.stringify(extra).slice(0, 40)).toBe('invalid-request');
    }
    expect(await side.client.request('jobs.list', {})).toEqual({ jobs: [] });
    expect(sessions(side.fake)).toHaveLength(0);
  });
});

describe.skipIf(!ffprobe)('智能体图片 Provider：执行（假 codex + ffprobe）', () => {
  let side: Side;

  beforeEach(async () => {
    side = await startSide({ turn: { files: { 'output.png': b64(pngFixture(24, 16, 3)) }, reply: 'Saved output.png' } });
    await side.client.request('models.configure', { providerId: PROVIDER, enabled: true });
  });

  afterEach(async () => {
    await stopSide(side);
  });

  it('显式指定：一个专用会话（工作目录是 staging、没有 MCP 服务、只写工作目录），产物是会话写下的 PNG 并记下实际尺寸', async () => {
    const { jobId } = await side.client.request('models.generateImage', { prompt: 'a red fox, watercolor', provider: PROVIDER });
    const job = await settled(side, jobId);
    expect(job).toMatchObject({
      kind: 'generateImage',
      state: 'completed',
      providerId: PROVIDER,
      modelId: 'image-gen',
      videoId: null,
      error: null,
      generation: { capability: 'generateImage', prompt: 'a red fox, watercolor', size: null, count: 1, format: 'png', seed: null },
    });
    const [output] = job.result!.outputs!;
    expect(output).toMatchObject({ mediaType: 'image/png', assetId: null, media: { kind: 'image', width: 24, height: 16 } });
    const handle = await side.client.request('artifacts.openHandle', { artifactId: output!.artifactId });
    const bytes = Buffer.from(await (await fetch(handle.url)).arrayBuffer());
    expect(bytes.equals(pngFixture(24, 16, 3))).toBe(true);

    // 会话：工作目录是这个任务的 staging；没有 MCP 服务（没有 BaoCut 的工具）；只写工作目录，从不审批。
    const [start] = side.fake.requests('thread/start');
    const staging = path.join(side.home.stagingDir, 'jobs', jobId);
    expect(start!.params.cwd).toBe(staging);
    expect(start!.params).toMatchObject({ approvalPolicy: 'never', sandbox: 'workspace-write' });
    expect(start!.params.config).toEqual({
      sandbox_workspace_write: { writable_roots: [], network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true },
    });
    expect(JSON.stringify(start!.params)).not.toContain('mcp_servers');
    expect(start!.params.developerInstructions).toMatch(/output\.png/);
    // 没有会话历史与视频上下文：新开的线程，一个回合，输入只有提示词。
    expect(side.fake.requests('thread/resume')).toHaveLength(0);
    const turns = side.fake.requests('turn/start');
    expect(turns).toHaveLength(1);
    expect(JSON.stringify(turns[0]!.params.input)).toContain('a red fox, watercolor');
    // 会话在调用结束时关闭；staging 在任务终结时删除。
    await until(() => side.fake.log().some((e) => e.kind === 'exit'));
    expect(sessions(side.fake)).toHaveLength(1);
    expect(await fs.stat(staging).catch(() => null)).toBeNull();
  });

  it('设为默认值后不指定 provider 也用它', async () => {
    await side.client.request('models.setDefault', { capability: 'generateImage', providerId: PROVIDER });
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.generateImage).toMatchObject({
      default: { providerId: PROVIDER, modelId: 'image-gen' },
      effective: { providerId: PROVIDER, modelId: 'image-gen', source: 'user-default' },
    });
    const { jobId } = await side.client.request('models.generateImage', { prompt: 'a lighthouse' });
    expect(await settled(side, jobId)).toMatchObject({ state: 'completed', providerId: PROVIDER });
  });

  it('只有文字回复、没有图片：任务失败（PROVIDER_REJECTED，no-image），回复不是输出，也不换 Provider', async () => {
    side.fake.scenario({ turn: { reply: 'I am unable to generate images in this environment.' } });
    const { jobId } = await side.client.request('models.generateImage', { prompt: 'a cat', provider: PROVIDER });
    const job = await settled(side, jobId);
    expect(job).toMatchObject({
      state: 'failed',
      providerId: PROVIDER,
      result: null,
      error: { code: 'PROVIDER_REJECTED', details: { reason: 'no-image', providerId: PROVIDER } },
    });
    expect(job.error!.message).toContain('unable to generate');
    expect(sessions(side.fake)).toHaveLength(1);
  });

  it('回合失败：PROVIDER_REJECTED 带上智能体给的原因', async () => {
    side.fake.scenario({ turn: { status: 'failed', error: 'usage limit reached for image_gen' } });
    const { jobId } = await side.client.request('models.generateImage', { prompt: 'a cat', provider: PROVIDER });
    const job = await settled(side, jobId);
    expect(job).toMatchObject({ state: 'failed', error: { code: 'PROVIDER_REJECTED', details: { reason: 'turn-failed' } } });
    expect(job.error!.message).toContain('usage limit');
  });

  it('写错的文件：解码不了的 PNG、扩展名是 png 的 GIF、两张都不叫 output.png，都是 MODEL_OUTPUT_INVALID', async () => {
    const cases: Array<Record<string, string>> = [
      { 'output.png': b64(corruptPngFixture()) },
      { 'output.png': b64(GIF) },
      { 'a.png': b64(pngFixture()), 'b.png': b64(pngFixture(8, 8)) },
    ];
    for (const files of cases) {
      side.fake.scenario({ turn: { files, reply: 'done' } });
      const { jobId } = await side.client.request('models.generateImage', { prompt: 'a cat', provider: PROVIDER });
      const job = await settled(side, jobId);
      expect(job, Object.keys(files).join(',')).toMatchObject({ state: 'failed', result: null, error: { code: 'MODEL_OUTPUT_INVALID' } });
    }
  });

  it('不在约定名字下、但只有一张图：照样收下（子目录里也找）', async () => {
    side.fake.scenario({ turn: { files: { 'images/fox.png': b64(pngFixture(10, 20)) }, reply: 'done' } });
    const { jobId } = await side.client.request('models.generateImage', { prompt: 'a fox', provider: PROVIDER });
    const job = await settled(side, jobId);
    expect(job.result!.outputs![0]).toMatchObject({ media: { kind: 'image', width: 10, height: 20 } });
  });

  it('会话请求审批：一律拒绝（没有人来批），回合照常结束', async () => {
    side.fake.scenario({ turn: { askApproval: true, files: { 'output.png': b64(pngFixture()) }, reply: 'done' } });
    const { jobId } = await side.client.request('models.generateImage', { prompt: 'a cat', provider: PROVIDER });
    expect(await settled(side, jobId)).toMatchObject({ state: 'completed' });
    const answer = side.fake.log().find((e) => e.kind === 'in' && e.msg?.id === 1000 && e.msg.method === undefined);
    expect(answer!.msg!.result).toEqual({ decision: 'decline' });
  });

  it('取消进行中的任务：中断回合并关闭会话，任务以 cancelled 结束', async () => {
    side.fake.scenario({ turn: { status: 'hang' } });
    const { jobId } = await side.client.request('models.generateImage', { prompt: 'a slow cat', provider: PROVIDER });
    await until(() => side.fake.requests('turn/start').length === 1);
    await until(() => side.jobs()!.jobs.find((j) => j.jobId === jobId && j.phase === 'generating'));
    await side.client.request('jobs.cancel', { jobId });
    expect(await settled(side, jobId)).toMatchObject({ state: 'cancelled', result: null });
    expect(side.fake.requests('turn/interrupt')).toHaveLength(1);
    await until(() => side.fake.log().some((e) => e.kind === 'exit'));
  });

  it('串行：两个任务排同一个队列，第二个会话在第一个关闭之后才启动', async () => {
    side.fake.scenario({ turn: { delayMs: 300, files: { 'output.png': b64(pngFixture()) }, reply: 'done' } });
    const first = await side.client.request('models.generateImage', { prompt: 'one', provider: PROVIDER });
    const second = await side.client.request('models.generateImage', { prompt: 'two', provider: PROVIDER });
    const queued = await until(() => side.jobs()!.jobs.find((j) => j.jobId === second.jobId && j.state === 'queued'));
    expect(queued.state).toBe('queued');
    expect(await settled(side, first.jobId)).toMatchObject({ state: 'completed' });
    expect(await settled(side, second.jobId)).toMatchObject({ state: 'completed' });
    const log = side.fake.log();
    const starts = log.filter((e) => e.kind === 'start');
    expect(starts).toHaveLength(2);
    const firstExit = log.find((e) => e.kind === 'exit' && e.pid === starts[0]!.pid)!;
    expect(firstExit.t).toBeLessThanOrEqual(starts[1]!.t);
  });

  it('排队期间被停用：不再开会话，任务失败（MODEL_LOAD_FAILED）', async () => {
    side.fake.scenario({ turn: { delayMs: 300, files: { 'output.png': b64(pngFixture()) }, reply: 'done' } });
    const first = await side.client.request('models.generateImage', { prompt: 'one', provider: PROVIDER });
    const second = await side.client.request('models.generateImage', { prompt: 'two', provider: PROVIDER });
    await until(() => side.fake.requests('turn/start').length === 1);
    await side.client.request('models.configure', { providerId: PROVIDER, enabled: false });
    expect(await settled(side, first.jobId)).toMatchObject({ state: 'completed' });
    expect(await settled(side, second.jobId)).toMatchObject({ state: 'failed', error: { code: 'MODEL_LOAD_FAILED' } });
    expect(sessions(side.fake)).toHaveLength(1);
  });

  it('排队期间授权被撤销（§12.5）：在跑的照常结束并计入；排队的开始前以 GRANT_REVOKED 失败，预留释放，不开会话', async () => {
    side.fake.scenario({ turn: { delayMs: 300, files: { 'output.png': b64(pngFixture()) }, reply: 'done' } });
    const first = await side.client.request('models.generateImage', { prompt: 'one', provider: PROVIDER });
    const second = await side.client.request('models.generateImage', { prompt: 'two', provider: PROVIDER });
    await until(() => side.fake.requests('turn/start').length === 1);
    const [byDefault] = (await side.client.request('grants.list', { recipient: PROVIDER })).grants;
    expect(byDefault).toMatchObject({ origin: 'provider-enable' });
    const revoked = await side.client.request('grants.revoke', { grantId: byDefault!.grantId });
    expect(revoked.runningJobs).toEqual([first.jobId]);
    expect(await settled(side, first.jobId)).toMatchObject({
      state: 'completed',
      grant: { grantId: byDefault!.grantId, settled: { calls: 1, basis: 'unknown' } },
    });
    expect(await settled(side, second.jobId)).toMatchObject({
      state: 'failed',
      error: { code: 'GRANT_REVOKED' },
      grant: { grantId: byDefault!.grantId, settled: { calls: 0, basis: 'released' } },
    });
    expect(sessions(side.fake)).toHaveLength(1);
    expect((await side.client.request('grants.usage', { grantId: byDefault!.grantId })).grant.usage).toMatchObject({
      calls: 1,
      reservedCalls: 0,
    });
  });
});

describe.skipIf(!ffprobe || !engine)('智能体图片导入视频（真实引擎）', () => {
  let side: Side;

  beforeEach(async () => {
    side = await startSide({ turn: { files: { 'output.png': b64(pngFixture(32, 18)) }, reply: 'done' } }, true);
    await side.client.request('models.configure', { providerId: PROVIDER, enabled: true });
  });

  afterEach(async () => {
    await stopSide(side);
  });

  it('给了视频：与别的 Provider 一样导入为候选素材，来源记 generated 与 agent:codex，时间线不变', async () => {
    const { project } = await side.client.request('projects.create', { name: '智能体生成' });
    const opened = await side.client.request('videos.create', { projectId: project.id });
    const videoId = opened.ref.videoId;
    const before = opened.snapshot.video;
    const { jobId } = await side.client.request('models.generateImage', {
      prompt: 'a lighthouse',
      provider: PROVIDER,
      videoId,
      name: '灯塔',
    });
    const job = await settled(side, jobId);
    expect(job).toMatchObject({ state: 'completed', videoId });
    const video = side.runtime.videos.mirror(videoId)!.video;
    const asset = video.assets[job.result!.outputs![0]!.assetId!]!;
    expect(asset.name).toBe('灯塔');
    const revision = asset.revisions[asset.currentRevision]!;
    expect(revision.mediaType).toBe('image/png');
    expect(revision.provenance).toMatchObject({
      origin: 'generated',
      source: { jobId, capability: 'generateImage', providerId: PROVIDER, modelId: 'image-gen' },
    });
    expect(JSON.stringify(video.sequences)).toBe(JSON.stringify(before.sequences));
  });
});
