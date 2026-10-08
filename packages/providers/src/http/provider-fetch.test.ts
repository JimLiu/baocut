import { afterEach, describe, expect, it } from 'vitest';
import { ProviderFailure } from '@baocut/models';
import { startFakeProviderServer, type FakeProviderServer } from '../testing/fake-provider-server.ts';
import { ProviderAborted, providerFetch, redact, type ProviderRequest } from './provider-fetch.ts';

const KEY = 'sk-test-ONLY-FOR-TESTS-abcdef0123456789';
const options = { label: '测试供应商', secrets: [KEY], backoffMs: () => 5 };

describe('providerFetch', () => {
  const servers: FakeProviderServer[] = [];
  const server = async (handler: Parameters<typeof startFakeProviderServer>[0]) => {
    const started = await startFakeProviderServer(handler);
    servers.push(started);
    return started;
  };
  const request = (url: string, extra: Partial<ProviderRequest> = {}): ProviderRequest => ({
    method: 'GET',
    url,
    auth: { header: 'Authorization', value: `Bearer ${KEY}` },
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    ...extra,
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it('跨源重定向不带密钥：A 重定向到 B，B 收到的请求头里没有 Authorization', async () => {
    const b = await server(() => ({ status: 200, json: { ok: true } }));
    const a = await server(() => ({ status: 302, headers: { location: `${b.origin}/file` } }));
    const response = await providerFetch(options, request(`${a.origin}/models`));
    expect(response.json()).toEqual({ ok: true });
    expect(a.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(b.requests).toHaveLength(1);
    expect(b.requests[0]!.headers.authorization).toBeUndefined();
    expect(JSON.stringify(b.requests[0]!.headers)).not.toContain(KEY);
  });

  it('同源重定向照常带密钥；Google 的密钥头也一样只给原始的源', async () => {
    let hops = 0;
    const a = await server((r) => (hops++ === 0 ? { status: 307, headers: { location: '/v2' + r.path } } : { status: 200, json: {} }));
    await providerFetch(options, request(`${a.origin}/x`));
    expect(a.requests.map((r) => r.headers.authorization)).toEqual([`Bearer ${KEY}`, `Bearer ${KEY}`]);

    const b = await server(() => ({ status: 200, json: {} }));
    const g = await server(() => ({ status: 301, headers: { location: `${b.origin}/models` } }));
    await providerFetch(options, request(`${g.origin}/models`, { auth: { header: 'x-goog-api-key', value: KEY } }));
    expect(g.requests[0]!.headers['x-goog-api-key']).toBe(KEY);
    expect(b.requests[0]!.headers['x-goog-api-key']).toBeUndefined();
  });

  it('跨源重定向的 POST 不跟随：PROVIDER_REJECTED，素材不会送到别处', async () => {
    const b = await server(() => ({ status: 200, json: {} }));
    const a = await server(() => ({ status: 307, headers: { location: `${b.origin}/upload` } }));
    const error = await providerFetch(options, request(`${a.origin}/audio`, { method: 'POST', body: () => 'audio' })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ kind: 'rejected', details: { code: 'PROVIDER_REJECTED' } });
    expect(b.requests).toHaveLength(0);
  });

  it('4xx 不重试：401 认证失败、429 配额，供应商回显的密钥被去掉', async () => {
    const a = await server(() => ({ status: 401, json: { error: { message: `Incorrect API key provided: ${KEY}` } } }));
    const error = (await providerFetch(options, request(`${a.origin}/x`)).catch((e: unknown) => e)) as ProviderFailure;
    expect(error).toMatchObject({ kind: 'rejected', details: { code: 'PROVIDER_AUTH_FAILED', status: 401 } });
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('[REDACTED]');
    expect(JSON.stringify(error.details)).not.toContain(KEY);
    expect(a.requests).toHaveLength(1);

    a.handler = () => ({ status: 429, json: { error: { message: 'quota' } } });
    await expect(providerFetch(options, request(`${a.origin}/x`))).rejects.toMatchObject({ details: { code: 'PROVIDER_QUOTA_EXCEEDED' } });
    a.handler = () => ({ status: 400, text: 'API_KEY_INVALID' });
    await expect(
      providerFetch(
        options,
        request(`${a.origin}/x`, {
          classify: (status, body) => (status === 400 && body.includes('API_KEY_INVALID') ? 'PROVIDER_AUTH_FAILED' : null),
        }),
      ),
    ).rejects.toMatchObject({ details: { code: 'PROVIDER_AUTH_FAILED' } });
    a.handler = () => ({ status: 422, json: { error: 'bad audio' } });
    await expect(providerFetch(options, request(`${a.origin}/x`))).rejects.toMatchObject({
      message: expect.stringContaining('bad audio'),
      details: { code: 'PROVIDER_REJECTED' },
    });
  });

  it('5xx 与连不上：退避重试，一共 3 次；中途恢复就成功', async () => {
    let calls = 0;
    const a = await server(() => (++calls < 3 ? { status: 502, text: 'bad gateway' } : { status: 200, json: { ok: 1 } }));
    expect((await providerFetch(options, request(`${a.origin}/x`))).json()).toEqual({ ok: 1 });
    expect(a.requests).toHaveLength(3);

    a.handler = () => ({ status: 500, text: `boom ${KEY}` });
    const error = (await providerFetch(options, request(`${a.origin}/x`)).catch((e: unknown) => e)) as ProviderFailure;
    expect(error).toMatchObject({ kind: 'unavailable-remote', details: { code: 'PROVIDER_UNAVAILABLE', attempts: 3, status: 500 } });
    expect(error.message).not.toContain(KEY);

    const closed = await server(() => ({ status: 200, json: {} }));
    const origin = closed.origin;
    await closed.close();
    servers.splice(servers.indexOf(closed), 1);
    await expect(providerFetch(options, request(`${origin}/x`))).rejects.toMatchObject({
      kind: 'unavailable-remote',
      details: { code: 'PROVIDER_UNAVAILABLE', attempts: 3 },
    });
  });

  it('超时算一次失败；取消立即中止在途请求，服务端看到连接关闭', async () => {
    const a = await server(() => 'hang');
    await expect(providerFetch({ ...options, attempts: 1 }, request(`${a.origin}/x`, { timeoutMs: 100 }))).rejects.toMatchObject({
      kind: 'unavailable-remote',
    });
    const controller = new AbortController();
    const pending = providerFetch(options, request(`${a.origin}/x`, { signal: controller.signal }));
    await a.waitForRequests(2);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderAborted);
    await a.waitForClosedEarly(2);
  });
});

describe('redact', () => {
  it('去掉给定的密钥与常见的密钥形状，截短到 300 字符', () => {
    expect(redact(`key=${KEY}`, [KEY])).toBe('key=[REDACTED]');
    expect(redact('Bearer sk-proj-abcdefgh12345', [])).toBe('Bearer [REDACTED]');
    expect(redact('AIzaSyA-0123456789abcdefghijklmnop', [])).toBe('[REDACTED]');
    expect(redact('task-abcdefghijk', [])).toBe('task-abcdefghijk');
    expect(redact('x'.repeat(400), [])).toHaveLength(301);
  });
});
