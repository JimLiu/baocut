import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError, setLocale } from '@baocut/protocol';
import { BaoCutClient } from './client.ts';

/** 界面语言是英文时，客户端自己写的连接错误是英文，并带消息引用。 */
describe('client 的英文文案', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('关闭之后的请求：英文错误带引用', async () => {
    const client = new BaoCutClient({
      resolve: async () => ({ endpoint: 'ws://127.0.0.1:1', token: 't' }),
      client: { kind: 'cli', name: 'test', version: '0' },
      reconnect: false,
    });
    client.close();
    const error = await client.request('runtime.info' as never, {} as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toBe('The client is closed');
    expect((error as RpcError).messageRef?.key).toBe('clientConnection.closed');
  });
});
