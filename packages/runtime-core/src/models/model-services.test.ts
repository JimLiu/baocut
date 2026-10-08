import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyJobsEvent, applyModelsEvent } from '@baocut/client';
import { FAKE_MODEL_WORKER } from '@baocut/jobs';
import { BUNDLES, MANIFEST_FILE, defaultTranscribeBundle, type AsrResult } from '@baocut/models';
import { pairingCodeOf, startTestNode, type TestNode } from '@baocut/nodes/testing';
import { fakeGoogleHandler, fakeOpenAiHandler, startFakeProviderServer, type FakeProviderServer } from '@baocut/providers/testing';
import {
  RpcError,
  newId,
  type CapabilityNotConfiguredDetails,
  type JobRecord,
  type JobsSnapshot,
  type ModelsSnapshot,
  type Project,
} from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * 模型服务（架构设计 §6.1–§6.4）经网关：能力视图、配置、默认值与选择；在线 Provider 对着本机回环地址上的假供应商
 * （`@baocut/providers/testing`）跑完整的转写：ffmpeg 准备音频 → 假供应商 → 结果校验、发布 → 真实引擎写 speech 文档。
 * 测试从不连接真实的云服务，也不读取任何环境里的密钥；密钥是测试里编的字符串。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
/** 这台机器上的默认转写模型包：Apple Silicon 是 MLX 的，别的平台是 candle 的（同样的仓库）。 */
const DEFAULT_TRANSCRIBE_BUNDLE = defaultTranscribeBundle(process.platform, process.arch);

if (!engine) console.warn('跳过在线转写端到端测试：没有构建 engine-host（npm run build:engine）');
if (!ffmpeg) console.warn('跳过在线转写端到端测试：没有 ffmpeg');

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-0123456789abcdef';
const GOOGLE_KEY = 'AIzaTESTONLY-0123456789abcdefghijklmn';

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 给默认模型包的每个仓库写一份合成的清单与文件。 */
async function installSyntheticModels(modelsDir: string): Promise<void> {
  const bundle = BUNDLES.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!;
  for (const source of Object.values(bundle.components)) {
    if (!source) continue;
    const dir = path.join(modelsDir, ...source.repo.split('/'));
    await fs.mkdir(dir, { recursive: true });
    const content = `synthetic ${source.repo}`;
    await fs.writeFile(path.join(dir, 'model.safetensors'), content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const manifest = {
      format_version: 1,
      repo: source.repo,
      revision: source.revision,
      files: [{ path: 'model.safetensors', size: content.length, sha256 }],
    };
    await fs.writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest));
  }
}

interface Side {
  dir: string;
  home: RuntimeHome;
  runtime: RunningRuntime;
  client: BaoCutClient;
  /** `models` 与 `jobs` 主题上收到的全部内容（密钥检查用）。 */
  received: unknown[];
  jobs(): JobsSnapshot | null;
  models(): ModelsSnapshot | null;
}

async function startSide(options: {
  engine?: string | null;
  localModels?: boolean;
  worker?: boolean;
  openai?: FakeProviderServer;
  google?: FakeProviderServer;
}): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-services-'));
  const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  if (options.localModels) await installSyntheticModels(home.modelsDir);
  const runtime = await startRuntime({
    home,
    drivers: () => [],
    watchSpace: false,
    engineHost: options.engine ?? null,
    videoGraceMs: 100,
    modelWorker: options.worker ? { command: process.execPath, args: [FAKE_MODEL_WORKER] } : null,
    jobIdleMs: 60_000,
    online: {
      baseUrls: {
        ...(options.openai ? { openai: `${options.openai.origin}/v1` } : {}),
        ...(options.google ? { google: `${options.google.origin}/v1beta` } : {}),
      },
      http: { backoffMs: () => 10 },
    },
  });
  const { endpoint, token } = runtime.discovery;
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint, token }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
  });
  await client.connect();
  const received: unknown[] = [];
  let jobs: JobsSnapshot | null = null;
  let models: ModelsSnapshot | null = null;
  client.subscribeJobs({
    snapshot: (snapshot) => {
      received.push(snapshot);
      jobs = snapshot;
    },
    event: (event) => {
      received.push(event);
      jobs = applyJobsEvent(jobs!, event);
    },
  });
  client.subscribeModels({
    snapshot: (snapshot) => {
      received.push(snapshot);
      models = snapshot;
    },
    event: (event) => {
      received.push(event);
      models = applyModelsEvent(models!, event);
    },
  });
  await until(() => jobs && models);
  return { dir, home, runtime, client, received, jobs: () => jobs, models: () => models };
}

async function stopSide(side: Side | undefined): Promise<void> {
  if (!side) return;
  side.client.close();
  await side.runtime.close();
  await fs.rm(side.dir, { recursive: true, force: true });
}

describe('模型服务（经网关，不需要引擎）', () => {
  let side: Side | undefined;
  let openai: FakeProviderServer | undefined;
  let node: TestNode | undefined;

  afterEach(async () => {
    await stopSide(side);
    await openai?.close();
    await node?.close();
    side = openai = node = undefined;
  });

  it('什么都没配置：没有生效的默认值，转写在提交时以 CAPABILITY_NOT_CONFIGURED 拒绝，不创建任务', async () => {
    side = await startSide({});
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.transcribe).toMatchObject({ default: null, effective: null });
    const providers = Object.fromEntries(capabilities.transcribe.providers.map((p) => [p.providerId, p]));
    expect(providers.local).toMatchObject({ kind: 'local', available: false, config: null });
    expect(providers.openai).toMatchObject({
      kind: 'online',
      available: false,
      unavailableReason: 'not-configured',
      config: { enabled: false, enabledAt: null, credential: 'missing' },
    });
    expect(providers.google).toMatchObject({ kind: 'online', available: false, unavailableReason: 'not-configured' });
    expect(providers.openai!.models.find((m) => m.default)).toMatchObject({ modelId: 'whisper-1', wordTimestamps: 'native' });
    // 生成能力没有出厂默认：列出提供它们的 Provider（本地的合成模型包还没装），都还不可用。
    expect(capabilities.synthesizeSpeech).toMatchObject({ default: null, effective: null });
    expect(capabilities.synthesizeSpeech.providers.map((p) => [p.providerId, p.available])).toEqual([
      ['local', false],
      ['openai', false],
      ['elevenlabs', false],
    ]);

    const error = await side.client.request('models.transcribe', { videoId: 'mov_1', assetId: 'ast_1' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      code: 'conflict',
      details: {
        code: 'CAPABILITY_NOT_CONFIGURED',
        capability: 'transcribe',
        reason: 'no-default',
        remedy: { capability: 'transcribe', hint: expect.stringMatching(/./) },
      },
    });
    expect(['install-model', 'configure-provider']).toContain(
      ((error as RpcError).details as CapabilityNotConfiguredDetails).remedy.action,
    );
    expect(await side.client.request('jobs.list', {})).toEqual({ jobs: [] });
  });

  it('本机模型包装好：出厂默认就是本机', async () => {
    side = await startSide({ localModels: true, worker: true });
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.transcribe.effective).toEqual({
      providerId: 'local',
      modelId: DEFAULT_TRANSCRIBE_BUNDLE,
      source: 'factory-default',
    });
    const local = capabilities.transcribe.providers.find((p) => p.providerId === 'local')!;
    expect(local).toMatchObject({ available: true, kind: 'local' });
    expect(local.models.find((m) => m.modelId === DEFAULT_TRANSCRIBE_BUNDLE)).toMatchObject({ default: true, cost: 'free-local' });
  });

  it('配置 OpenAI：启用与密钥只报告有没有；设为默认后成为生效的默认值；验证失败时不保存', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ openai });
    const configured = await side.client.request('models.configure', {
      providerId: 'openai',
      enabled: true,
      credential: OPENAI_KEY,
      verify: true,
    });
    expect(configured.provider).toMatchObject({
      providerId: 'openai',
      config: { enabled: true, enabledAt: expect.any(String), credential: 'set' },
      capabilities: { transcribe: { available: true } },
    });
    expect(JSON.stringify(configured)).not.toContain(OPENAI_KEY);
    // 验证是一个只读的 GET，密钥只在 Authorization 头里。
    expect(openai.requests).toHaveLength(1);
    expect(openai.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
    expect(openai.requests[0]!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(openai.requests[0]!.path).not.toContain(OPENAI_KEY);

    expect(await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'openai' })).toEqual({
      default: { providerId: 'openai', modelId: 'whisper-1' },
    });
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.transcribe.default).toEqual({ providerId: 'openai', modelId: 'whisper-1' });
    expect(capabilities.transcribe.effective).toEqual({ providerId: 'openai', modelId: 'whisper-1', source: 'user-default' });
    await until(() => side!.models()?.capabilities.transcribe.effective?.providerId === 'openai');

    // 换一个会被拒绝的密钥并要求验证：不保存，原来的配置不变。
    openai.handler = () => ({ status: 401, json: { error: { message: 'Incorrect API key provided: sk-wrong-0123456789' } } });
    const rejected = await side.client
      .request('models.configure', { providerId: 'openai', credential: 'sk-wrong-0123456789', verify: true })
      .catch((e: unknown) => e);
    expect(rejected).toMatchObject({ code: 'conflict', details: { code: 'PROVIDER_AUTH_FAILED' } });
    expect((rejected as RpcError).message).not.toContain('sk-wrong-0123456789');
    const credentials = JSON.parse(await fs.readFile(side.home.modelCredentialsFile, 'utf8')) as { credentials: Record<string, string> };
    expect(credentials.credentials['provider:openai/main']).toBe(OPENAI_KEY);
    expect((await fs.stat(side.home.modelCredentialsFile)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(side.home.modelServicesFile)).mode & 0o777).toBe(0o600);

    // 停用之后不能被选中：默认值保留，但不再生效。
    await side.client.request('models.configure', { providerId: 'openai', enabled: false });
    const after = (await side.client.request('models.capabilities', {})).capabilities.transcribe;
    expect(after.default).toEqual({ providerId: 'openai', modelId: 'whisper-1' });
    expect(after.effective).toBeNull();
    const error = await side.client.request('models.transcribe', { videoId: 'mov_1', assetId: 'ast_1' }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'conflict',
      details: { code: 'CAPABILITY_NOT_CONFIGURED', reason: 'disabled', providerId: 'openai', remedy: { action: 'enable-provider' } },
    });
  });

  it('自定义端点：添加、声明模型、删除；指向它的默认值保留并报告不可用', async () => {
    side = await startSide({});
    const added = await side.client.request('models.configure', {
      providerId: 'custom:studio-asr',
      enabled: true,
      endpoint: 'http://127.0.0.1:9/v1',
      label: '工作室 ASR',
      models: [{ modelId: 'large-v3', wordTimestamps: 'none' }],
    });
    expect(added.provider).toMatchObject({
      providerId: 'custom:studio-asr',
      label: '工作室 ASR',
      config: { enabled: true, credential: 'missing', endpoint: 'http://127.0.0.1:9/v1' },
      capabilities: {
        transcribe: { available: true, models: [{ modelId: 'large-v3', declared: true, default: true, wordTimestamps: 'none' }] },
      },
    });
    await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'custom:studio-asr' });
    expect(await side.client.request('models.removeProvider', { providerId: 'custom:studio-asr' })).toEqual({ removed: true });
    const view = (await side.client.request('models.capabilities', {})).capabilities.transcribe;
    expect(view.default).toEqual({ providerId: 'custom:studio-asr', modelId: 'large-v3' });
    expect(view.effective).toBeNull();
    expect(view.providers.some((p) => p.providerId === 'custom:studio-asr')).toBe(false);
    const error = await side.client.request('models.transcribe', { videoId: 'mov_1', assetId: 'ast_1' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'conflict', details: { code: 'CAPABILITY_NOT_CONFIGURED', providerId: 'custom:studio-asr' } });
    // 目录里的服务商也能移除（§6.8）：回到没有添加的状态（没有配置、没有账号）；本机 Provider 不能移除。
    expect(await side.client.request('models.removeProvider', { providerId: 'openai' })).toEqual({ removed: true });
    await expect(side.client.request('models.removeProvider', { providerId: 'local' })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(side.client.request('models.removeProvider', { providerId: 'custom:studio-asr' })).rejects.toMatchObject({
      code: 'not-found',
    });
    // 自定义端点首次配置要给端点；ID 要合规；内置 Provider 不能声明模型。
    await expect(side.client.request('models.configure', { providerId: 'custom:new', enabled: true })).rejects.toMatchObject({
      code: 'invalid-request',
    });
    await expect(
      side.client.request('models.configure', { providerId: 'custom:Bad Slug', endpoint: 'http://127.0.0.1:9' }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(side.client.request('models.configure', { providerId: 'openai', models: [{ modelId: 'x' }] })).rejects.toMatchObject({
      code: 'invalid-request',
    });
  });

  it('配对的节点出现在能力视图里，可以设为默认值', async () => {
    node = await startTestNode();
    side = await startSide({});
    const code = pairingCodeOf(node.service.status())!;
    const { node: paired } = await side.client.request('nodes.pair', {
      host: '127.0.0.1',
      port: node.service.port!,
      code,
      alias: 'studio',
    });
    const { capabilities } = await side.client.request('models.capabilities', {});
    const view = capabilities.transcribe.providers.find((p) => p.providerId === `node:${paired.nodeId}`);
    expect(view).toMatchObject({ kind: 'node', available: true, config: null });
    expect(view!.models.map((m) => m.modelId)).toContain('fake@cpu');
    expect(
      await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'node:studio', modelId: 'fake@cpu' }),
    ).toEqual({
      default: { providerId: `node:${paired.nodeId}`, modelId: 'fake@cpu' },
    });
    await until(() => side!.models()?.capabilities.transcribe.effective?.providerId === `node:${paired.nodeId}`);
  });

  it('节点关闭了转写的共享：nodes.list 与能力视图都报告这个节点的转写不可用，带原因与补救；打开后恢复', async () => {
    node = await startTestNode();
    side = await startSide({});
    const code = pairingCodeOf(node.service.status())!;
    const { node: paired } = await side.client.request('nodes.pair', {
      host: '127.0.0.1',
      port: node.service.port!,
      code,
      alias: 'studio',
    });
    await node.service.setCapability('transcribe', false);

    const { nodes } = await side.client.request('nodes.list', {});
    expect(nodes).toEqual([
      expect.objectContaining({
        nodeId: paired.nodeId,
        problem: null,
        health: expect.objectContaining({ capabilities: expect.any(Object) }),
      }),
    ]);
    expect(nodes[0]!.health!.capabilities.transcribe.enabled).toBe(false);

    const view = (await side.client.request('models.capabilities', {})).capabilities.transcribe.providers.find(
      (p) => p.providerId === `node:${paired.nodeId}`,
    );
    expect(view).toMatchObject({ kind: 'node', available: false, unavailableReason: 'unsupported' });
    expect(view!.detail).toContain('关闭了转写的共享');
    expect(view!.detail).toContain('baocut share capability transcribe on');

    await node.service.setCapability('transcribe', true);
    const reopened = (await side.client.request('models.capabilities', {})).capabilities.transcribe.providers.find(
      (p) => p.providerId === `node:${paired.nodeId}`,
    );
    expect(reopened).toMatchObject({ kind: 'node', available: true });
    expect((await side.client.request('nodes.list', {})).nodes[0]!.health!.capabilities.transcribe.enabled).toBe(true);
  });
});

describe.skipIf(!engine || !ffmpeg)('在线转写（真实引擎 + 假供应商）', () => {
  let fixtures: string;
  let audio: string;
  let side: Side;
  let openai: FakeProviderServer;
  let google: FakeProviderServer;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    audio = path.join(fixtures, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '16000', '-ac', '1', audio]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    google = await startFakeProviderServer(fakeGoogleHandler());
    side = await startSide({ engine, openai, google, localModels: true, worker: true });
    ({ project } = await side.client.request('projects.create', { name: '在线转写' }));
  });

  afterEach(async () => {
    await stopSide(side);
    await openai.close();
    await google.close();
  });

  async function videoWithAudio() {
    const opened = await side.client.request('videos.create', { projectId: project.id });
    const videoId = opened.ref.videoId;
    const imported = await side.client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: opened.snapshot.video.revision,
      operations: [{ type: 'importAsset', path: audio, ref: 'voice' }],
    });
    return { videoId, assetId: imported.receipt.refs!.voice! };
  }

  async function settled(jobId: string): Promise<JobRecord> {
    return until(() => side.jobs()!.jobs.find((j) => j.jobId === jobId && ['completed', 'failed', 'cancelled'].includes(j.state)));
  }

  async function rawResult(job: JobRecord): Promise<AsrResult> {
    return JSON.parse(await fs.readFile(path.join(side.home.artifactsDir, `${job.result!.artifactId.slice(7)}.json`), 'utf8')) as AsrResult;
  }

  /** 日志、任务账本、主题上的内容与配置文件里都不能出现密钥。 */
  async function expectNoSecret(secret: string) {
    const files = [path.join(side.home.logsDir, 'runtime.log'), side.home.jobsFile, side.home.modelServicesFile];
    for (const file of files) expect(await fs.readFile(file, 'utf8').catch(() => ''), file).not.toContain(secret);
    expect(JSON.stringify(side.received)).not.toContain(secret);
    expect(JSON.stringify(await side.client.request('jobs.list', {}))).not.toContain(secret);
  }

  async function useOpenAi() {
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'openai' });
  }

  it('OpenAI 是默认值：不指定 Provider 的转写走 OpenAI，speech 文档与原始结果记录来源，词时间来自供应商', async () => {
    await useOpenAi();
    const { videoId, assetId } = await videoWithAudio();
    const { jobId } = await side.client.request('models.transcribe', { videoId, assetId, hint: 'BaoCut' });
    const job = await settled(jobId);
    expect(job).toMatchObject({
      state: 'completed',
      providerId: 'openai',
      modelId: 'whisper-1',
      bundleId: null,
      attempt: 1,
      error: null,
      result: { documentId: expect.any(String), artifactId: expect.stringMatching(/^sha256:/) },
    });
    const content = await side.client.request('documents.read', { videoId, documentId: job.result!.documentId! });
    const body = content.body as { words: Array<{ text: string }>; engine: Record<string, unknown> };
    expect(body.engine).toMatchObject({
      provider: 'openai',
      bundleId: null,
      backend: 'online',
      device: 'remote',
      models: { asr: { family: 'openai', revision: 'whisper-1' } },
      cost: { status: 'reported', usage: { type: 'duration', seconds: 1 } },
    });
    expect(body.words.map((w) => w.text)).toEqual(['hello', 'world']);
    const result = await rawResult(job);
    expect(result.provenance).toMatchObject({ provider: 'openai', backend: 'online', device: 'remote' });
    expect(result.language).toEqual({ tag: 'en', source: 'detected', confidence: null });
    expect(result.segments[0]!.words.every((w) => w.timingQuality === 'provider')).toBe(true);
    expect(Number.isInteger(result.segments[0]!.start)).toBe(true);

    // 请求：multipart、m4a、verbose_json 带词与段的时间、提示词放 prompt；密钥只在 Authorization 头。
    const request = openai.requests.find((r) => r.path === '/v1/audio/transcriptions')!;
    expect(request.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(request.fields).toMatchObject({
      model: ['whisper-1'],
      response_format: ['verbose_json'],
      'timestamp_granularities[]': ['word', 'segment'],
      prompt: ['BaoCut'],
    });
    expect(request.fields.language).toBeUndefined();
    expect(request.file).toMatchObject({ type: 'audio/mp4' });
    await expectNoSecret(OPENAI_KEY);
  });

  it('不返回时间的模型：词时间按字符长度插值，标 estimated；断言的语言传给供应商', async () => {
    await useOpenAi();
    const { videoId, assetId } = await videoWithAudio();
    const { jobId } = await side.client.request('models.transcribe', {
      videoId,
      assetId,
      model: 'gpt-4o-transcribe',
      language: { mode: 'assert', tag: 'en-US' },
    });
    const job = await settled(jobId);
    expect(job).toMatchObject({ state: 'completed', providerId: 'openai', modelId: 'gpt-4o-transcribe' });
    const result = await rawResult(job);
    expect(result.language).toMatchObject({ tag: 'en-US', source: 'asserted' });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.words.map((w) => [w.text, w.timingQuality])).toEqual([
      ['hello', 'estimated'],
      ['world', 'estimated'],
    ]);
    const request = openai.requests.find((r) => r.path === '/v1/audio/transcriptions')!;
    expect(request.fields).toMatchObject({ model: ['gpt-4o-transcribe'], response_format: ['json'], language: ['en'] });
  });

  it('自定义端点（OpenAI 兼容）：不带密钥，WAV 切片，声明的模型', async () => {
    await side.client.request('models.configure', {
      providerId: 'custom:studio',
      enabled: true,
      endpoint: `${openai.origin}/compat/v1`,
      models: [{ modelId: 'large-v3' }],
    });
    await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'custom:studio' });
    const { videoId, assetId } = await videoWithAudio();
    const { jobId } = await side.client.request('models.transcribe', { videoId, assetId });
    const job = await settled(jobId);
    expect(job).toMatchObject({ state: 'completed', providerId: 'custom:studio', modelId: 'large-v3', bundleId: null });
    const content = await side.client.request('documents.read', { videoId, documentId: job.result!.documentId! });
    expect((content.body as { engine: Record<string, unknown> }).engine).toMatchObject({ provider: 'custom:studio' });
    const request = openai.requests.find((r) => r.path === '/compat/v1/audio/transcriptions')!;
    expect(request.headers.authorization).toBeUndefined();
    expect(request.file).toMatchObject({ type: 'audio/wav' });
    expect(request.fields.model).toEqual(['large-v3']);
    expect((await rawResult(job)).segments[0]!.words[0]!.timingQuality).toBe('provider');
  });

  it('Google：密钥在 x-goog-api-key 头、不在地址里；转写模型的词时间来自供应商，通用模型的插值', async () => {
    await side.client.request('models.configure', { providerId: 'google', enabled: true, credential: GOOGLE_KEY });
    await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'google' });
    const { videoId, assetId } = await videoWithAudio();
    const first = await settled((await side.client.request('models.transcribe', { videoId, assetId })).jobId);
    expect(first).toMatchObject({ state: 'completed', providerId: 'google', modelId: 'gemini-3.5-transcribe', bundleId: null });
    const content = await side.client.request('documents.read', { videoId, documentId: first.result!.documentId! });
    expect((content.body as { engine: Record<string, unknown> }).engine).toMatchObject({ provider: 'google', backend: 'online' });
    const result = await rawResult(first);
    expect(result.segments[0]!.words.map((w) => [w.text, w.timingQuality])).toEqual([
      ['hello', 'provider'],
      ['world', 'provider'],
    ]);
    const request = google.requests.find((r) => r.path === '/v1beta/interactions')!;
    expect(request.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    expect(request.headers['api-revision']).toBe('2026-05-20');
    expect(request.path).not.toContain(GOOGLE_KEY);
    expect(request.json).toMatchObject({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', mime_type: 'audio/flac', data: expect.any(String) }],
      generation_config: { transcription_config: { mode: { type: 'verbatim', timestamp_granularities: ['word'] } } },
    });

    const second = await settled((await side.client.request('models.transcribe', { videoId, assetId, model: 'gemini-3.8-flash' })).jobId);
    expect(second).toMatchObject({ state: 'completed', modelId: 'gemini-3.8-flash' });
    const general = await rawResult(second);
    expect(general.language).toMatchObject({ tag: 'en', source: 'detected' });
    expect(general.segments[0]!.words.every((w) => w.timingQuality === 'estimated')).toBe(true);
    await expectNoSecret(GOOGLE_KEY);
  });

  it('OpenAI 是默认值时显式指定 provider: local，走本机的 Worker', async () => {
    await useOpenAi();
    const { videoId, assetId } = await videoWithAudio();
    const { jobId } = await side.client.request('models.transcribe', { videoId, assetId, provider: 'local' });
    const job = await settled(jobId);
    expect(job).toMatchObject({
      state: 'completed',
      providerId: 'local',
      modelId: DEFAULT_TRANSCRIBE_BUNDLE,
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
    });
    expect(openai.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('401：PROVIDER_AUTH_FAILED，不重试，供应商回显的密钥不出现在任何地方', async () => {
    await useOpenAi();
    openai.handler = () => ({ status: 401, json: { error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } } });
    const { videoId, assetId } = await videoWithAudio();
    const job = await settled((await side.client.request('models.transcribe', { videoId, assetId })).jobId);
    expect(job).toMatchObject({
      state: 'failed',
      attempt: 1,
      error: { code: 'PROVIDER_AUTH_FAILED', details: { providerId: 'openai', status: 401 } },
    });
    expect(job.error!.message).toContain('[REDACTED]');
    expect(openai.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    await expectNoSecret(OPENAI_KEY);
  });

  it('5xx：退避重试 3 次之后 PROVIDER_UNAVAILABLE，JobManager 不再重试', async () => {
    await useOpenAi();
    openai.handler = () => ({ status: 503, json: { error: { message: 'overloaded' } } });
    const { videoId, assetId } = await videoWithAudio();
    const job = await settled((await side.client.request('models.transcribe', { videoId, assetId })).jobId);
    expect(job).toMatchObject({
      state: 'failed',
      attempt: 1,
      error: { code: 'PROVIDER_UNAVAILABLE', details: { attempts: 3, status: 503 } },
    });
    expect(openai.requests.filter((r) => r.method === 'POST')).toHaveLength(3);
  });

  it('取消进行中的请求：任务 cancelled，供应商看到连接关闭', async () => {
    await useOpenAi();
    openai.handler = () => 'hang';
    const { videoId, assetId } = await videoWithAudio();
    const { jobId } = await side.client.request('models.transcribe', { videoId, assetId });
    await openai.waitForRequests(1);
    expect(await side.client.request('jobs.cancel', { jobId })).toEqual({ state: 'cancelled' });
    expect(await settled(jobId)).toMatchObject({ state: 'cancelled', error: null });
    await openai.waitForClosedEarly(1);
    expect(openai.requests).toHaveLength(1);
  });
});
