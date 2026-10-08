import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { ProviderFailure } from '@baocut/models';
import { startFakeProviderServer, type FakeProviderServer } from './testing/fake-provider-server.ts';
import { providerFetch } from './http/provider-fetch.ts';
import { COMPAT_VENDORS } from './vendor-catalog.ts';

/** 界面语言是英文时，在线服务的错误分类说明与供应商名字是英文；供应商的原话原样作为参数。 */
describe('providers 的英文文案', () => {
  const servers: FakeProviderServer[] = [];

  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it('供应商名字在读取时按当前语言', () => {
    expect(COMPAT_VENDORS.moonshot.label).toBe('Kimi (Moonshot)');
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(COMPAT_VENDORS.moonshot.label).toBe('Kimi（Moonshot）');
  });

  it('请求被拒：分类说明是英文，供应商的原话原样附上', async () => {
    const server = await startFakeProviderServer(() => ({ status: 400, json: { error: { message: '参数不对' } } }));
    servers.push(server);
    const error = await providerFetch(
      { label: 'Test vendor', secrets: [], backoffMs: () => 5 },
      { method: 'GET', url: `${server.origin}/x`, auth: null, timeoutMs: 5_000, signal: new AbortController().signal },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderFailure);
    const message = (error as ProviderFailure).message;
    expect(message).toContain('Test vendor rejected the request (HTTP 400)');
    expect(message).toContain('参数不对');
  });
});
