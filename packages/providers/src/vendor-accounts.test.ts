import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelServiceStore, ProviderFailure, UsageLedger, type TextParameters } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import type { AdapterConfig, TextAdapter } from './adapter.ts';
import { AnthropicTextAdapter } from './anthropic/anthropic-text.ts';
import { OnlineProviderSource } from './online-source.ts';
import { VendorTextAdapter } from './openai-compatible/vendor-text.ts';
import {
  chatCompletionReply,
  startFakeProviderServer,
  type FakeProviderServer,
  type FakeReply,
  type RecordedRequest,
} from './testing/fake-provider-server.ts';
import { COMPAT_VENDORS } from './vendor-catalog.ts';

/**
 * 服务商目录的新成员与账号（架构设计 §6.4、§6.8、§6.10）：Anthropic 原生适配器、OpenAI 兼容服务商的结构化输出写法、
 * 账号的地区与基址优先级、调用结果写进账号状态与用量账本。只对着本机的假供应商；密钥是这里编的字符串。
 */

const KEY_A = 'sk-ant-test-ONLY-FOR-TESTS-aaaaaaaaaaaa';
const KEY_B = 'sk-ant-test-ONLY-FOR-TESTS-bbbbbbbbbbbb';
const VENDOR_KEY = 'sk-vendor-test-ONLY-0123456789abcdef';
const http = { backoffMs: () => 1, timeoutMs: 5_000 };

let server: FakeProviderServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function config(base: string, credential: string | null): AdapterConfig {
  return { providerId: 'test', baseUrl: base, credential, declared: [] };
}

function params(overrides: Partial<TextParameters> = {}): TextParameters {
  return {
    capability: 'generateText',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ],
    responseFormat: { type: 'text' },
    maxOutputTokens: 256,
    temperature: null,
    requestedEffort: null,
    effort: null,
    seed: null,
    ...overrides,
  };
}

const SCHEMA = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false };

function call(adapter: TextAdapter, cfg: AdapterConfig, modelId: string, parameters: TextParameters) {
  const model = adapter.models(cfg).find((m) => m.modelId === modelId)!;
  expect(model).toBeDefined();
  return adapter.generate({ config: cfg, model, parameters, signal: new AbortController().signal, http, onRetry: () => {} });
}

async function failure(promise: Promise<unknown>): Promise<ProviderFailure> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderFailure);
  return error as ProviderFailure;
}

function anthropicReply(request: RecordedRequest, text: string, extra: Record<string, unknown> = {}): FakeReply {
  const model = String((request.json as { model?: unknown } | undefined)?.model ?? 'model');
  return {
    status: 200,
    json: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model,
      content: [
        { type: 'thinking', thinking: 'hmm', signature: 'x' },
        { type: 'text', text },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, cache_read_input_tokens: 400, cache_creation_input_tokens: 0, output_tokens: 20 },
      ...extra,
    },
  };
}

describe('Anthropic 文本（Messages）', () => {
  it('模型表：默认 claude-sonnet-5-5；Haiku 不调推理强度、接受 temperature', () => {
    const models = new AnthropicTextAdapter().models(config('x', null));
    expect(models.find((m) => m.default)?.modelId).toBe('claude-sonnet-5-5');
    expect(models.find((m) => m.modelId === 'claude-opus-5-5')).toMatchObject({ defaultEffort: 'medium', acceptsTemperature: false });
    expect(models.find((m) => m.modelId === 'claude-haiku-4-5')).toMatchObject({
      efforts: [],
      acceptsTemperature: true,
      contextTokens: 200_000,
    });
  });

  it('请求形状：x-api-key 与 anthropic-version，system 在顶层，output_config 带推理强度与 JSON Schema；跳过思考块，输入含缓存', async () => {
    server = await startFakeProviderServer((request) => anthropicReply(request, '{"title":"x"}'));
    const format = { type: 'json' as const, schema: SCHEMA, name: 'outline' };
    const reply = await call(
      new AnthropicTextAdapter(),
      config(server.origin, KEY_A),
      'claude-sonnet-5-5',
      params({ effort: 'high', responseFormat: format }),
    );
    expect(reply).toMatchObject({
      text: '{"title":"x"}',
      finishReason: 'stop',
      usage: { inputTokens: 500, outputTokens: 20, cachedTokens: 400 },
      modelVersion: 'claude-sonnet-5-5',
    });
    const [request] = server.requests;
    expect(request).toMatchObject({ method: 'POST', path: '/v1/messages' });
    expect(request!.headers['x-api-key']).toBe(KEY_A);
    expect(request!.headers['anthropic-version']).toBe('2023-06-01');
    expect(request!.headers.authorization).toBeUndefined();
    expect(request!.json).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 256,
      system: 'be brief',
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    });
    expect(request!.body.toString('utf8')).not.toContain(KEY_A);
  });

  it('结束原因：max_tokens 是 length，refusal 是 content-filter', async () => {
    let stop = 'max_tokens';
    server = await startFakeProviderServer((request) => anthropicReply(request, 'x', { stop_reason: stop }));
    const adapter = new AnthropicTextAdapter();
    expect((await call(adapter, config(server.origin, KEY_A), 'claude-haiku-4-5', params({ temperature: 0.2 }))).finishReason).toBe(
      'length',
    );
    expect((server.requests[0]!.json as Record<string, unknown>).temperature).toBe(0.2);
    stop = 'refusal';
    expect((await call(adapter, config(server.origin, KEY_A), 'claude-haiku-4-5', params())).finishReason).toBe('content-filter');
  });

  it('错误分类：认证、余额不足、提示过长、模型不存在、限速；回显的密钥被去掉', async () => {
    let reply: FakeReply = { status: 401, json: {} };
    server = await startFakeProviderServer(() => reply);
    const cases: Array<[FakeReply, Record<string, unknown>]> = [
      [
        { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY_A}` } } },
        { code: 'PROVIDER_AUTH_FAILED' },
      ],
      [
        { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } } },
        { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'insufficient-quota' },
      ],
      [
        { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 1000001 tokens' } } },
        { code: 'INPUT_TOO_LONG', reason: 'context-length' },
      ],
      [
        { status: 404, json: { type: 'error', error: { type: 'not_found_error', message: 'model: claude-nope' } } },
        { code: 'PROVIDER_REJECTED', reason: 'model-not-found' },
      ],
      [
        {
          status: 429,
          json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
          headers: { 'retry-after': '120' },
        },
        { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'rate-limited', retryAfterSec: 120 },
      ],
    ];
    for (const [next, details] of cases) {
      reply = next;
      const before = server.requests.length;
      const error = await failure(call(new AnthropicTextAdapter(), config(server.origin, KEY_A), 'claude-sonnet-5-5', params()));
      expect(error.details).toMatchObject(details);
      expect(error.message).not.toContain(KEY_A);
      expect(server.requests.length - before).toBe(1);
    }
  });

  it('列模型：GET /v1/models 的 data[].id', async () => {
    server = await startFakeProviderServer(() => ({
      status: 200,
      json: { data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] },
    }));
    const listing = await new AnthropicTextAdapter().listModels(config(server.origin, KEY_A), new AbortController().signal, http);
    expect(listing.models).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models?limit=1000' });
    expect(server.requests[0]!.headers['x-api-key']).toBe(KEY_A);
  });
});

describe('OpenAI 兼容服务商（目录）', () => {
  it('只支持 JSON 模式的：json_object，schema 写进系统消息；max_tokens；读出缓存命中', async () => {
    server = await startFakeProviderServer((request) => {
      const reply = chatCompletionReply(request, '{"title":"x"}') as { status: number; json: Record<string, unknown> };
      reply.json.usage = { prompt_tokens: 50, completion_tokens: 5, prompt_cache_hit_tokens: 30 };
      return reply;
    });
    const deepseek = COMPAT_VENDORS.deepseek;
    const adapter = new VendorTextAdapter({ label: deepseek.label, models: deepseek.models, jsonMode: deepseek.jsonMode });
    const modelId = deepseek.models.find((m) => m.default)!.modelId;
    const reply = await call(
      adapter,
      config(`${server.origin}/v1`, VENDOR_KEY),
      modelId,
      params({ responseFormat: { type: 'json', schema: SCHEMA, name: 'o' } }),
    );
    expect(reply.usage).toMatchObject({ inputTokens: 50, outputTokens: 5, cachedTokens: 30 });
    const body = server.requests[0]!.json as {
      messages: Array<{ role: string; content: string }>;
      response_format: unknown;
      max_tokens: number;
    };
    expect(server.requests[0]).toMatchObject({ path: '/v1/chat/completions' });
    expect(server.requests[0]!.headers.authorization).toBe(`Bearer ${VENDOR_KEY}`);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(256);
    expect(
      body.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n'),
    ).toContain(JSON.stringify(SCHEMA));
  });

  it('支持 JSON Schema 的：json_schema，不加系统消息', async () => {
    server = await startFakeProviderServer((request) => chatCompletionReply(request, '{"title":"x"}'));
    const xai = COMPAT_VENDORS.xai;
    const adapter = new VendorTextAdapter({ label: xai.label, models: xai.models, jsonMode: xai.jsonMode });
    await call(
      adapter,
      config(`${server.origin}/v1`, VENDOR_KEY),
      xai.models[0]!.modelId,
      params({ responseFormat: { type: 'json', schema: SCHEMA, name: 'o' } }),
    );
    const body = server.requests[0]!.json as { messages: unknown[]; response_format: { type: string } };
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages).toHaveLength(2);
  });

  it('目录：每家都有默认模型、目录信息与至少一个地区；只用 https', () => {
    for (const [id, vendor] of Object.entries(COMPAT_VENDORS)) {
      expect(
        vendor.models.filter((m) => m.default),
        id,
      ).toHaveLength(1);
      expect(vendor.vendor.icon, id).toBe(id);
      expect(Object.keys(vendor.regions).length, id).toBeGreaterThan(0);
      for (const url of Object.values(vendor.regions)) expect(url, id).toMatch(/^https:\/\//);
    }
  });
});

describe('账号：地区、基址、调用结果与用量', () => {
  async function withSource(
    baseUrls: Record<string, string>,
    body: (ctx: { source: OnlineProviderSource; store: ModelServiceStore; ledger: UsageLedger; dir: string }) => Promise<void>,
  ) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-accounts-'));
    try {
      const store = await ModelServiceStore.open(
        { modelServicesFile: path.join(dir, 'model-services.json') },
        new FileCredentialStore(path.join(dir, 'model-credentials.json')),
      );
      const ledger = new UsageLedger(path.join(dir, 'usage.jsonl'));
      const source = new OnlineProviderSource({
        store,
        ffmpeg: async () => ({ command: 'ffmpeg', env: {} }),
        baseUrls,
        http,
        usage: ledger,
      });
      try {
        await body({ source, store, ledger, dir });
      } finally {
        // 账本追加与最近使用时间的写入是在后台排队的：删目录之前等它们写完。
        await ledger.flush();
        await store.flush();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async function generate(source: OnlineProviderSource, providerId: string, modelId: string) {
    return source
      .textProvider(providerId)!
      .generateText({ providerId, modelId, parameters: params(), source: 'job', ref: { jobId: 'job_1' } }, new AbortController().signal, {
        retry: () => {},
      });
  }

  it('地区：只接受目录里的地区；没有地区的服务商不接受；本地与不存在的 Provider 没有账号', async () => {
    await withSource({}, async ({ source }) => {
      await expect(source.addAccount({ providerId: 'moonshot', credential: VENDOR_KEY, region: 'eu' })).rejects.toMatchObject({
        code: 'invalid-request',
        details: { regions: ['global', 'cn'] },
      });
      await expect(source.addAccount({ providerId: 'openai', credential: VENDOR_KEY, region: 'cn' })).rejects.toMatchObject({
        code: 'invalid-request',
      });
      await expect(source.addAccount({ providerId: 'local', credential: VENDOR_KEY })).rejects.toMatchObject({ code: 'invalid-request' });
      await expect(source.addAccount({ providerId: 'custom:none', credential: VENDOR_KEY })).rejects.toMatchObject({ code: 'not-found' });
      await source.addAccount({ providerId: 'moonshot', credential: VENDOR_KEY, region: 'cn' });
      await expect(source.updateAccount({ providerId: 'moonshot', accountId: 'nope', enabled: false })).rejects.toMatchObject({
        code: 'not-found',
        details: { code: 'ACCOUNT_NOT_FOUND' },
      });
      const view = (await source.describe('moonshot', 'view'))!;
      expect(view.vendor).toMatchObject({ kind: 'vendor', regions: ['global', 'cn'] });
      expect(view.config!.accounts).toEqual([
        expect.objectContaining({ accountId: 'main', region: 'cn', credential: 'set', masked: 'sk-…cdef' }),
      ]);
      expect(JSON.stringify(view)).not.toContain(VENDOR_KEY);
    });
  });

  it('基址：账号的端点 > 服务商的端点 > 目录预设', async () => {
    const hits: string[] = [];
    server = await startFakeProviderServer((request) => {
      hits.push(request.path);
      return anthropicReply(request, 'ok');
    });
    await withSource({ anthropic: `${server.origin}/preset` }, async ({ source }) => {
      // 加账号不等于启用（启用是对外发的授权，§6.8）。
      await source.addAccount({ providerId: 'anthropic', credential: KEY_A });
      await expect(generate(source, 'anthropic', 'claude-sonnet-5-5')).rejects.toMatchObject({ kind: 'unavailable' });
      await source.configure({ providerId: 'anthropic', enabled: true });
      await generate(source, 'anthropic', 'claude-sonnet-5-5');
      await source.configure({ providerId: 'anthropic', enabled: true, endpoint: `${server!.origin}/provider` });
      await generate(source, 'anthropic', 'claude-sonnet-5-5');
      await source.updateAccount({ providerId: 'anthropic', accountId: 'main', endpoint: `${server!.origin}/account/` });
      await generate(source, 'anthropic', 'claude-sonnet-5-5');
      expect(hits).toEqual(['/preset/v1/messages', '/provider/v1/messages', '/account/v1/messages']);
    });
  });

  it('调用结果：401 记为密钥无效，429 记为限速（到期时间来自 Retry-After）；不换账号；每次调用写一条用量', async () => {
    let reply: (request: RecordedRequest) => FakeReply = (request) => anthropicReply(request, 'ok');
    server = await startFakeProviderServer((request) => reply(request));
    await withSource({ anthropic: server.origin }, async ({ source, ledger, store }) => {
      await source.configure({ providerId: 'anthropic', enabled: true });
      await source.addAccount({ providerId: 'anthropic', credential: KEY_A, label: '个人' });
      await source.addAccount({ providerId: 'anthropic', credential: KEY_B });

      await generate(source, 'anthropic', 'claude-sonnet-5-5');
      reply = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
      await expect(generate(source, 'anthropic', 'claude-sonnet-5-5')).rejects.toBeInstanceOf(ProviderFailure);
      // 第一个账号失败也不改用第二个（§6.2）。
      expect(server!.requests.map((r) => r.headers['x-api-key'])).toEqual([KEY_A, KEY_A]);
      let accounts = (await source.describe('anthropic', 'view'))!.config!.accounts!;
      expect(accounts.map((a) => [a.label, a.status.state])).toEqual([
        ['个人', 'invalid-key'],
        [null, 'unknown'],
      ]);

      // 换到第二个账号（排到最前）之后用它；限速记下到期时间。
      const second = accounts[1]!.accountId;
      await source.arrangeAccounts({ providerId: 'anthropic', order: [second, 'main'] });
      reply = () => ({
        status: 429,
        json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } },
        headers: { 'retry-after': '120' },
      });
      await expect(generate(source, 'anthropic', 'claude-sonnet-5-5')).rejects.toBeInstanceOf(ProviderFailure);
      expect(server!.requests.at(-1)!.headers['x-api-key']).toBe(KEY_B);
      accounts = (await source.describe('anthropic', 'view'))!.config!.accounts!;
      const limited = accounts.find((a) => a.accountId === second)!;
      expect(limited.status.state).toBe('rate-limited');
      expect(Date.parse((limited.status as { until: string }).until) - Date.parse(limited.status.at!)).toBe(120_000);
      expect(limited.lastUsedAt).toBeTruthy();

      await ledger.flush();
      await store.flush();
      const records = await ledger.read();
      expect(records.map((r) => [r.accountId, r.status, r.source, r.capability, r.modelId])).toEqual([
        ['main', 'ok', 'job', 'generateText', 'claude-sonnet-5-5'],
        ['main', 'error', 'job', 'generateText', 'claude-sonnet-5-5'],
        [second, 'error', 'job', 'generateText', 'claude-sonnet-5-5'],
      ]);
      expect(records[0]).toMatchObject({
        ref: { jobId: 'job_1' },
        units: { inputTokens: 500, outputTokens: 20, cachedTokens: 400 },
        cost: { kind: 'unknown' },
      });
      expect(records[1]!.error).toMatch(/^PROVIDER_AUTH_FAILED/);
      expect(JSON.stringify(records)).not.toContain(KEY_A);
      expect(JSON.stringify(records)).not.toContain(KEY_B);
    });
  });

  it('验证：新密钥不通过不保存，记一条账号为 null 的验证用量；已保存的通过后状态是 ok', async () => {
    let ok = false;
    server = await startFakeProviderServer(() =>
      ok
        ? { status: 200, json: { data: [{ id: 'claude-sonnet-5-5' }] } }
        : { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
    );
    await withSource({ anthropic: server.origin }, async ({ source, ledger }) => {
      await expect(source.addAccount({ providerId: 'anthropic', credential: KEY_A, verify: true })).rejects.toMatchObject({
        code: 'conflict',
        details: { code: 'PROVIDER_AUTH_FAILED' },
      });
      expect((await source.describe('anthropic', 'view'))!.config?.accounts ?? []).toEqual([]);
      ok = true;
      await source.addAccount({ providerId: 'anthropic', credential: KEY_A });
      await source.updateAccount({ providerId: 'anthropic', accountId: 'main', verify: true });
      expect((await source.describe('anthropic', 'view'))!.config!.accounts![0]!.status.state).toBe('ok');
      await ledger.flush();
      expect((await ledger.read()).map((r) => [r.source, r.accountId, r.capability, r.modelId, r.status])).toEqual([
        ['verify', null, null, null, 'error'],
        ['verify', 'main', null, null, 'ok'],
      ]);
    });
  });

  it('不可用的原因带着引用：没启用、没有密钥', async () => {
    await withSource({}, async ({ source }) => {
      const off = (await source.describe('qwen', 'view'))!;
      const offCap = Object.values(off.capabilities)[0]!;
      expect(offCap).toMatchObject({ available: false, unavailableReason: 'not-configured', detailRef: { key: 'providersConfig.notEnabled' } });
      await source.configure({ providerId: 'qwen', enabled: true });
      const noKey = Object.values((await source.describe('qwen', 'view'))!.capabilities)[0]!;
      expect(noKey).toMatchObject({ available: false, unavailableReason: 'missing-credential', detailRef: { key: 'providersConfig.noKey' } });
    });
  });

  it('移除目录里的服务商：停用并删掉所有账号与凭据；删掉最后一个账号时服务商留着', async () => {
    await withSource({}, async ({ source, dir }) => {
      await source.configure({ providerId: 'qwen', enabled: true });
      await source.addAccount({ providerId: 'qwen', credential: VENDOR_KEY });
      await source.removeAccount('qwen', 'main');
      expect((await source.describe('qwen', 'view'))!.config).toMatchObject({ enabled: true });
      await source.addAccount({ providerId: 'qwen', credential: VENDOR_KEY, region: 'cn' });
      await source.addAccount({ providerId: 'qwen', credential: KEY_B });
      expect(await source.remove('qwen')).toBe(true);
      const view = (await source.describe('qwen', 'view'))!;
      expect(view.config?.enabled ?? false).toBe(false);
      expect(view.config?.accounts ?? []).toEqual([]);
      const credentials = await fs.readFile(path.join(dir, 'model-credentials.json'), 'utf8').catch(() => '{}');
      expect(credentials).not.toContain(VENDOR_KEY);
      expect(credentials).not.toContain(KEY_B);
    });
  });
});
