import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelServiceStore } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import { OnlineProviderSource } from '../online-source.ts';
import { startFakeProviderServer, type FakeHandler, type FakeProviderServer, type FakeReply } from '../testing/fake-provider-server.ts';

/**
 * 没有列模型接口的 OpenAI 兼容端点的连通性测试（架构设计 §6.8，issue #123）。假供应商照火山方舟 Agent Plan 的形状：网关先查
 * 密钥，再按路径路由。只对着本机的假供应商；密钥是这里编的字符串。
 */

const PLAN_KEY = 'ark-test-ONLY-FOR-TESTS-0123456789abcdef';
const BASE_PATH = '/api/plan/v3';
const http = { backoffMs: () => 1, timeoutMs: 5_000 };
const unauthorized: FakeReply = { status: 401, json: { error: { code: 'AuthenticationError', type: 'Unauthorized' } } };
const missingModel: FakeReply = { status: 400, json: { error: { code: 'MissingParameter', message: 'missing `model` parameter', type: 'BadRequest' } } };

/** 查过密钥之后，`GET /models` 是 404，文本接口按 `chat` 回复。 */
function planEndpoint(chat: FakeReply): FakeHandler {
  return (req) => {
    if (req.headers.authorization !== `Bearer ${PLAN_KEY}`) return unauthorized;
    if (req.method === 'POST' && req.path === `${BASE_PATH}/chat/completions`) return chat;
    return { status: 404, json: { error: { code: 'NotFound', message: 'not found' } } };
  };
}

let server: FakeProviderServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function withSource(run: (source: OnlineProviderSource) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-compatible-validate-'));
  const store = await ModelServiceStore.open(
    { modelServicesFile: path.join(dir, 'model-services.json') },
    new FileCredentialStore(path.join(dir, 'model-credentials.json')),
  );
  try {
    await run(new OnlineProviderSource({ store, ffmpeg: async () => ({ command: 'ffmpeg', env: {} }), http }));
  } finally {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const PROVIDER_ID = 'custom:plan';

async function configurePlan(source: OnlineProviderSource): Promise<void> {
  await source.configure({
    providerId: PROVIDER_ID,
    label: 'Plan',
    enabled: true,
    endpoint: `${server!.origin}${BASE_PATH}`,
    models: [{ modelId: 'kimi-k3.1-pro', capability: 'generateText' }],
  });
}

async function accountsOf(source: OnlineProviderSource, providerId = PROVIDER_ID) {
  return (await source.describe(providerId, 'view'))!.config?.accounts ?? [];
}

describe('verifying an OpenAI-compatible endpoint without a model list', () => {
  it('saves the account when /models is 404 and the text route rejects the empty request', async () => {
    server = await startFakeProviderServer(planEndpoint(missingModel));
    await withSource(async (source) => {
      await configurePlan(source);
      await source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true });
      expect((await accountsOf(source)).map((a) => a.status.state)).toEqual(['ok']);
    });
    expect(server.requests.map((req) => [req.method, req.path])).toEqual([
      ['GET', `${BASE_PATH}/models`],
      ['POST', `${BASE_PATH}/chat/completions`],
    ]);
    // 没有模型、没有消息：到不了生成。
    expect(server.requests[1]!.json).toEqual({ messages: [] });
  });

  it('keeps the declared model usable when refreshing the list fails afterwards', async () => {
    server = await startFakeProviderServer(planEndpoint(missingModel));
    await withSource(async (source) => {
      await configurePlan(source);
      await source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true });
      await source.refresh(PROVIDER_ID);
      const view = (await source.describe(PROVIDER_ID, 'view'))!;
      expect(view.capabilities.generateText).toMatchObject({ available: true, models: [{ modelId: 'kimi-k3.1-pro' }] });
    });
  });

  it.each([
    ['422 validation error', { status: 422, json: { detail: 'messages must not be empty' } }],
    ['404 naming the model', { status: 404, json: { error: { code: 'InvalidEndpointOrModel.NotFound', type: 'NotFound' } } }],
  ] satisfies [string, FakeReply][])('accepts a %s from the text route', async (_name, chat) => {
    server = await startFakeProviderServer(planEndpoint(chat));
    await withSource(async (source) => {
      await configurePlan(source);
      await source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true });
      expect(await accountsOf(source)).toHaveLength(1);
    });
  });

  it('accepts a built-in vendor whose account points at such an endpoint', async () => {
    server = await startFakeProviderServer(planEndpoint(missingModel));
    await withSource(async (source) => {
      await source.addAccount({
        providerId: 'volcengine',
        credential: PLAN_KEY,
        endpoint: `${server!.origin}${BASE_PATH}`,
        verify: true,
      });
      expect(await accountsOf(source, 'volcengine')).toHaveLength(1);
    });
  });

  it('still rejects a wrong key without trying the text route', async () => {
    server = await startFakeProviderServer(planEndpoint(missingModel));
    await withSource(async (source) => {
      await configurePlan(source);
      await expect(source.addAccount({ providerId: PROVIDER_ID, credential: 'ark-wrong', verify: true })).rejects.toMatchObject({
        code: 'conflict',
        details: { code: 'PROVIDER_AUTH_FAILED' },
      });
      expect(await accountsOf(source)).toEqual([]);
    });
    expect(server.requests).toHaveLength(1);
  });

  it('reports a key refused only by the text route as an auth failure', async () => {
    server = await startFakeProviderServer(planEndpoint(unauthorized));
    await withSource(async (source) => {
      await configurePlan(source);
      await expect(source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true })).rejects.toMatchObject({
        details: { code: 'PROVIDER_AUTH_FAILED' },
      });
      expect(await accountsOf(source)).toEqual([]);
    });
  });

  // 写错的基址：两个接口都没有。Express 式的 404 会把路径原样带回来，基址里的 "model" 不能被当成「模型不存在」。
  it.each([
    ['a JSON 404', { status: 404, json: { error: { code: 'NotFound', message: 'not found' } } }],
    ['a 405', { status: 405 }],
    ['a 404 page echoing a path with "model"', { status: 404, text: 'Cannot POST /model-proxy/v1/chat/completions' }],
  ] satisfies [string, FakeReply][])('rejects a wrong base URL when the text route answers %s', async (_name, chat) => {
    server = await startFakeProviderServer(planEndpoint(chat));
    await withSource(async (source) => {
      await configurePlan(source);
      const error = await source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true }).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'conflict', details: { code: 'PROVIDER_REJECTED' } });
      // 报的是列模型那次的 404。
      expect((error as Error).message).toContain('404');
      expect(await accountsOf(source)).toEqual([]);
    });
  });

  it('does not probe when /models answers', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { data: [{ id: 'kimi-k3.1-pro' }] } }));
    await withSource(async (source) => {
      await configurePlan(source);
      await source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true });
    });
    expect(server.requests.map((req) => req.path)).toEqual([`${BASE_PATH}/models`]);
  });

  it('does not treat other /models failures as a missing list', async () => {
    server = await startFakeProviderServer(() => ({ status: 400, json: { error: { message: 'bad request' } } }));
    await withSource(async (source) => {
      await configurePlan(source);
      await expect(source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true })).rejects.toMatchObject({
        details: { code: 'PROVIDER_REJECTED' },
      });
    });
    expect(server.requests).toHaveLength(1);
  });

  it('never sends the key anywhere but the configured endpoint, and keeps it out of the error', async () => {
    server = await startFakeProviderServer(planEndpoint({ status: 404, text: `no route for ${PLAN_KEY}` }));
    await withSource(async (source) => {
      await configurePlan(source);
      const error = await source.addAccount({ providerId: PROVIDER_ID, credential: PLAN_KEY, verify: true }).catch((e: unknown) => e);
      expect(String((error as Error).message)).not.toContain(PLAN_KEY);
    });
    expect(server.requests.every((req) => req.path.startsWith(BASE_PATH))).toBe(true);
  });
});
