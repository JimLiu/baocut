import { createServer, request as httpRequest, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { McpEndpoint } from './mcp-endpoint.ts';
import { ToolCatalog, type ToolResult } from './tool-catalog.ts';

// Both the agent bridge and external MCP service use this endpoint.
describe('local MCP submissions', () => {
  for (const chunked of [false, true]) {
    it(`accepts bodies above the former 1 MiB and proposed 8 MiB limits (${chunked ? 'chunked' : 'content-length'})`, async () => {
      const endpoint = new McpEndpoint({ tools: new ToolCatalog([], silentLogger), authenticate: () => ({ kind: 'local', connectionId: 'test', client: 'cli', cwd: '/tmp', projectDir: null, name: 'test' }), log: silentLogger });
      const server = createServer((request, response) => endpoint.handle(request, response));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      try {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { document: '词'.repeat(3 * 1024 * 1024) } });
        const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const request = httpRequest({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', ...(chunked ? {} : { 'Content-Length': Buffer.byteLength(body) }) } }, (response) => {
            let text = '';
            response.on('data', (part) => text += part);
            response.on('end', () => resolve({ status: response.statusCode!, body: text }));
          });
          request.on('error', reject);
          if (chunked) { request.write(body.slice(0, 500000)); request.end(body.slice(500000)); }
          else request.end(body);
        });
        expect(result.status).toBe(200);
        expect(JSON.parse(result.body)).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
  }
});

// A tools/call that waits for the user (approval or conversations_ask) must not look idle to the client: Claude Code
// before 2.1.274 drops a silent Streamable HTTP request after about 4–5 minutes with "The operation timed out.".
describe('long tool calls', () => {
  const KEEP_ALIVE_MS = 20;
  const principal = { kind: 'local' as const, connectionId: 'test', client: 'cli' as const, cwd: '/tmp', projectDir: null, name: 'test' };
  const answer: ToolResult = { content: [{ type: 'text', text: '{"answers":{"q1":["A"]}}' }] };

  async function serve(waitMs: number): Promise<{ server: Server; port: number; calls: { closed: boolean }[] }> {
    const calls: { closed: boolean }[] = [];
    const tools = {
      list: () => [],
      call: async () => {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return answer;
      },
    } as unknown as ToolCatalog;
    const endpoint = new McpEndpoint({ tools, authenticate: () => principal, log: silentLogger, keepAliveMs: KEEP_ALIVE_MS });
    const server = createServer((request, response) => {
      const call = { closed: false };
      calls.push(call);
      response.once('close', () => (call.closed = true));
      endpoint.handle(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, port: (server.address() as { port: number }).port, calls };
  }

  function close(server: Server): Promise<void> {
    server.closeAllConnections();
    return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  function call(port: number, accept: string, meta?: Record<string, unknown>): Promise<{ type: string; body: string }> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'conversations_ask', arguments: {}, ...(meta ? { _meta: meta } : {}) } });
    return new Promise((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept } }, (response) => {
        let text = '';
        response.on('data', (part) => (text += part));
        response.on('end', () => resolve({ type: String(response.headers['content-type']), body: text }));
      });
      request.on('error', reject);
      request.end(body);
    });
  }

  /** SSE 正文 → 每个事件的 data（JSON），注释行单独计数。 */
  function events(body: string): { data: unknown[]; comments: number } {
    const blocks = body.split('\n\n').filter(Boolean);
    return {
      data: blocks.filter((b) => b.startsWith('event: message\n')).map((b) => JSON.parse(b.slice(b.indexOf('data: ') + 6))),
      comments: blocks.filter((b) => b.startsWith(':')).length,
    };
  }

  it('answers a quick call with JSON even when the client accepts SSE', async () => {
    const { server, port } = await serve(0);
    try {
      const result = await call(port, 'application/json, text/event-stream', { progressToken: 3 });
      expect(result.type).toBe('application/json');
      expect(JSON.parse(result.body)).toEqual({ jsonrpc: '2.0', id: 7, result: answer });
    } finally {
      await close(server);
    }
  });

  it('streams progress notifications while waiting and ends with the result', async () => {
    const { server, port } = await serve(KEEP_ALIVE_MS * 5);
    try {
      const result = await call(port, 'application/json, text/event-stream', { progressToken: 'p1' });
      expect(result.type).toBe('text/event-stream');
      const { data, comments } = events(result.body);
      expect(comments).toBe(0);
      const progress = data.slice(0, -1) as { method: string; params: { progressToken: string; progress: number } }[];
      expect(progress.length).toBeGreaterThanOrEqual(2);
      expect(progress.every((n) => n.method === 'notifications/progress' && n.params.progressToken === 'p1')).toBe(true);
      expect(progress.map((n) => n.params.progress)).toEqual(progress.map((_, i) => i + 1));
      expect(data.at(-1)).toEqual({ jsonrpc: '2.0', id: 7, result: answer });
    } finally {
      await close(server);
    }
  });

  it('keeps the stream alive with comments when the request has no progress token', async () => {
    const { server, port } = await serve(KEEP_ALIVE_MS * 5);
    try {
      const result = await call(port, 'text/event-stream, application/json');
      expect(result.type).toBe('text/event-stream');
      const { data, comments } = events(result.body);
      expect(comments).toBeGreaterThanOrEqual(2);
      expect(data).toEqual([{ jsonrpc: '2.0', id: 7, result: answer }]);
    } finally {
      await close(server);
    }
  });

  it('still answers JSON-only clients with JSON after a long wait', async () => {
    const { server, port } = await serve(KEEP_ALIVE_MS * 5);
    try {
      const result = await call(port, 'application/json', { progressToken: 1 });
      expect(result.type).toBe('application/json');
      expect(JSON.parse(result.body)).toEqual({ jsonrpc: '2.0', id: 7, result: answer });
    } finally {
      await close(server);
    }
  });

  it('stops keeping alive once the client disconnects', async () => {
    const { server, port, calls } = await serve(KEEP_ALIVE_MS * 10);
    try {
      await new Promise<void>((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'conversations_ask', arguments: {}, _meta: { progressToken: 1 } } });
        const request = httpRequest({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } }, (response) => {
          response.once('data', () => {
            request.destroy();
            resolve();
          });
        });
        request.on('error', () => {});
        request.once('timeout', reject);
        request.end(body);
      });
      await new Promise((resolve) => setTimeout(resolve, KEEP_ALIVE_MS * 12));
      expect(calls[0]?.closed).toBe(true);
    } finally {
      await close(server);
    }
  });
});
