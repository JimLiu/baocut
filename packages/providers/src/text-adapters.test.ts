import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelServiceStore, ProviderFailure, TextRunner, type TextParameters, type TextRun } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import type { AdapterConfig, TextAdapter } from './adapter.ts';
import { ElevenLabsAdapter } from './elevenlabs/elevenlabs-adapter.ts';
import { GoogleTextAdapter } from './google/google-text.ts';
import { ProviderAborted, retryAfterSeconds } from './http/provider-fetch.ts';
import { OnlineProviderSource } from './online-source.ts';
import { OnlineTextProvider } from './online-text.ts';
import { CompatibleTextAdapter } from './openai-compatible/compatible-text.ts';
import { OpenAiTextAdapter } from './openai/openai-text.ts';
import {
  chatCompletionReply,
  fakeElevenLabsHandler,
  fakeGoogleHandler,
  fakeOpenAiHandler,
  geminiTextReply,
  startFakeProviderServer,
  type FakeProviderServer,
} from './testing/fake-provider-server.ts';

/**
 * 文本模型的适配器（`generateText`，架构设计 §6.4）对着本机的假供应商：请求形状、响应解析、结束原因、错误分类、
 * `Retry-After`、取消、并发上限，以及 `models.refreshProvider` 的列模型。从不连接真实的云服务；密钥是这里编的字符串。
 */

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-text-0123456789abcdef';
const GOOGLE_KEY = 'AIzaTESTONLY-text-0123456789abcdefghijk';
const ELEVENLABS_KEY = 'sk_test_ONLY_FOR_TESTS_text_0123456789abcdef';
const CUSTOM_KEY = 'custom-test-ONLY-0123456789abcdef';
const http = { backoffMs: () => 1, timeoutMs: 5_000 };

let server: FakeProviderServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function config(base: string, credential: string | null, declared: AdapterConfig['declared'] = []): AdapterConfig {
  return { providerId: 'test', baseUrl: base, credential, declared };
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

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, count: { type: 'integer' } },
  required: ['title', 'count'],
  additionalProperties: false,
};

function call(
  adapter: TextAdapter,
  cfg: AdapterConfig,
  modelId: string,
  parameters: TextParameters,
  options: { signal?: AbortSignal; retries?: number[]; timeoutMs?: number } = {},
) {
  const model = adapter.models(cfg).find((m) => m.modelId === modelId)!;
  expect(model).toBeDefined();
  return adapter.generate({
    config: cfg,
    model,
    parameters,
    signal: options.signal ?? new AbortController().signal,
    http: { ...http, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) },
    onRetry: () => options.retries?.push(1),
  });
}

async function failure(promise: Promise<unknown>): Promise<ProviderFailure> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderFailure);
  return error as ProviderFailure;
}

describe('OpenAI 文本（Chat Completions）', () => {
  it('模型表：默认 gpt-6.1-sol；推理强度按模型；不接受 temperature 与 seed', () => {
    const models = new OpenAiTextAdapter().models(config('x', null));
    expect(models.find((m) => m.default)?.modelId).toBe('gpt-6.1-sol');
    expect(models.find((m) => m.modelId === 'gpt-6.1-sol')!.efforts).toEqual(['low', 'medium', 'high']);
    expect(models.every((m) => m.structuredOutput && !m.acceptsTemperature && !m.acceptsSeed)).toBe(true);
  });

  it('请求形状：Bearer、messages 原样、max_completion_tokens 与 reasoning_effort；解出文本、用量与模型版本', async () => {
    server = await startFakeProviderServer(fakeOpenAiHandler('Hello there.'));
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    const reply = await call(new OpenAiTextAdapter(), cfg, 'gpt-6.1-sol', params({ effort: 'high', requestedEffort: 'high' }));
    expect(reply).toMatchObject({
      text: 'Hello there.',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 5 },
      modelVersion: 'gpt-6.1-sol-2026-09-01',
    });
    const [request] = server.requests;
    expect(request).toMatchObject({ method: 'POST', path: '/v1/chat/completions' });
    expect(request!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(request!.json).toEqual({
      model: 'gpt-6.1-sol',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
      max_completion_tokens: 256,
      reasoning_effort: 'high',
    });
    // 密钥只在认证头里。
    expect(request!.path).not.toContain(OPENAI_KEY);
    expect(request!.body.toString('utf8')).not.toContain(OPENAI_KEY);
  });

  it('结构化输出：发 json_schema（strict false）', async () => {
    server = await startFakeProviderServer((request) => chatCompletionReply(request, '{"title":"x","count":1}'));
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    const format = { type: 'json' as const, schema: SCHEMA, name: 'outline' };
    const reply = await call(new OpenAiTextAdapter(), cfg, 'gpt-6-luna', params({ responseFormat: format }));
    expect(reply.text).toBe('{"title":"x","count":1}');
    expect((server.requests[0]!.json as Record<string, unknown>).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'outline', schema: SCHEMA, strict: false },
    });
  });

  it('结束原因：length、content_filter、refusal 都读出来；认不出的是协议错误', async () => {
    let finish: string | null = 'length';
    let refusal = false;
    server = await startFakeProviderServer((request) => {
      const reply = chatCompletionReply(request, 'partial', { finishReason: finish });
      if (refusal && reply !== 'hang') {
        const body = reply.json as { choices: Array<{ message: Record<string, unknown> }> };
        body.choices[0]!.message = { role: 'assistant', content: null, refusal: 'I cannot help with that.' };
      }
      return reply;
    });
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    const adapter = new OpenAiTextAdapter();
    expect((await call(adapter, cfg, 'gpt-6.1-sol', params())).finishReason).toBe('length');
    finish = 'content_filter';
    expect((await call(adapter, cfg, 'gpt-6.1-sol', params())).finishReason).toBe('content-filter');
    finish = 'stop';
    refusal = true;
    expect(await call(adapter, cfg, 'gpt-6.1-sol', params())).toMatchObject({ finishReason: 'content-filter', text: '' });
    refusal = false;
    finish = 'tool_calls';
    expect((await failure(call(adapter, cfg, 'gpt-6.1-sol', params()))).kind).toBe('protocol');
  });

  it('错误分类：认证、上下文过长、模型不存在、内容过滤、额度用尽；回显的密钥被去掉', async () => {
    let reply: { status: number; json: unknown; headers?: Record<string, string> } = { status: 401, json: {} };
    server = await startFakeProviderServer(() => reply);
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    const adapter = new OpenAiTextAdapter();
    const cases: Array<[typeof reply, Record<string, unknown>]> = [
      [
        { status: 401, json: { error: { message: `Incorrect API key provided: ${OPENAI_KEY}`, code: 'invalid_api_key' } } },
        { code: 'PROVIDER_AUTH_FAILED', status: 401 },
      ],
      [
        { status: 400, json: { error: { message: 'too long', code: 'context_length_exceeded' } } },
        { code: 'INPUT_TOO_LONG', reason: 'context-length' },
      ],
      [
        { status: 404, json: { error: { message: 'The model does not exist', code: 'model_not_found' } } },
        { code: 'PROVIDER_REJECTED', reason: 'model-not-found' },
      ],
      [
        { status: 400, json: { error: { message: 'flagged', code: 'content_policy_violation' } } },
        { code: 'PROVIDER_REJECTED', reason: 'content-filter' },
      ],
      [
        { status: 429, json: { error: { message: 'quota', code: 'insufficient_quota' } }, headers: { 'retry-after': '1' } },
        { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'insufficient-quota', retryAfterSec: 1 },
      ],
      [
        { status: 429, json: { error: { message: 'slow down', code: 'rate_limit_exceeded' } }, headers: { 'retry-after': '120' } },
        { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'rate-limited', retryAfterSec: 120 },
      ],
    ];
    for (const [next, details] of cases) {
      reply = next;
      const before = server.requests.length;
      const error = await failure(call(adapter, cfg, 'gpt-6.1-sol', params()));
      expect(error.kind).toBe('rejected');
      expect(error.details).toMatchObject(details);
      expect(error.message).not.toContain(OPENAI_KEY);
      expect(JSON.stringify(error.details)).not.toContain(OPENAI_KEY);
      // 额度用尽与太久的 Retry-After 都不重试。
      expect(server.requests.length - before).toBe(1);
    }
  });

  it('限速带 Retry-After：按它等过之后重试，每次重试都回调', async () => {
    let calls = 0;
    server = await startFakeProviderServer((request) => {
      calls++;
      if (calls === 1) return { status: 429, json: { error: { code: 'rate_limit_exceeded' } }, headers: { 'retry-after': '1' } };
      return chatCompletionReply(request, 'ok');
    });
    const retries: number[] = [];
    const started = Date.now();
    const reply = await call(new OpenAiTextAdapter(), config(`${server.origin}/v1`, OPENAI_KEY), 'gpt-6.1-sol', params(), { retries });
    expect(reply.text).toBe('ok');
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(server.requests).toHaveLength(2);
    expect(retries).toHaveLength(1);
  });

  it('超时：重试 3 次后 PROVIDER_UNAVAILABLE（reason timeout）', async () => {
    server = await startFakeProviderServer(() => 'hang');
    const retries: number[] = [];
    const error = await failure(
      call(new OpenAiTextAdapter(), config(`${server.origin}/v1`, OPENAI_KEY), 'gpt-6.1-sol', params(), { retries, timeoutMs: 100 }),
    );
    expect(error.kind).toBe('unavailable-remote');
    expect(error.details).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', reason: 'timeout', attempts: 3 });
    expect(retries).toHaveLength(2);
  });

  it('取消：中止在途请求，抛 ProviderAborted，连接关闭', async () => {
    server = await startFakeProviderServer(() => 'hang');
    const controller = new AbortController();
    const pending = call(new OpenAiTextAdapter(), config(`${server.origin}/v1`, OPENAI_KEY), 'gpt-6.1-sol', params(), {
      signal: controller.signal,
    });
    await server.waitForRequests(1);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderAborted);
    await server.waitForClosedEarly(1);
  });
});

describe('Google 文本（generateContent）', () => {
  it('请求形状：x-goog-api-key、systemInstruction、assistant → model、generationConfig；跳过思考摘要', async () => {
    server = await startFakeProviderServer(fakeGoogleHandler('Bonjour.'));
    const cfg = config(`${server.origin}/v1beta`, GOOGLE_KEY);
    const reply = await call(
      new GoogleTextAdapter(),
      cfg,
      'gemini-3.8-flash',
      params({
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'in french' },
        ],
        temperature: 0.2,
        seed: 7,
        effort: 'low',
        requestedEffort: 'minimal',
        responseFormat: { type: 'json', schema: SCHEMA },
      }),
    );
    expect(reply).toMatchObject({
      text: 'Bonjour.',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 8 },
      modelVersion: 'gemini-3.8-flash-001',
    });
    const [request] = server.requests;
    expect(request).toMatchObject({ method: 'POST', path: '/v1beta/models/gemini-3.8-flash:generateContent' });
    expect(request!.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    expect(request!.headers.authorization).toBeUndefined();
    expect(request!.json).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
        { role: 'user', parts: [{ text: 'in french' }] },
      ],
      systemInstruction: { parts: [{ text: 'be brief' }] },
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.2,
        seed: 7,
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    });
    expect(request!.path).not.toContain(GOOGLE_KEY);
    expect(request!.body.toString('utf8')).not.toContain(GOOGLE_KEY);
  });

  it('结束原因：MAX_TOKENS 是 length，SAFETY 与输入被拦下是 content-filter，其余是被拒绝', async () => {
    let finish: string | null = 'MAX_TOKENS';
    let blocked = false;
    server = await startFakeProviderServer((request) =>
      blocked
        ? { status: 200, json: { promptFeedback: { blockReason: 'SAFETY' } } }
        : geminiTextReply(request, 'part', { finishReason: finish }),
    );
    const cfg = config(`${server.origin}/v1beta`, GOOGLE_KEY);
    const adapter = new GoogleTextAdapter();
    expect((await call(adapter, cfg, 'gemini-3.8-flash', params())).finishReason).toBe('length');
    finish = 'SAFETY';
    expect((await call(adapter, cfg, 'gemini-3.8-flash', params())).finishReason).toBe('content-filter');
    blocked = true;
    expect(await call(adapter, cfg, 'gemini-3.8-flash', params())).toMatchObject({ finishReason: 'content-filter', text: '' });
    blocked = false;
    finish = 'MALFORMED_FUNCTION_CALL';
    const error = await failure(call(adapter, cfg, 'gemini-3.8-flash', params()));
    expect(error).toMatchObject({ kind: 'rejected', details: { code: 'PROVIDER_REJECTED' } });
  });

  it('错误分类：API_KEY_INVALID 是认证失败，token 上限是 INPUT_TOO_LONG，404 是模型不存在', async () => {
    let reply: { status: number; json: unknown } = { status: 400, json: {} };
    server = await startFakeProviderServer(() => reply);
    const cfg = config(`${server.origin}/v1beta`, GOOGLE_KEY);
    const adapter = new GoogleTextAdapter();
    reply = {
      status: 400,
      json: {
        error: {
          code: 400,
          message: `API key not valid ${GOOGLE_KEY}`,
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      },
    };
    let error = await failure(call(adapter, cfg, 'gemini-3.8-flash', params()));
    expect(error.details).toMatchObject({ code: 'PROVIDER_AUTH_FAILED' });
    expect(error.message).not.toContain(GOOGLE_KEY);
    reply = {
      status: 400,
      json: { error: { code: 400, message: 'The input token count (2000000) exceeds the maximum number of tokens allowed (1048576).' } },
    };
    error = await failure(call(adapter, cfg, 'gemini-3.8-flash', params()));
    expect(error.details).toMatchObject({ code: 'INPUT_TOO_LONG', reason: 'context-length' });
    reply = { status: 404, json: { error: { code: 404, message: 'models/gemini-9 is not found', status: 'NOT_FOUND' } } };
    error = await failure(call(adapter, cfg, 'gemini-3.8-flash', params()));
    expect(error.details).toMatchObject({ code: 'PROVIDER_REJECTED', reason: 'model-not-found' });
  });
});

describe('OpenAI 兼容端点的文本', () => {
  it('声明的模型补上保守的默认值；用 max_tokens；没有密钥时不发 Authorization', async () => {
    const declared: AdapterConfig['declared'] = [
      { modelId: 'qwen3', capability: 'generateText', efforts: ['low', 'high'] },
      { modelId: 'llama', capability: 'generateText', contextTokens: 8192, maxOutputTokens: 1024, structuredOutput: false },
      { modelId: 'whisper', capability: 'transcribe' },
    ];
    server = await startFakeProviderServer((request) => chatCompletionReply(request, 'ok', { finishReason: null }));
    const cfg = config(`${server.origin}/v1`, null, declared);
    const adapter = new CompatibleTextAdapter(() => 'Studio');
    const models = adapter.models(cfg);
    expect(models.map((m) => m.modelId)).toEqual(['qwen3', 'llama']);
    expect(models[0]).toMatchObject({
      default: true,
      declared: true,
      contextTokens: 32_768,
      maxOutputTokens: 4096,
      efforts: ['low', 'high'],
      structuredOutput: true,
      acceptsTemperature: true,
      acceptsSeed: false,
    });
    expect(models[1]).toMatchObject({ contextTokens: 8192, maxOutputTokens: 1024, efforts: [], structuredOutput: false });
    // 没给 finish_reason 当作正常结束。
    expect(await call(adapter, cfg, 'qwen3', params({ effort: 'high', requestedEffort: 'high', temperature: 0.5 }))).toMatchObject({
      text: 'ok',
      finishReason: 'stop',
    });
    const [request] = server.requests;
    expect(request!.headers.authorization).toBeUndefined();
    expect(request!.json).toMatchObject({ model: 'qwen3', max_tokens: 256, reasoning_effort: 'high', temperature: 0.5 });
    expect((request!.json as Record<string, unknown>).max_completion_tokens).toBeUndefined();
  });

  it('有密钥时 Bearer', async () => {
    server = await startFakeProviderServer((request) => chatCompletionReply(request, 'ok'));
    const cfg = config(`${server.origin}/v1`, CUSTOM_KEY, [{ modelId: 'qwen3', capability: 'generateText' }]);
    await call(new CompatibleTextAdapter(() => 'Studio'), cfg, 'qwen3', params());
    expect(server.requests[0]!.headers.authorization).toBe(`Bearer ${CUSTOM_KEY}`);
  });
});

describe('列模型（models.refreshProvider 用）', () => {
  it('OpenAI 与兼容端点：GET /models 的 data[].id', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, { nope: 1 }] } }));
    const listing = await new OpenAiTextAdapter().listModels(config(`${server.origin}/v1`, OPENAI_KEY), new AbortController().signal, http);
    expect(listing).toEqual({ models: ['a', 'b'] });
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
  });

  it('Google：分页，去掉 models/ 前缀', async () => {
    server = await startFakeProviderServer((request) =>
      request.path.includes('pageToken=p2')
        ? { status: 200, json: { models: [{ name: 'models/gemini-3.7-flash' }] } }
        : { status: 200, json: { models: [{ name: 'models/gemini-3.8-flash' }], nextPageToken: 'p2' } },
    );
    const listing = await new GoogleTextAdapter().listModels(
      config(`${server.origin}/v1beta`, GOOGLE_KEY),
      new AbortController().signal,
      http,
    );
    expect(listing.models).toEqual(['gemini-3.7-flash', 'gemini-3.8-flash']);
    expect(server.requests.map((r) => r.path)).toEqual(['/v1beta/models?pageSize=1000', '/v1beta/models?pageSize=1000&pageToken=p2']);
  });

  it('ElevenLabs：模型与账号里的音色', async () => {
    server = await startFakeProviderServer((request) =>
      request.path.endsWith('/voices')
        ? { status: 200, json: { voices: [{ voice_id: 'v1', name: 'Rachel' }, { voice_id: 'v2' }] } }
        : { status: 200, json: [{ model_id: 'eleven_v3' }] },
    );
    const listing = await new ElevenLabsAdapter().listModels(
      config(`${server.origin}/v1`, ELEVENLABS_KEY),
      new AbortController().signal,
      http,
    );
    expect(listing).toEqual({
      models: ['eleven_v3'],
      voices: [
        { voiceId: 'v1', label: 'Rachel' },
        { voiceId: 'v2', label: 'v2' },
      ],
    });
    expect(server.requests.every((r) => r.headers['xi-api-key'] === ELEVENLABS_KEY)).toBe(true);
  });
});

describe('TextRunner 与在线 Provider', () => {
  function run(providerId: string, overrides: Partial<TextParameters> = {}): TextRun {
    return { providerId, modelId: 'gpt-6.1-sol', parameters: params(overrides) };
  }

  it('每个 Provider 的并发上限；计数调用、重试与失败；取消排队中的调用不发请求', async () => {
    const pending: Array<() => void> = [];
    let rateLimitOnce = true;
    server = await startFakeProviderServer(
      (request) =>
        new Promise((resolve) => {
          const content = (request.json as { messages: Array<{ content: string }> }).messages.at(-1)!.content;
          if (content === 'limited' && rateLimitOnce) {
            rateLimitOnce = false;
            return resolve({ status: 429, json: { error: { code: 'rate_limit_exceeded' } }, headers: { 'retry-after': '0' } });
          }
          if (content === 'bad') return resolve({ status: 401, json: { error: { message: 'no' } } });
          if (content === 'limited') return resolve(chatCompletionReply(request, 'ok'));
          pending.push(() => resolve(chatCompletionReply(request, 'ok')));
        }),
    );
    let limit = 2;
    const runner = new TextRunner({ concurrency: () => limit, label: () => 'OpenAI' });
    const provider = new OnlineTextProvider({
      providerId: 'openai',
      label: () => 'OpenAI',
      adapter: new OpenAiTextAdapter(),
      config: async () => config(`${server!.origin}/v1`, OPENAI_KEY),
      http,
    });
    const message = (content: string) => ({ messages: [{ role: 'user' as const, content }] });
    const calls = [1, 2, 3].map(() => runner.run(provider, run('openai'), new AbortController().signal));
    const cancelled = new AbortController();
    const queued = runner.run(provider, run('openai'), cancelled.signal);
    await server.waitForRequests(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.requests).toHaveLength(2);
    expect(runner.active('openai')).toBe(2);
    cancelled.abort();
    await expect(queued).rejects.toMatchObject({ name: 'TextCallCancelled' });
    limit = 1;
    pending.shift()!();
    await calls[0];
    // 上限改成 1：第一个完成后、第二个还在进行，第三个继续等。
    await new Promise((r) => setTimeout(r, 50));
    expect(server.requests).toHaveLength(2);
    pending.shift()!();
    await calls[1];
    await server.waitForRequests(3);
    pending.shift()!();
    const results = await Promise.all(calls);
    expect(results.every((r) => r.text === 'ok' && r.finishReason === 'stop')).toBe(true);

    limit = 4;
    await runner.run(provider, run('openai', message('limited')), new AbortController().signal);
    const error = await runner.run(provider, run('openai', message('bad')), new AbortController().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderFailure);
    expect(runner.stats()).toEqual({ openai: { calls: 5, retries: 1, failures: 1 } });
    expect(server.requests).toHaveLength(6);
  });

  it('取消在途的调用：中止请求，连接关闭，不计失败', async () => {
    server = await startFakeProviderServer(() => 'hang');
    const runner = new TextRunner({ concurrency: () => 4 });
    const provider = new OnlineTextProvider({
      providerId: 'openai',
      label: () => 'OpenAI',
      adapter: new OpenAiTextAdapter(),
      config: async () => config(`${server!.origin}/v1`, OPENAI_KEY),
      http,
    });
    const controller = new AbortController();
    const pending = runner.run(provider, run('openai'), controller.signal);
    await server.waitForRequests(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'TextCallCancelled' });
    await server.waitForClosedEarly(1);
    expect(runner.stats().openai).toEqual({ calls: 1, retries: 0, failures: 0 });
    expect(runner.active('openai')).toBe(0);
  });

  it('没有配置时 unavailable，不发请求', async () => {
    const provider = new OnlineTextProvider({
      providerId: 'openai',
      label: () => 'OpenAI',
      adapter: new OpenAiTextAdapter(),
      config: async () => null,
    });
    const error = await failure(provider.generateText(run('openai'), new AbortController().signal, { retry: () => {} }));
    expect(error.kind).toBe('unavailable');
  });
});

describe('OnlineProviderSource 的文本能力与刷新', () => {
  async function withSource(
    baseUrls: Record<string, string>,
    body: (source: OnlineProviderSource, store: ModelServiceStore, dir: string) => Promise<void>,
  ) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-text-src-'));
    try {
      const store = await ModelServiceStore.open(
        { modelServicesFile: path.join(dir, 'model-services.json') },
        new FileCredentialStore(path.join(dir, 'model-credentials.json')),
      );
      const source = new OnlineProviderSource({ store, ffmpeg: async () => ({ command: 'ffmpeg', env: {} }), baseUrls, http });
      await body(source, store, dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it('OpenAI 与 Google 列 generateText；自定义端点只在声明了文本模型时列；textProvider 缓存', async () => {
    await withSource({}, async (source) => {
      await source.configure({ providerId: 'openai', enabled: true, credential: OPENAI_KEY });
      await source.configure({
        providerId: 'custom:studio',
        enabled: true,
        endpoint: 'http://127.0.0.1:9/v1',
        models: [{ modelId: 'qwen3', capability: 'generateText' }],
      });
      const views = Object.fromEntries((await source.list('view')).map((v) => [v.providerId, v]));
      expect(views.openai!.capabilities.generateText).toMatchObject({ available: true });
      expect(views.google!.capabilities.generateText).toMatchObject({ available: false, unavailableReason: 'not-configured' });
      expect(views.elevenlabs!.capabilities.generateText).toBeUndefined();
      expect(Object.keys(views['custom:studio']!.capabilities)).toEqual(['generateText']);
      expect(source.textProvider('elevenlabs')).toBeNull();
      expect(source.textProvider('nope')).toBeNull();
      const openai = source.textProvider('openai');
      expect(openai).not.toBeNull();
      expect(source.textProvider('openai')).toBe(openai);
      expect(source.generator('openai', 'generateText')).toBeNull();
      expect(JSON.stringify(views)).not.toContain(OPENAI_KEY);
    });
  });

  it('刷新成功：记下时间与数目；列表里没有的内置模型报告为不可用；ElevenLabs 的音色补进模型', async () => {
    server = await startFakeProviderServer((request) => {
      const url = new URL(request.path, 'http://fake');
      if (url.pathname === '/v1/models') return { status: 200, json: { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-image-2' }] } };
      if (url.pathname === '/el/models') return { status: 200, json: [{ model_id: 'eleven_v3' }] };
      if (url.pathname === '/el/voices') return { status: 200, json: { voices: [{ voice_id: 'v1', name: 'Rachel' }] } };
      return fakeElevenLabsHandler()(request, server!);
    });
    await withSource({ openai: `${server.origin}/v1`, elevenlabs: `${server.origin}/el` }, async (source, store, dir) => {
      await source.configure({ providerId: 'openai', enabled: true, credential: OPENAI_KEY });
      await source.configure({ providerId: 'elevenlabs', enabled: true, credential: ELEVENLABS_KEY });
      const status = await source.refresh('openai');
      expect(status).toMatchObject({ ok: true, models: 2 });
      expect(Date.parse(status.at)).not.toBeNaN();
      const openai = (await source.describe('openai', 'view'))!;
      expect(openai.config!.refreshed).toEqual(status);
      const text = openai.capabilities.generateText!.models;
      expect(text.find((m) => m.modelId === 'gpt-6.1-sol')!.available).not.toBe(false);
      expect(text.find((m) => m.modelId === 'gpt-6-astra')).toMatchObject({ available: false, unavailableReason: 'unsupported' });
      expect(openai.capabilities.generateImage!.models.find((m) => m.modelId === 'gpt-image-2')!.available).not.toBe(false);

      expect(await source.refresh('elevenlabs')).toMatchObject({ ok: true, models: 1, voices: 1 });
      const eleven = (await source.describe('elevenlabs', 'view'))!.capabilities.synthesizeSpeech!.models;
      expect(eleven.find((m) => m.modelId === 'eleven_v3')!.voices).toEqual([{ voiceId: 'v1', label: 'Rachel' }]);
      expect(eleven.find((m) => m.modelId === 'eleven_multilingual_v2')).toMatchObject({
        available: false,
        unavailableReason: 'unsupported',
      });

      // 记在配置文件里，重开之后还在；文件里没有密钥。
      const file = await fs.readFile(path.join(dir, 'model-services.json'), 'utf8');
      expect(file).not.toContain(OPENAI_KEY);
      expect(file).not.toContain(ELEVENLABS_KEY);
      expect(file).toContain('gpt-6.1-sol');
      expect(server!.requests.find((r) => r.path === '/v1/models')!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    });
  });

  it('刷新失败：照旧用内置列表并标明，错误里没有密钥；没有密钥或不存在时拒绝', async () => {
    server = await startFakeProviderServer(() => ({ status: 401, json: { error: { message: `bad key ${OPENAI_KEY}` } } }));
    await withSource({ openai: `${server.origin}/v1` }, async (source) => {
      await expect(source.refresh('openai')).rejects.toMatchObject({ code: 'invalid-request' });
      await expect(source.refresh('custom:none')).rejects.toMatchObject({ code: 'not-found' });
      await source.configure({ providerId: 'openai', enabled: true, credential: OPENAI_KEY });
      const status = await source.refresh('openai');
      expect(status.ok).toBe(false);
      expect(status.error).toBeTruthy();
      expect(status.error).not.toContain(OPENAI_KEY);
      const view = (await source.describe('openai', 'view'))!;
      expect(view.config!.refreshed).toMatchObject({ ok: false });
      expect(view.capabilities.generateText!.models.every((m) => m.available !== false)).toBe(true);
      expect(JSON.stringify(view)).not.toContain(OPENAI_KEY);
    });
  });

  it('成功之后再失败：丢掉上次取到的列表，回到内置列表', async () => {
    let fail = false;
    server = await startFakeProviderServer(() =>
      fail ? { status: 503, json: {} } : { status: 200, json: { data: [{ id: 'gpt-6.1-sol' }] } },
    );
    await withSource({ openai: `${server.origin}/v1` }, async (source) => {
      await source.configure({ providerId: 'openai', enabled: true, credential: OPENAI_KEY });
      await source.refresh('openai');
      let models = (await source.describe('openai', 'view'))!.capabilities.generateText!.models;
      expect(models.filter((m) => m.available === false)).toHaveLength(2);
      fail = true;
      expect(await source.refresh('openai')).toMatchObject({ ok: false });
      models = (await source.describe('openai', 'view'))!.capabilities.generateText!.models;
      expect(models.every((m) => m.available !== false)).toBe(true);
    });
  });
});

describe('Retry-After', () => {
  it('秒数与 HTTP 日期；认不出时 null', () => {
    const now = Date.parse('2026-10-03T00:00:00Z');
    expect(retryAfterSeconds('5', now)).toBe(5);
    expect(retryAfterSeconds('Sat, 03 Oct 2026 00:00:10 GMT', now)).toBe(10);
    expect(retryAfterSeconds('Fri, 02 Oct 2026 00:00:10 GMT', now)).toBe(0);
    expect(retryAfterSeconds('soon', now)).toBeNull();
    expect(retryAfterSeconds(null, now)).toBeNull();
  });
});
