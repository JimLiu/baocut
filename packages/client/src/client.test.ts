import { afterEach, expect, it, vi } from 'vitest';
import type { ServerFrame, SubscribeResult } from '@baocut/protocol';
import { BaoCutClient } from './client.ts';

const clients: BaoCutClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });

async function connected(onSubscribe: (socket: TestSocket, id: string) => void) {
  class Socket extends TestSocket {
    constructor() {
      super(onSubscribe);
      queueMicrotask(() => this.onopen?.());
    }
  }
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint: 'ws://test', token: 'test' }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
    WebSocket: Socket as unknown as typeof WebSocket,
  });
  clients.push(client);
  await client.connect();
  return client;
}

class TestSocket {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly onSubscribe: (socket: TestSocket, id: string) => void;
  constructor(onSubscribe: (socket: TestSocket, id: string) => void) { this.onSubscribe = onSubscribe; }

  emit(frame: ServerFrame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  respond(id: string, result: SubscribeResult<string, string>) {
    this.emit({ type: 'response', id, ok: true, result });
  }
  event(seq: string) { this.emit({ type: 'event', topic: 'settings', seq, event: seq }); }
  send(data: string) {
    const frame = JSON.parse(data);
    if (frame.type === 'hello') {
      this.emit({ type: 'welcome', connectionId: 'conn_test', runtime: {
        instanceId: 'runtime_test', epoch: 'test', runtimeVersion: '0', protocolVersion: '0',
        home: '/test', projectsDir: '/test/projects', logsDir: '/test/logs', pid: 1,
        startedAt: new Date(0).toISOString(), launchedBy: null,
      } });
    } else if (frame.method === 'subscribe') {
      this.onSubscribe(this, frame.id);
    } else {
      this.emit({ type: 'response', id: frame.id, ok: true, result: { ok: true } });
    }
  }
  close() { this.onclose?.({ reason: 'closed' }); }
}

it('keeps events delivered in the same turn as the subscription response, after the snapshot and without duplicates', async () => {
  const client = await connected((socket, id) => {
    socket.event('1');
    socket.respond(id, { mode: 'snapshot', seq: '1', snapshot: '1' });
    socket.event('2');
    socket.event('2');
    socket.event('3');
  });
  const received: string[] = [];
  client.subscribe<string, string>('settings', {
    snapshot: (snapshot) => received.push(`snapshot:${snapshot}`),
    event: (event) => received.push(`event:${event}`),
  });
  await Promise.resolve();
  expect(received).toEqual(['snapshot:1', 'event:2', 'event:3']);
});

it('takes a fresh snapshot when a buffered event has a gap, then delivers its subsequent events', async () => {
  let subscriptions = 0;
  const client = await connected((socket, id) => {
    subscriptions++;
    const seq = subscriptions === 1 ? '1' : '3';
    socket.respond(id, { mode: 'snapshot', seq, snapshot: seq });
    socket.event(subscriptions === 1 ? '3' : '4');
  });
  const received: string[] = [];
  client.subscribe<string, string>('settings', {
    snapshot: (snapshot) => received.push(`snapshot:${snapshot}`),
    event: (event) => received.push(`event:${event}`),
  });
  await vi.waitFor(() => expect(received).toEqual(['snapshot:1', 'snapshot:3', 'event:4']));
  expect(subscriptions).toBe(2);
});

it('does not deliver buffered events after the snapshot handler unsubscribes', async () => {
  const client = await connected((socket, id) => {
    socket.respond(id, { mode: 'snapshot', seq: '1', snapshot: '1' });
    socket.event('2');
  });
  const event = vi.fn();
  const stop = client.subscribe<string, string>('settings', {
    snapshot: () => stop(),
    event,
  });
  await Promise.resolve();
  expect(event).not.toHaveBeenCalled();
});
