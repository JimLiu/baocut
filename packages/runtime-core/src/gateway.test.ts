import net from 'node:net';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { PROTOCOL_VERSION, RUNTIME_VERSION, type RuntimeInfo } from '@baocut/protocol';
import { Gateway } from './gateway.ts';
import type { RpcHandlers } from './handlers.ts';

const runtime: RuntimeInfo = {
  instanceId: 'rt_test',
  epoch: 'rt_test',
  runtimeVersion: RUNTIME_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  home: '/nonexistent',
  projectsDir: '/nonexistent/projects',
  logsDir: '/nonexistent/logs',
  pid: process.pid,
  startedAt: new Date().toISOString(),
  launchedBy: null,
};

function newGateway(onConnect?: () => void): Gateway {
  return new Gateway({ token: 'token', runtime, handlers: {} as RpcHandlers, log: silentLogger, onConnect });
}

/** 期限内没落定就算失败：修复前监听失败时 Promise 永远挂着。 */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${ms} 毫秒内没有落定`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function hello(token = 'token', protocolVersion = PROTOCOL_VERSION): string {
  return JSON.stringify({
    type: 'hello', token, protocolVersion,
    client: { kind: 'cli', name: 'limit-fixture', version: '0' },
  });
}

/** A real masked client header, including lengths whose payload is deliberately never sent. */
function maskedHeader(length: number, opcode = 1, final = true): Buffer {
  const extended = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const header = Buffer.alloc(2 + extended + 4);
  header[0] = (final ? 0x80 : 0) | opcode;
  header[1] = 0x80 | (extended === 0 ? length : extended === 2 ? 126 : 127);
  if (extended === 2) header.writeUInt16BE(length, 2);
  if (extended === 8) header.writeBigUInt64BE(BigInt(length), 2);
  // An all-zero mask is valid and keeps the fixture payload readable.
  return header;
}

function maskedFrame(payload: string | Buffer, opcode = 1, final = true): Buffer {
  const bytes = typeof payload === 'string' ? Buffer.from(payload) : payload;
  return Buffer.concat([maskedHeader(bytes.length, opcode, final), bytes]);
}

type WireFrame = { opcode: number; payload: Buffer };

/** Minimal RFC 6455 fixture: only server frames are parsed, with bounded waits and public TCP APIs. */
async function rawClient(endpoint: string, initialFrame?: Buffer, origin = 'null') {
  const url = new URL(endpoint);
  const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
  let received = Buffer.alloc(0);
  socket.on('data', (data) => { received = Buffer.concat([received, data]); });
  // Rejections may destroy the transport instead of completing a WebSocket close handshake.
  socket.on('error', () => {});
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  const read = <T>(consume: () => T | undefined): Promise<T> => new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', check);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const check = () => {
      const result = consume();
      if (result !== undefined) { cleanup(); resolve(result); }
    };
    const onClose = () => { cleanup(); reject(new Error('transport closed before the expected frame')); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('no reply within 2000 ms')); }, 2_000);
    socket.on('data', check);
    socket.once('close', onClose);
    socket.once('error', onError);
    check();
  });
  try {
    await within(new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }), 2_000);
    const handshake = Buffer.from([
      `GET ${url.pathname} HTTP/1.1`, `Host: ${url.host}`,
      'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==', `Origin: ${origin}`, '', '',
    ].join('\r\n'));
    socket.write(initialFrame ? Buffer.concat([handshake, initialFrame]) : handshake);
    expect(await read(() => {
      const end = received.indexOf('\r\n\r\n');
      if (end < 0) return undefined;
      const headers = received.subarray(0, end).toString();
      received = received.subarray(end + 4);
      return headers;
    })).toMatch(/^HTTP\/1\.1 101 /);
  } catch (error) {
    socket.destroy();
    throw error;
  }
  const nextFrame = () => read<WireFrame>(() => {
    if (received.length < 2) return undefined;
    const opcode = received[0]! & 0x0f;
    let length = received[1]! & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (received.length < 4) return undefined;
      length = received.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (received.length < 10) return undefined;
      length = Number(received.readBigUInt64BE(2));
      offset = 10;
    }
    if (received.length < offset + length) return undefined;
    const payload = received.subarray(offset, offset + length);
    received = received.subarray(offset + length);
    return { opcode, payload };
  });
  return { socket, closed, nextFrame, receivedBytes: () => received.length };
}

type HandleCounts = { servers: number; timers: number };

/** 本进程里活着的监听端口与定时器个数。 */
function handleCounts(): HandleCounts {
  const info = process.getActiveResourcesInfo();
  return { servers: info.filter((t) => t === 'TCPServerWrap').length, timers: info.filter((t) => t === 'Timeout').length };
}

/** 句柄关闭要到下一轮事件循环才生效：等到个数对上，或者期限到了报出最后一次的个数。 */
async function settledCounts(expected: HandleCounts, ms = 1_000): Promise<HandleCounts> {
  const deadline = Date.now() + ms;
  for (;;) {
    await new Promise((resolve) => setImmediate(resolve));
    const counts = handleCounts();
    if ((counts.servers === expected.servers && counts.timers === expected.timers) || Date.now() > deadline) return counts;
  }
}

describe('网关', () => {
  it('rejects unlisted development origins while opaque desktop origins still require the token', async () => {
    const gateway = newGateway();
    const endpoint = await gateway.listen();
    async function connect(origin: string, token = 'token') {
      const socket = new WebSocket(endpoint, { origin });
      const result = within(new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.once('error', reject);
        socket.once('open', () => socket.send(JSON.stringify({
          type: 'hello', token, protocolVersion: PROTOCOL_VERSION,
          client: { kind: 'desktop', name: 'fixture', version: RUNTIME_VERSION },
        })));
        socket.once('message', (data) => resolve(JSON.parse(data.toString())));
        socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      }), 2_000);
      try {
        return await result;
      } finally {
        socket.terminate();
      }
    }
    try {
      expect(await connect('http://localhost:5174')).toEqual({ code: 1008, reason: 'origin not allowed' });
      expect(await connect('null')).toMatchObject({ type: 'welcome' });
      expect(await connect('null', 'wrong-token')).toMatchObject({ type: 'fatal', error: { code: 'unauthenticated' } });
    } finally {
      await gateway.close();
    }
  });

  it('authenticated command frames above 4 MiB reach dispatch without closing the socket', async () => {
    const gateway = newGateway();
    const endpoint = await gateway.listen();
    const socket = new WebSocket(endpoint);
    const receive = () => within(new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once('message', (data) => resolve(JSON.parse(data.toString())));
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('socket closed before the reply')));
    }), 5000);
    try {
      const welcome = receive();
      socket.once('open', () => socket.send(JSON.stringify({ type: 'hello', token: 'token', protocolVersion: PROTOCOL_VERSION, client: { kind: 'cli', name: 'large-write', version: '0' } })));
      expect(await welcome).toMatchObject({ type: 'welcome' });
      const result = receive();
      socket.send(JSON.stringify({ type: 'request', id: 'large', method: 'fixture.large', params: { body: 'x'.repeat(9 * 1024 * 1024) } }));
      expect(await result).toMatchObject({ id: 'large', error: { code: 'unknown-method' } });
      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      socket.terminate();
      await gateway.close();
    }
  });

  it('rejects a malformed hello above 16 KiB before JSON parsing, including an opaque Origin', async () => {
    let connected = 0;
    const gateway = newGateway(() => connected++);
    const endpoint = await gateway.listen();
    try {
      const client = await rawClient(endpoint);
      try {
        client.socket.write(maskedFrame('not-json'.repeat(2_049)));
        await within(client.closed, 2_000);
        // No JSON/token fatal reply: the oversized hello is discarded at the byte boundary.
        expect(client.receivedBytes()).toBe(0);
        expect(connected).toBe(0);
      } finally {
        client.socket.destroy();
      }
      // A rejected anonymous connection must leave the gateway usable.
      const healthy = await rawClient(endpoint);
      try {
        healthy.socket.write(maskedFrame(hello()));
        expect(JSON.parse((await healthy.nextFrame()).payload.toString())).toMatchObject({ type: 'welcome' });
        expect(connected).toBe(1);
      } finally {
        healthy.socket.destroy();
      }
    } finally {
      await gateway.close();
    }
  });

  it.each(['unfinished', 'fragmented', 'control'] as const)('bounds pre-authentication %s wire traffic before the hello timeout', async (kind) => {
    const gateway = newGateway();
    const endpoint = await gateway.listen();
    const client = await rawClient(endpoint);
    try {
      if (kind === 'unfinished') {
        // ws cannot emit a message yet: the declared 1 MiB text payload remains unfinished.
        client.socket.write(Buffer.concat([maskedHeader(1024 * 1024), Buffer.alloc(64 * 1024 + 1, 0x78)]));
      } else if (kind === 'fragmented') {
        const fragment = Buffer.alloc(16 * 1024, 0x78);
        client.socket.write(Buffer.concat([
          maskedFrame(fragment, 1, false),
          ...Array.from({ length: 4 }, () => maskedFrame(fragment, 0, false)),
        ]));
      } else {
        // 62,520 payload bytes stay below 64 KiB, but 521 masked ping frames use 65,646 wire bytes.
        const ping = maskedFrame(Buffer.alloc(120), 9);
        client.socket.write(Buffer.concat(Array.from({ length: 521 }, () => ping)));
      }
      // The existing hello timeout is 5 seconds; rejection must happen as bytes arrive.
      await within(client.closed, 2_000);
    } finally {
      client.socket.destroy();
      await gateway.close();
    }
  });

  it('bounds rejected-Origin traffic while the peer refuses the close handshake', async () => {
    let connected = 0;
    const gateway = newGateway(() => connected++);
    const endpoint = await gateway.listen();
    const client = await rawClient(endpoint, undefined, 'http://localhost:5174');
    try {
      const close = await client.nextFrame();
      expect(close.opcode).toBe(8);
      expect(close.payload.readUInt16BE(0)).toBe(1008);
      expect(close.payload.subarray(2).toString()).toBe('origin not allowed');
      // Never acknowledge the close: the rejected peer can still send an unfinished payload.
      client.socket.write(Buffer.concat([maskedHeader(1024 * 1024), Buffer.alloc(64 * 1024 + 1, 0x78)]));
      await within(client.closed, 2_000);
      expect(connected).toBe(0);
    } finally {
      client.socket.destroy();
      await gateway.close();
    }
  });

  it.each([
    { token: 'wrong-token', protocolVersion: PROTOCOL_VERSION, code: 'unauthenticated' },
    { token: 'token', protocolVersion: PROTOCOL_VERSION + 1, code: 'protocol-mismatch' },
  ])('does not authenticate a pipelined hello after $code', async ({ token, protocolVersion, code }) => {
    let connected = 0;
    const gateway = newGateway(() => connected++);
    const endpoint = await gateway.listen();
    const client = await rawClient(endpoint);
    try {
      client.socket.write(Buffer.concat([maskedFrame(hello(token, protocolVersion)), maskedFrame(hello())]));
      expect(JSON.parse((await client.nextFrame()).payload.toString())).toMatchObject({ type: 'fatal', error: { code } });
      const close = await client.nextFrame();
      expect(close.opcode).toBe(8);
      expect(close.payload.readUInt16BE(0)).toBe(1008);
      expect(connected).toBe(0);
    } finally {
      client.socket.destroy();
      await gateway.close();
    }
  });

  it('rejects an authenticated frame above 64 MiB from its header without buffering its payload', async () => {
    const gateway = newGateway();
    const endpoint = await gateway.listen();
    const client = await rawClient(endpoint);
    try {
      client.socket.write(maskedFrame(hello()));
      expect(JSON.parse((await client.nextFrame()).payload.toString())).toMatchObject({ type: 'welcome' });
      client.socket.write(maskedHeader(64 * 1024 * 1024 + 1));
      const close = await client.nextFrame();
      expect(close.opcode).toBe(8);
      expect(close.payload.readUInt16BE(0)).toBe(1009);
    } finally {
      client.socket.destroy();
      await gateway.close();
    }
  });

  it('enforces hello and wire budgets on externally authenticated HTTP upgrades, including upgrade head bytes', async () => {
    let connected = 0;
    const gateway = newGateway(() => connected++);
    const http = createServer();
    http.on('upgrade', (request, socket, head) => gateway.upgrade(request, socket, head, {
      kind: 'web', name: 'session-fixture', sessionId: 'session-test',
    }));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const endpoint = `ws://127.0.0.1:${(http.address() as net.AddressInfo).port}`;
    const clients: Awaited<ReturnType<typeof rawClient>>[] = [];
    try {
      const oversized = await rawClient(endpoint, maskedFrame('not-json'.repeat(2_049)));
      clients.push(oversized);
      await within(oversized.closed, 2_000);
      expect(oversized.receivedBytes()).toBe(0);

      const unfinished = await rawClient(endpoint, Buffer.concat([
        maskedHeader(1024 * 1024), Buffer.alloc(64 * 1024 + 1, 0x78),
      ]));
      clients.push(unfinished);
      await within(unfinished.closed, 2_000);
      expect(connected).toBe(0);

      const healthy = await rawClient(endpoint);
      clients.push(healthy);
      healthy.socket.write(maskedFrame(hello('cookie-authenticated')));
      expect(JSON.parse((await healthy.nextFrame()).payload.toString())).toMatchObject({ type: 'welcome' });
      expect(connected).toBe(1);
      healthy.socket.write(maskedHeader(64 * 1024 * 1024 + 1));
      const authenticatedClose = await healthy.nextFrame();
      expect(authenticatedClose.opcode).toBe(8);
      expect(authenticatedClose.payload.readUInt16BE(0)).toBe(1009);
    } finally {
      for (const client of clients) client.socket.destroy();
      await gateway.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });

  it('端口被占用：listen 带着原始错误拒绝，不留下监听或心跳定时器', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as net.AddressInfo).port;
    try {
      const before = await settledCounts({ servers: 1, timers: 0 });
      const gateway = newGateway();
      const error = await within(gateway.listen('127.0.0.1', taken), 2_000).then(
        () => null,
        (e: unknown) => e as NodeJS.ErrnoException,
      );
      expect(error).toMatchObject({ code: 'EADDRINUSE' });
      expect(error?.message).toContain(String(taken));
      expect(await settledCounts(before)).toEqual(before);
      // 失败后 close 也安全。
      await gateway.close();
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it('监听成功后 close 释放端口与心跳定时器', async () => {
    const before = await settledCounts({ servers: 0, timers: 0 });
    const gateway = newGateway();
    const endpoint = await gateway.listen('127.0.0.1', 0);
    expect(endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    const listening = { servers: before.servers + 1, timers: before.timers + 1 };
    expect(await settledCounts(listening)).toEqual(listening);
    await gateway.close();
    expect(await settledCounts(before)).toEqual(before);
  });
});
