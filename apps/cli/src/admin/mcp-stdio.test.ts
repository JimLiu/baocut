import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { serveMcpStdio, type McpTarget } from './mcp-stdio.ts';

/** 假的 MCP 端点：按请求体里的 method 决定怎么回答，记下收到的请求。 */
interface Endpoint {
  url: string;
  received: { auth: string | undefined; accept: string | undefined; body: Record<string, unknown> }[];
  close(): Promise<void>;
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function endpoint(respond: (body: Record<string, unknown>, res: http.ServerResponse) => void): Promise<Endpoint> {
  const received: Endpoint['received'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      received.push({ auth: req.headers.authorization, accept: req.headers.accept, body });
      respond(body, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    received,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function json(res: http.ServerResponse, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(text);
}

/** 起一个桥：stdin 写进去的每一行是一条消息，stdout 每行解析回来。 */
function bridge(connect: () => Promise<McpTarget>, env: NodeJS.ProcessEnv = { BAOCUT_MCP_TOKEN: 'mcl_a.c2VjcmV0' }) {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors = new PassThrough();
  const lines: unknown[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  let stderr = '';
  errors.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const done = serveMcpStdio({ home: '/unused', env, input, output, errors, connect });
  return {
    send: (message: unknown) => input.write(`${JSON.stringify(message)}\n`),
    sendRaw: (text: string) => input.write(`${text}\n`),
    end: () => input.end(),
    lines,
    stderr: () => stderr,
    done,
  };
}

function target(url: string, log: string[] = []): McpTarget {
  let lost: (() => void) | null = null;
  return {
    url,
    onLost: (listener) => (lost = listener),
    close: () => {
      log.push(`close ${url}`);
      lost = null;
    },
  };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

describe('baocut mcp serve --stdio', () => {
  it('转发请求：带令牌与 Accept，JSON 回答写成一行；通知（202）没有输出；stdin 关了答完再走', async () => {
    const server = await endpoint((body, res) => {
      if (body.id === undefined) return res.writeHead(202).end();
      json(res, { jsonrpc: '2.0', id: body.id, result: { echo: body.method } });
    });
    const log: string[] = [];
    const io = bridge(async () => target(server.url, log));
    io.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    io.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    io.send({ jsonrpc: '2.0', id: 'b', method: 'tools/list' });
    io.end();
    expect(await io.done).toBe(0);
    expect(io.lines).toHaveLength(2);
    expect(io.lines).toEqual(
      expect.arrayContaining([
        { jsonrpc: '2.0', id: 1, result: { echo: 'initialize' } },
        { jsonrpc: '2.0', id: 'b', result: { echo: 'tools/list' } },
      ]),
    );
    expect(server.received.map((request) => request.auth)).toEqual(Array(3).fill('Bearer mcl_a.c2VjcmV0'));
    expect(server.received[0]!.accept).toBe('application/json, text/event-stream');
    expect(log).toEqual([`close ${server.url}`]);
  });

  it('SSE 回答：进度通知与结果各写一行，保活注释不写', async () => {
    const server = await endpoint((body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': keep-alive\n\n');
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 7, progress: 1 } })}\n\n`);
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { done: true } })}\n\n`);
    });
    const io = bridge(async () => target(server.url));
    io.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x', _meta: { progressToken: 7 } } });
    io.end();
    await io.done;
    expect(io.lines).toEqual([
      { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 7, progress: 1 } },
      { jsonrpc: '2.0', id: 3, result: { done: true } },
    ]);
  });

  it('令牌被拒（401）与读不懂的行：以 JSON-RPC 错误回答，写进 stderr', async () => {
    const server = await endpoint((_body, res) => res.writeHead(401).end());
    const io = bridge(async () => target(server.url));
    io.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    io.sendRaw('{not json');
    io.end();
    await io.done;
    expect(io.lines).toEqual(
      expect.arrayContaining([
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        { jsonrpc: '2.0', id: 1, error: { code: -32000, message: expect.stringContaining('baocut mcp install') } },
      ]),
    );
    expect(io.stderr()).toContain('baocut mcp install');
  });

  it('端点连不上（请求没送到）：重新找或拉起 Runtime，再送一次', async () => {
    const dead = await endpoint(() => undefined);
    await dead.close();
    const live = await endpoint((body, res) => json(res, { jsonrpc: '2.0', id: body.id, result: {} }));
    const urls = [dead.url, live.url];
    let connects = 0;
    const log: string[] = [];
    const io = bridge(async () => target(urls[connects++]!, log));
    io.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    io.end();
    await io.done;
    expect(connects).toBe(2);
    expect(io.lines).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
    expect(live.received).toHaveLength(1);
    expect(log).toEqual([`close ${dead.url}`, `close ${live.url}`]);
  });

  it('送到之后连接断了：这次以错误返回、不重放；下一个请求重新连', async () => {
    let calls = 0;
    const server = await endpoint((body, res) => {
      calls += 1;
      if (calls === 1) {
        res.socket?.destroy();
        return;
      }
      json(res, { jsonrpc: '2.0', id: body.id, result: {} });
    });
    let connects = 0;
    const io = bridge(async () => {
      connects += 1;
      return target(server.url);
    });
    io.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } });
    await until(() => io.lines.length === 1);
    expect(io.lines[0]).toMatchObject({ id: 1, error: { code: -32000 } });
    io.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    io.end();
    await io.done;
    expect(server.received.map((request) => request.body.id)).toEqual([1, 2]);
    expect(io.lines[1]).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
    expect(connects).toBe(2);
  });

  it('找不到或拉不起 Runtime：每个请求以原因回答，进程不退出；下一个请求再试', async () => {
    const server = await endpoint((body, res) => json(res, { jsonrpc: '2.0', id: body.id, result: {} }));
    let failing = true;
    const io = bridge(async () => {
      if (failing) throw new Error('Runtime would not start');
      return target(server.url);
    });
    io.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await until(() => io.lines.length === 1);
    expect(io.lines[0]).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Runtime would not start' } });
    failing = false;
    io.send({ jsonrpc: '2.0', id: 2, method: 'initialize' });
    io.end();
    await io.done;
    expect(io.lines[1]).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
  });

  it('没有 BAOCUT_MCP_TOKEN：说明怎么装，退出码 2，不去连 Runtime', async () => {
    let connects = 0;
    const io = bridge(async () => {
      connects += 1;
      return target('http://127.0.0.1:1/mcp');
    }, {});
    expect(await io.done).toBe(2);
    expect(io.stderr()).toContain('BAOCUT_MCP_TOKEN');
    expect(connects).toBe(0);
  });
});
