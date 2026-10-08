import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NODE_ERROR, NODE_ERROR_STATUS, NODE_PROTOCOL_HEADER, type NodeErrorCode } from '@baocut/protocol';
import {
  NodeClient,
  NodeConnectionError,
  NodeRequestAborted,
  NodeResponseError,
  readEventStream,
  rejectReason,
  versionCompatible,
} from './node-http.ts';

/** 节点 HTTP 客户端：对着一个按路径回固定响应的回环服务器。 */

const TOKEN = 'c_http_test.super-secret-value';

describe('NodeClient', () => {
  let server: http.Server;
  let client: NodeClient;
  let dir: string;
  const seen: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }> = [];

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-node-http-'));
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      const json = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      const url = req.url!;
      if (url === '/v1/health') return json(200, { nodeId: 'node_x', nodeProtocolVersion: 1, minNodeProtocolVersion: 1 });
      if (url === '/v1/jobs/unauthorized') return json(401, { error: { code: 'UNAUTHORIZED', message: '令牌无效或已吊销' } });
      if (url === '/v1/jobs/model')
        return json(409, { error: { code: 'MODEL_NOT_READY', message: '模型包不可用', details: { state: 'not-installed' } } });
      if (url === '/v1/jobs/garbage') return res.writeHead(200).end('not json');
      if (url === '/v1/jobs/plain-500') return res.writeHead(500).end('boom');
      if (url === '/v1/jobs/plain-401') return res.writeHead(401).end();
      if (url === '/v1/jobs/slow') return setTimeout(() => json(200, {}), 2_000);
      if (url === '/v1/jobs/j1/input') return res.writeHead(204).end();
      if (url === '/v1/jobs/j1/result') return res.writeHead(200).end(Buffer.from('result bytes'));
      if (url.startsWith('/v1/jobs/j1/events')) {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write('{"type":"heartbeat"}\n{"seq":1,"type":"language","tag":"en","confidence":null}\n');
        if (url.includes('since=7')) res.write('not json\n');
        // 之后不再写：空闲期限到了由客户端断开。
        return;
      }
      json(404, { error: { code: 'JOB_NOT_FOUND', message: '任务不存在' } });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new NodeClient('127.0.0.1', (server.address() as net.AddressInfo).port);
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 抛出的错误（含说明与详情）里没有令牌。 */
  async function rejection(promise: Promise<unknown>): Promise<Error> {
    const error = await promise.then(
      () => {
        throw new Error('应当失败');
      },
      (e: unknown) => e as Error,
    );
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('super-secret-value');
    return error;
  }

  it('请求带协议版本头；令牌只在 Authorization 头里', async () => {
    seen.length = 0;
    await client.health({ timeoutMs: 1_000 });
    expect(seen[0]!.headers[NODE_PROTOCOL_HEADER.toLowerCase()]).toBe('1');
    expect(seen[0]!.headers.authorization).toBeUndefined();
    await rejection(client.getJob(TOKEN, 'missing', { timeoutMs: 1_000 }));
    expect(seen[1]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[1]!.url).not.toContain('secret');
  });

  it('节点的错误：NodeResponseError 带状态、错误码与详情；响应体不合规时按状态码', async () => {
    const unauthorized = await rejection(client.getJob(TOKEN, 'unauthorized', { timeoutMs: 1_000 }));
    expect(unauthorized).toBeInstanceOf(NodeResponseError);
    expect(unauthorized).toMatchObject({ status: 401, code: 'UNAUTHORIZED', message: '令牌无效或已吊销' });
    expect(rejectReason(unauthorized as NodeResponseError)).toBe('unpaired');

    const model = (await rejection(client.getJob(TOKEN, 'model', { timeoutMs: 1_000 }))) as NodeResponseError;
    expect(model).toMatchObject({ status: 409, code: 'MODEL_NOT_READY', details: { state: 'not-installed' } });
    expect(rejectReason(model)).toBe('model-not-ready');

    const plain = (await rejection(client.getJob(TOKEN, 'plain-500', { timeoutMs: 1_000 }))) as NodeResponseError;
    expect(plain).toMatchObject({ status: 500, code: 'HTTP_500' });
    expect(rejectReason(plain)).toBeNull();
    const plain401 = (await rejection(client.getJob(TOKEN, 'plain-401', { timeoutMs: 1_000 }))) as NodeResponseError;
    expect(rejectReason(plain401)).toBe('unpaired');

    const notFound = (await rejection(client.getJob(TOKEN, 'nope', { timeoutMs: 1_000 }))) as NodeResponseError;
    expect(notFound).toMatchObject({ status: 404, code: 'JOB_NOT_FOUND' });
    expect(rejectReason(notFound)).toBeNull();
  });

  it('错误码 → 拒绝原因（规范 §9、§10）', () => {
    const expected: Partial<Record<NodeErrorCode, string>> = {
      UNAUTHORIZED: 'unpaired',
      PROTOCOL_VERSION_UNSUPPORTED: 'version',
      CAPABILITY_DISABLED: 'capability-disabled',
      MODEL_NOT_READY: 'model-not-ready',
      QUEUE_FULL: 'queue-full',
      DISK_LOW: 'disk-low',
      SOURCE_NOT_ALLOWED: 'source-not-allowed',
      INPUT_TOO_LARGE: 'input-too-large',
      PAIRING_CODE_INVALID: 'pairing-code-invalid',
      PAIRING_LOCKED: 'pairing-locked',
    };
    for (const code of Object.values(NODE_ERROR)) {
      const error = new NodeResponseError(NODE_ERROR_STATUS[code], code, 'x');
      expect([code, rejectReason(error)]).toEqual([code, expected[code] ?? null]);
    }
  });

  it('连接问题：NodeConnectionError（连不上、超时、响应不是 JSON）；中止是 NodeRequestAborted', async () => {
    const garbage = await rejection(client.getJob(TOKEN, 'garbage', { timeoutMs: 1_000 }));
    expect(garbage).toMatchObject({ name: 'NodeConnectionError', code: 'BAD_RESPONSE' });

    const slow = await rejection(client.getJob(TOKEN, 'slow', { timeoutMs: 100 }));
    expect(slow).toMatchObject({ name: 'NodeConnectionError', code: 'TIMEOUT' });

    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const refused = await rejection(new NodeClient('127.0.0.1', port).getJob(TOKEN, 'x', { timeoutMs: 1_000 }));
    expect(refused).toBeInstanceOf(NodeConnectionError);
    expect(refused).toMatchObject({ code: 'ECONNREFUSED' });

    const controller = new AbortController();
    const aborted = client.getJob(TOKEN, 'slow', { timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await rejection(aborted)).toBeInstanceOf(NodeRequestAborted);
  });

  it('上传：流式、带 Content-Length、不用 Transfer-Encoding；下载：边写边算 sha256', async () => {
    const file = path.join(dir, 'media.bin');
    const media = crypto.randomBytes(256 * 1024);
    await fs.writeFile(file, media);
    seen.length = 0;
    await client.upload(TOKEN, 'j1', file, media.length, { idleMs: 1_000 });
    expect(seen[0]!.headers['content-length']).toBe(String(media.length));
    expect(seen[0]!.headers['transfer-encoding']).toBeUndefined();
    expect(seen[0]!.body.equals(media)).toBe(true);

    const dest = path.join(dir, 'result.json');
    const fetched = await client.download(TOKEN, 'j1', dest, { idleMs: 1_000 });
    expect(fetched).toEqual({ sha256: crypto.createHash('sha256').update('result bytes').digest('hex'), byteLength: 12 });
    expect(await fs.readFile(dest, 'utf8')).toBe('result bytes');
  });

  it('事件流：逐行读出；空闲期限到了抛 TIMEOUT；不合规的行抛 BAD_RESPONSE', async () => {
    const response = await client.events(TOKEN, 'j1', 0, { timeoutMs: 1_000 });
    const events: unknown[] = [];
    const error = await (async () => {
      try {
        for await (const event of readEventStream(response, 150)) events.push(event);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(events).toEqual([{ type: 'heartbeat' }, { seq: 1, type: 'language', tag: 'en', confidence: null }]);
    expect(error).toMatchObject({ name: 'NodeConnectionError', code: 'TIMEOUT' });

    const bad = await client.events(TOKEN, 'j1', 7, { timeoutMs: 1_000 });
    await expect(
      (async () => {
        for await (const _event of readEventStream(bad, 1_000)) void _event;
      })(),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('版本兼容：本机版本不低于节点的最低版本', () => {
    expect(versionCompatible({ nodeProtocolVersion: 1, minNodeProtocolVersion: 1 })).toBe(true);
    expect(versionCompatible({ nodeProtocolVersion: 3, minNodeProtocolVersion: 1 })).toBe(true);
    expect(versionCompatible({ nodeProtocolVersion: 3, minNodeProtocolVersion: 2 })).toBe(false);
    expect(versionCompatible({ nodeProtocolVersion: 0, minNodeProtocolVersion: 0 })).toBe(false);
  });
});
