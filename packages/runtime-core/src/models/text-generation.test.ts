import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyJobsEvent } from '@baocut/client';
import { TextGenerationError } from '@baocut/models';
import {
  chatCompletionReply,
  fakeGoogleHandler,
  fakeOpenAiHandler,
  startFakeProviderServer,
  type FakeHandler,
  type FakeProviderServer,
} from '@baocut/providers/testing';
import { RpcError, type CapabilityNotConfiguredDetails, type JobRecord, type JobsSnapshot } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * 文本生成（`models.generateText`、进程内的 `TextGenerator`，架构设计 §6.1、§6.4）与 `models.refreshProvider`、
 * `models.setCapabilityParameters`（§6.8）经网关端到端：选择与「没有配置」、默认值与过时的默认值、任务 → 假供应商 →
 * 校验 → 产物 → `artifacts.openHandle` 读回、幂等的 commandId、刷新模型列表，以及密钥不出现在任何记录里。
 * 测试只连本机回环地址上的假供应商，密钥是测试里编的字符串。
 */

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-text-e2e-0123456789';
const GOOGLE_KEY = 'AIzaTESTONLY-text-e2e-0123456789abcdefgh';

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
  runtime: RunningRuntime;
  client: BaoCutClient;
  received: unknown[];
  jobs(): JobsSnapshot | null;
}

async function startSide(servers: { openai?: FakeProviderServer; google?: FakeProviderServer }): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-text-gen-'));
  const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  const runtime = await startRuntime({
    home,
    drivers: () => [],
    watchSpace: false,
    engineHost: null,
    videoGraceMs: 100,
    modelWorker: null,
    jobIdleMs: 60_000,
    online: {
      baseUrls: {
        ...(servers.openai ? { openai: `${servers.openai.origin}/v1` } : {}),
        ...(servers.google ? { google: `${servers.google.origin}/v1beta` } : {}),
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
  client.subscribeModels({ snapshot: (s) => received.push(s), event: (e) => received.push(e) });
  await until(() => jobs);
  return { dir, home, runtime, client, received, jobs: () => jobs };
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

/** 日志、账本、配置、主题与诊断目录里都不能出现密钥。 */
async function expectNoSecret(side: Side, secret: string) {
  const files = [path.join(side.home.logsDir, 'runtime.log'), side.home.jobsFile, side.home.modelServicesFile];
  for (const file of files) expect(await fs.readFile(file, 'utf8').catch(() => ''), file).not.toContain(secret);
  const diagnostics = path.join(side.home.logsDir, 'diagnostics');
  for (const name of await fs.readdir(diagnostics, { recursive: true }).catch(() => [] as string[])) {
    const file = path.join(diagnostics, String(name));
    expect(await fs.readFile(file, 'utf8').catch(() => ''), file).not.toContain(secret);
  }
  expect(JSON.stringify(side.received)).not.toContain(secret);
  expect(JSON.stringify(await side.client.request('jobs.list', {}))).not.toContain(secret);
  expect(JSON.stringify(await side.client.request('models.capabilities', {}))).not.toContain(secret);
}

async function readArtifact(side: Side, artifactId: string): Promise<{ text: string; mimeType: string }> {
  const handle = await side.client.request('artifacts.openHandle', { artifactId });
  const response = await fetch(handle.url);
  expect(response.status).toBe(200);
  return { text: await response.text(), mimeType: handle.mimeType };
}

describe('文本生成（经网关）', () => {
  let side: Side | undefined;
  let openai: FakeProviderServer | undefined;
  let google: FakeProviderServer | undefined;

  afterEach(async () => {
    await stopSide(side);
    await openai?.close();
    await google?.close();
    side = openai = google = undefined;
  });

  it('什么都没配置：能力视图列出所有内置文本服务商，没有出厂默认；提交与进程内调用都以 CAPABILITY_NOT_CONFIGURED 拒绝', async () => {
    side = await startSide({});
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.generateText).toMatchObject({ default: null, effective: null, parameters: { effort: null, concurrency: 4 } });
    expect(capabilities.generateText.providers.map((p) => p.providerId)).toEqual([
      'openai',
      'google',
      'anthropic',
      'deepseek',
      'moonshot',
      'qwen',
      'zhipu',
      'minimax',
      'volcengine',
      'xai',
      'mistral',
      'groq',
      'openrouter',
      'siliconflow',
    ]);
    expect(capabilities.generateText.providers.every((p) => !p.available)).toBe(true);

    const error = await side.client
      .request('models.generateText', { messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      code: 'conflict',
      details: {
        code: 'CAPABILITY_NOT_CONFIGURED',
        capability: 'generateText',
        reason: 'no-default',
        remedy: { action: 'configure-provider' },
      },
    });
    expect(((error as RpcError).details as CapabilityNotConfiguredDetails).remedy.hint).toMatch(/./);
    const inProcess = await side.runtime.models.services
      .textGenerator()
      .generate({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e);
    expect(inProcess).toMatchObject({ code: 'conflict', details: { code: 'CAPABILITY_NOT_CONFIGURED' } });
    expect(await side.client.request('jobs.list', {})).toEqual({ jobs: [] });
  });

  it('OpenAI 是默认值：任务完成，全文是产物（openHandle 读回），结果带预览；commandId 幂等；密钥不出现在任何记录里', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler('Hello from the fake model.'));
    side = await startSide({ openai });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const { default: ref } = await side.client.request('models.setDefault', { capability: 'generateText', providerId: 'openai' });
    expect(ref).toEqual({ providerId: 'openai', modelId: 'gpt-6.1-sol' });
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.generateText.effective).toEqual({ providerId: 'openai', modelId: 'gpt-6.1-sol', source: 'user-default' });

    const request = {
      messages: [
        { role: 'system' as const, content: 'Be friendly.' },
        { role: 'user' as const, content: 'Say hello' },
      ],
      effort: 'high' as const,
      commandId: 'cmd_text_e2e_1',
    };
    const { jobId } = await side.client.request('models.generateText', request);
    expect((await side.client.request('models.generateText', request)).jobId).toBe(jobId);
    const job = await settled(side, jobId);
    expect(job).toMatchObject({
      state: 'completed',
      kind: 'generateText',
      providerId: 'openai',
      modelId: 'gpt-6.1-sol',
      generation: { capability: 'generateText', effort: 'high', requestedEffort: 'high', maxOutputTokens: 128_000 },
      result: {
        documentId: null,
        text: {
          mediaType: 'text/plain',
          preview: 'Hello from the fake model.',
          finishReason: 'stop',
          modelVersion: 'gpt-6.1-sol-2026-09-01',
          usage: { inputTokens: 12, outputTokens: 5 },
        },
      },
    });
    const artifact = await readArtifact(side, job.result!.artifactId);
    expect(artifact.text).toBe('Hello from the fake model.');
    expect(artifact.mimeType).toMatch(/^text\/plain/);
    expect(openai.requests.filter((r) => r.path === '/v1/chat/completions')).toHaveLength(1);
    expect(openai.requests[0]!.json).toMatchObject({ model: 'gpt-6.1-sol', reasoning_effort: 'high' });
    expect(side.runtime.models.services.textStats()).toEqual({ openai: { calls: 1, retries: 0, failures: 0 } });
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('Google 结构化输出：发布校验过的 JSON；不合 schema 时 MODEL_OUTPUT_INVALID，密钥不在错误里', async () => {
    let reply = '{"title":"Hi"}';
    const handler: FakeHandler = (request, server) =>
      request.path.endsWith(':generateContent') ? fakeGoogleHandler(reply)(request, server) : fakeGoogleHandler()(request, server);
    google = await startFakeProviderServer(handler);
    side = await startSide({ google });
    await side.client.request('models.configure', { providerId: 'google', enabled: true, credential: GOOGLE_KEY });
    const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
    const submit = () =>
      side!.client.request('models.generateText', {
        messages: [{ role: 'user', content: 'title please' }],
        responseFormat: { type: 'json', schema },
        provider: 'google',
        temperature: 0.3,
        seed: 42,
      });
    let job = await settled(side, (await submit()).jobId);
    expect(job).toMatchObject({ state: 'completed', modelId: 'gemini-3.8-flash', result: { text: { mediaType: 'application/json' } } });
    expect(JSON.parse((await readArtifact(side, job.result!.artifactId)).text)).toEqual({ title: 'Hi' });
    expect(google.requests[0]!.headers['x-goog-api-key']).toBe(GOOGLE_KEY);

    reply = '{"title":5}';
    job = await settled(side, (await submit()).jobId);
    expect(job).toMatchObject({ state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID', details: { reason: 'schema' } } });
    await expectNoSecret(side, GOOGLE_KEY);
  });

  it('上下文过长与认证失败按封闭的错误码；进程内调用得到同样的错误码与计数', async () => {
    let mode: 'too-long' | 'auth' | 'ok' = 'too-long';
    openai = await startFakeProviderServer((request) => {
      if (mode === 'too-long') return { status: 400, json: { error: { code: 'context_length_exceeded', message: 'too long' } } };
      if (mode === 'auth') return { status: 401, json: { error: { message: `Incorrect API key ${OPENAI_KEY}` } } };
      return chatCompletionReply(request, 'in-process ok');
    });
    side = await startSide({ openai });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const { jobId } = await side.client.request('models.generateText', { messages: [{ role: 'user', content: 'x' }], provider: 'openai' });
    expect((await settled(side, jobId)).error).toMatchObject({ code: 'INPUT_TOO_LONG', details: { reason: 'context-length' } });

    mode = 'auth';
    const generator = side.runtime.models.services.textGenerator();
    const error = await generator.generate({ messages: [{ role: 'user', content: 'x' }], provider: 'openai' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TextGenerationError);
    expect(error).toMatchObject({ code: 'PROVIDER_AUTH_FAILED', details: { providerId: 'openai' } });
    expect(JSON.stringify(error) + (error as Error).message).not.toContain(OPENAI_KEY);

    mode = 'ok';
    const result = await generator.generate({
      messages: [{ role: 'user', content: 'x' }],
      provider: 'openai',
      model: 'gpt-6-luna',
      effort: 'minimal',
    });
    expect(result).toMatchObject({
      text: 'in-process ok',
      finishReason: 'stop',
      modelId: 'gpt-6-luna',
      effort: { requested: 'minimal', applied: 'minimal' },
    });
    expect(generator.stats()).toEqual({ openai: { calls: 3, retries: 0, failures: 2 } });
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('能力参数：默认推理强度进冻结的参数；并发上限可改、可恢复出厂值', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler('ok'));
    side = await startSide({ openai });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    expect(
      await side.client.request('models.setCapabilityParameters', { capability: 'generateText', effort: 'low', concurrency: 2 }),
    ).toEqual({
      parameters: { effort: 'low', concurrency: 2 },
    });
    expect((await side.client.request('models.capabilities', {})).capabilities.generateText.parameters).toEqual({
      effort: 'low',
      concurrency: 2,
    });
    const { jobId } = await side.client.request('models.generateText', { messages: [{ role: 'user', content: 'x' }], provider: 'openai' });
    expect((await settled(side, jobId)).generation).toMatchObject({ requestedEffort: 'low', effort: 'low' });
    expect(
      await side.client.request('models.setCapabilityParameters', { capability: 'generateText', effort: null, concurrency: null }),
    ).toEqual({
      parameters: { effort: null, concurrency: 4 },
    });
    const invalid = await side.client
      .request('models.setCapabilityParameters', { capability: 'generateText', concurrency: 0 })
      .catch((e: unknown) => e);
    expect(invalid).toMatchObject({ code: 'invalid-request' });
  });

  it('refreshProvider：成功时标注不在列表里的模型；指向它的默认值变成过时的，提交以 CAPABILITY_NOT_CONFIGURED 拒绝；失败时照旧用内置列表', async () => {
    let fail = false;
    openai = await startFakeProviderServer((request) => {
      if (request.method === 'GET' && request.path === '/v1/models') {
        return fail
          ? { status: 500, json: { error: { message: `boom ${OPENAI_KEY}` } } }
          : { status: 200, json: { data: [{ id: 'gpt-6.1-sol' }] } };
      }
      return fakeOpenAiHandler()(request, openai!);
    });
    side = await startSide({ openai });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await side.client.request('models.setDefault', { capability: 'generateText', providerId: 'openai', modelId: 'gpt-6-astra' });

    const { refreshed, provider } = await side.client.request('models.refreshProvider', { providerId: 'openai' });
    expect(refreshed).toMatchObject({ ok: true, models: 1 });
    expect(provider.config!.refreshed).toEqual(refreshed);
    expect(provider.capabilities.generateText!.models.find((m) => m.modelId === 'gpt-6-astra')).toMatchObject({
      available: false,
      unavailableReason: 'unsupported',
    });
    const stale = await side.client.request('models.generateText', { messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e);
    expect(stale).toMatchObject({ code: 'conflict', details: { code: 'CAPABILITY_NOT_CONFIGURED', capability: 'generateText' } });

    fail = true;
    const failed = await side.client.request('models.refreshProvider', { providerId: 'openai' });
    expect(failed.refreshed).toMatchObject({ ok: false });
    expect(failed.refreshed.error).not.toContain(OPENAI_KEY);
    expect(failed.provider.capabilities.generateText!.models.every((m) => m.available !== false)).toBe(true);
    // 回到内置列表：默认值又可用了。
    const { jobId } = await side.client.request('models.generateText', { messages: [{ role: 'user', content: 'x' }] });
    expect(await settled(side, jobId)).toMatchObject({ state: 'completed', modelId: 'gpt-6-astra' });

    const local = await side.client.request('models.refreshProvider', { providerId: 'local' }).catch((e: unknown) => e);
    expect(local).toMatchObject({ code: 'invalid-request' });
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('停用默认的 Provider：默认值保留但不可用，提交以 CAPABILITY_NOT_CONFIGURED 拒绝', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ openai });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await side.client.request('models.setDefault', { capability: 'generateText', providerId: 'openai' });
    await side.client.request('models.configure', { providerId: 'openai', enabled: false });
    const { capabilities } = await side.client.request('models.capabilities', {});
    expect(capabilities.generateText.default).toEqual({ providerId: 'openai', modelId: 'gpt-6.1-sol' });
    const error = await side.client.request('models.generateText', { messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'conflict', details: { code: 'CAPABILITY_NOT_CONFIGURED', capability: 'generateText' } });
    expect(openai.requests).toHaveLength(0);
  });
});
