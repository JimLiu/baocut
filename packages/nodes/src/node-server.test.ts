import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NodeErrorBody, NodeHealth, NodePairResponse } from '@baocut/protocol';
import type { NodeJobs } from './node-jobs.ts';
import { createNodeRequestHandler, parseRange } from './node-server.ts';

/**
 * 三道门的顺序（规范 §2）：来源 → 版本 → 令牌。健康检查不过版本门与令牌门，配对不过令牌门。
 * 服务只听 127.0.0.1；来源地址在进处理函数之前改掉，模拟别的网段的对端。
 */

const GOOD_TOKEN = 'client-a.good';

describe('请求处理的三道门', () => {
  let server: http.Server;
  let baseUrl: string;
  let remoteAddress: string;
  let allowAnySource: boolean;
  let calls: string[];

  beforeEach(async () => {
    remoteAddress = '192.168.1.20';
    allowAnySource = false;
    calls = [];
    const jobs = {
      get: (clientId: string, jobId: string) => {
        calls.push(`get ${clientId} ${jobId}`);
        return { jobId };
      },
    } as unknown as NodeJobs;
    const handler = createNodeRequestHandler({
      jobs,
      health: async () => {
        calls.push('health');
        return { schema: 'baocut.node-health/v1' } as NodeHealth;
      },
      pair: async (code, clientId) => {
        calls.push(`pair ${code} ${clientId}`);
        return { nodeId: 'node_1', name: 'n', token: `${clientId}.x` } satisfies NodePairResponse;
      },
      authenticate: (token) => (token === GOOD_TOKEN ? 'client-a' : null),
      allowAnySource: () => allowAnySource,
    });
    server = http.createServer((request, response) => {
      Object.defineProperty(request.socket, 'remoteAddress', { value: remoteAddress, configurable: true });
      handler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const send = async (pathname: string, headers: Record<string, string> = {}, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? (JSON.parse(text) as NodeErrorBody & Record<string, unknown>) : null,
    };
  };
  const V = { 'X-BaoCut-Node-Protocol': '1' };
  const AUTH = { authorization: `Bearer ${GOOD_TOKEN}` };
  const pairInit: RequestInit = { method: 'POST', body: JSON.stringify({ code: '123456', clientId: 'client-a', clientName: 'A' }) };

  it('来源门最先：不允许的来源连健康检查都拒绝，也不看版本与令牌', async () => {
    remoteAddress = '8.8.8.8';
    for (const [pathname, headers, init] of [
      ['/v1/health', {}, {}],
      ['/v1/pair', {}, pairInit],
      ['/v1/jobs/job_1', {}, {}],
      ['/v1/jobs/job_1', { ...V, ...AUTH }, {}],
      ['/nope', {}, {}],
    ] as const) {
      const response = await send(pathname, headers, init);
      expect(response.status, pathname).toBe(403);
      expect(response.body?.error.code).toBe('SOURCE_NOT_ALLOWED');
    }
    expect(calls).toEqual([]);
  });

  it('IPv4 映射的 IPv6 来源按 IPv4 判断', async () => {
    remoteAddress = '::ffff:10.0.0.5';
    expect((await send('/v1/health')).status).toBe(200);
    remoteAddress = '::ffff:8.8.8.8';
    expect((await send('/v1/health')).status).toBe(403);
  });

  it('allowAnySource 打开后放行任何来源，其余两道门照旧', async () => {
    remoteAddress = '8.8.8.8';
    allowAnySource = true;
    expect((await send('/v1/health')).status).toBe(200);
    expect((await send('/v1/jobs/job_1', V)).status).toBe(401);
    expect((await send('/v1/jobs/job_1', { ...V, ...AUTH })).status).toBe(200);
  });

  it('版本门其次：缺失、过低或不是数字 426，并给出要求的版本；健康检查不过这道门', async () => {
    for (const headers of [
      {} as Record<string, string>,
      { 'X-BaoCut-Node-Protocol': '0' },
      { 'X-BaoCut-Node-Protocol': 'v1' },
      { 'X-BaoCut-Node-Protocol': '1.5' },
    ]) {
      // 没有令牌也先报版本。
      const response = await send('/v1/jobs/job_1', headers);
      expect(response.status).toBe(426);
      expect(response.body?.error).toMatchObject({ code: 'PROTOCOL_VERSION_UNSUPPORTED', details: { required: 1 } });
    }
    expect((await send('/v1/pair', {}, pairInit)).status).toBe(426);
    expect((await send('/v1/health')).status).toBe(200);
    // 更高的版本不拒绝（向前兼容由节点的最低版本决定）。
    expect((await send('/v1/jobs/job_1', { 'X-BaoCut-Node-Protocol': '2', ...AUTH })).status).toBe(200);
    expect(calls).toEqual(['health', 'get client-a job_1']);
  });

  it('令牌门最后：缺失或无效 401；配对不过这道门', async () => {
    for (const headers of [
      V,
      { ...V, authorization: 'Bearer nope' },
      { ...V, authorization: GOOD_TOKEN },
      { ...V, authorization: 'Basic abc' },
    ]) {
      const response = await send('/v1/jobs/job_1', headers);
      expect(response.status).toBe(401);
      expect(response.body?.error.code).toBe('UNAUTHORIZED');
    }
    const paired = await send('/v1/pair', V, pairInit);
    expect(paired.status).toBe(200);
    expect(calls).toEqual(['pair 123456 client-a']);
  });

  it('通过三道门之后：没有的端点 404，不支持的方法 405（都是 INVALID_REQUEST）', async () => {
    const headers = { ...V, ...AUTH };
    const unknown = await send('/v1/nope', headers);
    expect(unknown.status).toBe(404);
    expect(unknown.body?.error.code).toBe('INVALID_REQUEST');
    const wrongMethod = await send('/v1/jobs/job_1/result', headers, { method: 'POST' });
    expect(wrongMethod.status).toBe(405);
    // 只有 GET /v1/health 免版本与令牌；别的方法照常过三道门。
    expect((await send('/v1/health', {}, { method: 'POST' })).status).toBe(426);
    expect((await send('/v1/health', headers, { method: 'POST' })).status).toBe(405);
    // 未认证时同样的请求先被令牌门拦下。
    expect((await send('/v1/nope', V)).status).toBe(401);
  });

  it('配对请求不合规：400', async () => {
    for (const body of ['{', JSON.stringify({ code: '123456', clientId: 'a.b', clientName: 'A' }), JSON.stringify({ code: '123456' })]) {
      const response = await send('/v1/pair', V, { method: 'POST', body });
      expect(response.status).toBe(400);
      expect(response.body?.error.code).toBe('INVALID_REQUEST');
    }
    expect(calls).toEqual([]);
  });
});

describe('Range 解析', () => {
  it.each([
    [undefined, 100, null],
    ['', 100, null],
    ['bytes=0-9', 100, { start: 0, end: 9 }],
    ['bytes=10-', 100, { start: 10, end: 99 }],
    ['bytes=90-200', 100, { start: 90, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=-200', 100, { start: 0, end: 99 }],
    ['bytes=99-99', 100, { start: 99, end: 99 }],
    ['bytes=100-', 100, 'unsatisfiable'],
    ['bytes=5-4', 100, 'unsatisfiable'],
    ['bytes=-0', 100, 'unsatisfiable'],
    ['bytes=0-', 0, 'unsatisfiable'],
    ['bytes=-', 100, null],
    ['bytes=0-1,5-6', 100, null],
    ['items=0-1', 100, null],
  ] as const)('%s（共 %d 字节）', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});
