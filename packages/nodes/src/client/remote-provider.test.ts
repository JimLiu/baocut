import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderFailure, type TranscribeAttempt, type TranscribeRun, type TranscribeSink } from '@baocut/models';
import { NODE_HEALTH_SCHEMA, type NodeHealth } from '@baocut/protocol';
import {
  TEST_NODE_BUNDLE,
  TEST_NODE_MISSING_BUNDLE,
  nodeFetch,
  startTcpProxy,
  startTestNode,
  type TcpProxy,
  type TestNode,
  type TestNodeOptions,
} from '../testing/test-node.ts';
import type { PairedNodeRecord } from './node-store.ts';
import { RemoteNodeProvider, type RemoteTiming } from './remote-provider.ts';

/**
 * 远端节点 Provider 对着真实的测试节点（回环 HTTP、真的 JobManager、假的 Model Worker）跑；网络故障由回环 TCP 代理模拟。
 * 期限都缩短到毫秒级。
 */

const CLIENT_ID = 'c_provider_test';
const MEDIA = Buffer.from('RIFF fake audio bytes for the remote provider tests');
const FAST: Partial<RemoteTiming> = {
  requestTimeoutMs: 2_000,
  transferIdleMs: 2_000,
  lostAfterMs: 800,
  heartbeatTimeoutMs: 2_000,
  backoffMinMs: 20,
  backoffMaxMs: 100,
  cancelTimeoutMs: 2_000,
  deleteTimeoutMs: 1_000,
};

interface Recorded {
  events: string[];
  progress: Array<{ phase: string; done: number }>;
  languages: string[];
  warnings: string[];
}

function recorder(): { sink: TranscribeSink; seen: Recorded } {
  const seen: Recorded = { events: [], progress: [], languages: [], warnings: [] };
  const sink: TranscribeSink = {
    loading: () => seen.events.push('loading'),
    phase: (phase) => seen.events.push(phase),
    progress: (p) => seen.progress.push({ phase: p.phase, done: p.done }),
    segment: () => seen.events.push('segment'),
    warning: (w) => seen.warnings.push(w.code),
    language: (tag) => seen.languages.push(tag),
  };
  return { sink, seen };
}

/** 只有一个节点、令牌固定的配对表。 */
function fixedNode(record: PairedNodeRecord, token = 'c.x') {
  return { get: () => record, token: async () => token, credentialProblem: () => null };
}

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('RemoteNodeProvider', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
  });

  async function setup(options: { node?: TestNodeOptions; proxy?: boolean; timing?: Partial<RemoteTiming>; token?: string } = {}) {
    const node = await startTestNode(options.node);
    cleanups.push(() => node.close());
    const token = options.token ?? (await node.pair(CLIENT_ID));
    let proxy: TcpProxy | null = null;
    if (options.proxy) {
      proxy = await startTcpProxy(node.service.port!);
      cleanups.push(() => proxy!.close());
    }
    const record: PairedNodeRecord = {
      nodeId: node.service.status().nodeId!,
      alias: 'test-node',
      name: 'test-node',
      host: '127.0.0.1',
      port: proxy ? proxy.port : node.service.port!,
      pairedAt: new Date().toISOString(),
    };
    const records = new Map([[record.nodeId, record]]);
    const provider = new RemoteNodeProvider({
      nodes: { get: (id) => records.get(id) ?? null, token: async (id) => (records.has(id) ? token : null), credentialProblem: () => null },
      timing: { ...FAST, ...options.timing },
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-remote-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const media = path.join(dir, 'media.wav');
    await fs.writeFile(media, MEDIA);
    let attempts = 0;
    const run = async (bundleId = TEST_NODE_BUNDLE, extra: Partial<TranscribeRun> = {}): Promise<TranscribeRun> => {
      const staging = path.join(dir, `staging-${++attempts}`);
      await fs.mkdir(staging, { recursive: true });
      return {
        jobId: `job_${attempts}`,
        runGeneration: 1,
        bundleId,
        input: { file: media, contentHash: `sha256:${crypto.createHash('sha256').update(MEDIA).digest('hex')}`, track: 0 },
        options: { language: { mode: 'prefer', tag: null }, diarize: false, timescale: 1_000_000 },
        staging,
        mediaType: 'audio/wav',
        node: record.nodeId,
        ...extra,
      };
    };
    return { node, proxy, provider, record, records, token, run };
  }

  /** 失败时的 ProviderFailure（成功或取消就让测试失败）。 */
  async function failureOf(promise: Promise<TranscribeAttempt>): Promise<ProviderFailure> {
    const error = await promise.then(
      (attempt) => {
        throw new Error(`应当失败，实际 ${attempt.outcome}`);
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProviderFailure);
    return error as ProviderFailure;
  }

  /** 节点上这个客户端的任务都已删除。 */
  const nodeJobsGone = (node: TestNode) => node.service.jobs.counts().running + node.service.jobs.counts().queued === 0;

  it('完成：结果在 staging 里且核对过，阶段与进度转给 sink，节点上的任务已删除', async () => {
    const { node, provider, run, token } = await setup();
    const r = await run();
    const { sink, seen } = recorder();
    const attempt = await provider.transcribe(r, sink, new AbortController().signal);
    expect(attempt).toMatchObject({ outcome: 'completed', workerVersion: '0.0.0-fake', runGeneration: 1 });
    if (attempt.outcome !== 'completed') throw new Error('unreachable');
    const bytes = await fs.readFile(path.join(r.staging, attempt.output.path));
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(attempt.output.sha256);
    expect(bytes.length).toBe(attempt.output.byteLength);
    expect(seen.events).toEqual(expect.arrayContaining(['loading', 'decoding', 'transcribing', 'finalizing']));
    expect(seen.progress.length).toBeGreaterThan(0);
    expect(seen.languages).toEqual(['en']);
    // 删除：节点上已经没有任务记录。
    const listed = node.manager.list().filter((j) => j.submitter.kind === 'node');
    expect(listed).toHaveLength(1);
    expect(await fs.readdir(node.home.nodeJobsDir).catch(() => [])).toEqual([]);
    expect(nodeJobsGone(node)).toBe(true);
    const probe = await nodeFetch(node.baseUrl, token, `/v1/jobs/${encodeURIComponent('job_x')}`);
    expect(probe.status).toBe(404);
  });

  it('节点上 Worker 崩溃一次：节点自己重试，结果的 runGeneration 是节点的尝试序号', async () => {
    const { provider, run } = await setup();
    const attempt = await provider.transcribe(await run(`${TEST_NODE_BUNDLE}#crash-once`), recorder().sink, new AbortController().signal);
    expect(attempt).toMatchObject({ outcome: 'completed', runGeneration: 2 });
  });

  it('节点上的任务失败：remote-failed，带节点的错误码与 nodeId', async () => {
    const { provider, run, record } = await setup();
    const failure = await failureOf(
      provider.transcribe(await run(`${TEST_NODE_BUNDLE}#crash-on-run`), recorder().sink, new AbortController().signal),
    );
    expect(failure.kind).toBe('remote-failed');
    expect(failure.details).toMatchObject({ code: 'MODEL_WORKER_CRASHED', node: record.nodeId });
  });

  it('预检的拒绝：模型包不在节点上、能力关闭、令牌无效、地址上换了节点', async () => {
    const missing = await setup();
    let failure = await failureOf(
      missing.provider.transcribe(await missing.run(TEST_NODE_MISSING_BUNDLE), recorder().sink, new AbortController().signal),
    );
    expect(failure).toMatchObject({ kind: 'node-rejected', details: { reason: 'model-not-ready', node: missing.record.nodeId } });
    failure = await failureOf(
      missing.provider.transcribe(await missing.run('no-such@bundle'), recorder().sink, new AbortController().signal),
    );
    expect(failure).toMatchObject({ kind: 'node-rejected', details: { reason: 'model-not-ready' } });

    const disabled = await setup({ node: { capabilities: { transcribe: false } } });
    failure = await failureOf(disabled.provider.transcribe(await disabled.run(), recorder().sink, new AbortController().signal));
    expect(failure).toMatchObject({
      kind: 'node-rejected',
      details: { reason: 'capability-disabled', node: disabled.record.nodeId, capability: 'transcribe' },
    });
    // 说明点名节点并给出补救，而不是泛泛的失败。
    expect(failure.message).toContain('test-node');
    expect(failure.message).toContain('baocut share capability transcribe on');

    const revoked = await setup({ token: `${CLIENT_ID}.not-a-real-secret` });
    failure = await failureOf(revoked.provider.transcribe(await revoked.run(), recorder().sink, new AbortController().signal));
    expect(failure).toMatchObject({ kind: 'node-rejected', details: { reason: 'unpaired', node: revoked.record.nodeId } });
    expect(failure.message).not.toContain('not-a-real-secret');
    expect(JSON.stringify(failure.details)).not.toContain('not-a-real-secret');

    // 本机记的是 node_other，这个地址上却是另一台节点。
    const swapped = await setup();
    swapped.records.set('node_other', { ...swapped.record, nodeId: 'node_other' });
    failure = await failureOf(
      swapped.provider.transcribe(await swapped.run(undefined, { node: 'node_other' }), recorder().sink, new AbortController().signal),
    );
    expect(failure).toMatchObject({ kind: 'node-rejected', details: { reason: 'unpaired', node: 'node_other' } });

    // 不在配对列表里的节点
    failure = await failureOf(
      swapped.provider.transcribe(await swapped.run(undefined, { node: 'node_gone' }), recorder().sink, new AbortController().signal),
    );
    expect(failure).toMatchObject({ kind: 'node-rejected', details: { reason: 'unpaired' } });
  });

  it('预检之后节点才关掉转写：创建时的 403 CAPABILITY_DISABLED 同样归为 capability-disabled，带补救', async () => {
    const health: NodeHealth = {
      schema: NODE_HEALTH_SCHEMA,
      nodeId: 'node_race',
      name: 'race',
      nodeProtocolVersion: 1,
      minNodeProtocolVersion: 1,
      runtimeVersion: '0.1.0',
      platform: { os: 'darwin', arch: 'arm64' },
      capabilities: {
        transcribe: {
          enabled: true,
          bundles: [{ bundleId: TEST_NODE_BUNDLE, backend: 'candle', device: 'cpu', state: 'installed' }],
          running: 0,
          queued: 0,
        },
      },
    };
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/health') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(health));
      req.resume();
      res
        .writeHead(403, { 'content-type': 'application/json' })
        .end(
          JSON.stringify({ error: { code: 'CAPABILITY_DISABLED', message: '节点没有开放转写', details: { capability: 'transcribe' } } }),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
    const port = (server.address() as net.AddressInfo).port;
    const record: PairedNodeRecord = {
      nodeId: 'node_race',
      alias: 'Studio',
      name: 'race',
      host: '127.0.0.1',
      port,
      pairedAt: '',
    };
    const provider = new RemoteNodeProvider({ nodes: fixedNode(record), timing: FAST });
    const { run } = await setup();
    const failure = await failureOf(
      provider.transcribe(await run(undefined, { node: 'node_race' }), recorder().sink, new AbortController().signal),
    );
    expect(failure).toMatchObject({
      kind: 'node-rejected',
      details: { reason: 'capability-disabled', node: 'node_race', capability: 'transcribe' },
    });
    expect(failure.message).toContain('Studio');
    expect(failure.message).toContain('baocut share capability transcribe on');
  });

  it('令牌读不到（凭据存储不可用）：unavailable，带原因、不带令牌，不发请求', async () => {
    let requests = 0;
    const server = http.createServer((_req, res) => {
      requests++;
      res.writeHead(500).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
    const port = (server.address() as net.AddressInfo).port;
    const record: PairedNodeRecord = { nodeId: 'node_locked', alias: 'Locked', name: 'l', host: '127.0.0.1', port, pairedAt: '' };
    const provider = new RemoteNodeProvider({
      nodes: {
        get: () => record,
        token: async () => {
          throw new Error('钥匙串被锁');
        },
        credentialProblem: () => '凭据存储不可用：钥匙串被锁',
      },
      timing: FAST,
    });
    const { run } = await setup();
    const failure = await failureOf(
      provider.transcribe(await run(undefined, { node: 'node_locked' }), recorder().sink, new AbortController().signal),
    );
    expect(failure).toMatchObject({ kind: 'unavailable', details: { node: 'node_locked' } });
    expect(failure.message).toContain('钥匙串被锁');
    expect(requests).toBe(0);

    // 凭据存储里没有令牌：按不再配对处理。
    const missing = new RemoteNodeProvider({ nodes: { ...fixedNode(record), token: async () => null }, timing: FAST });
    const unpaired = await failureOf(
      missing.transcribe(await run(undefined, { node: 'node_locked' }), recorder().sink, new AbortController().signal),
    );
    expect(unpaired).toMatchObject({ kind: 'node-rejected', details: { reason: 'unpaired', node: 'node_locked' } });
    expect(requests).toBe(0);
  });

  it('协议版本不兼容：version', async () => {
    const health: NodeHealth = {
      schema: NODE_HEALTH_SCHEMA,
      nodeId: 'node_future',
      name: 'future',
      nodeProtocolVersion: 3,
      minNodeProtocolVersion: 2,
      runtimeVersion: '9.9.9',
      platform: { os: 'darwin', arch: 'arm64' },
      capabilities: { transcribe: { enabled: true, bundles: [], running: 0, queued: 0 } },
    };
    const server = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(health)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
    const port = (server.address() as net.AddressInfo).port;
    const record: PairedNodeRecord = { nodeId: 'node_future', alias: 'f', name: 'f', host: '127.0.0.1', port, pairedAt: '' };
    const provider = new RemoteNodeProvider({ nodes: fixedNode(record), timing: FAST });
    const { run } = await setup();
    const failure = await failureOf(
      provider.transcribe(await run(undefined, { node: 'node_future' }), recorder().sink, new AbortController().signal),
    );
    expect(failure).toMatchObject({ kind: 'node-rejected', details: { reason: 'version', node: 'node_future' } });
  });

  it('连不上：node-lost / unreachable', async () => {
    const { provider, run, records, record } = await setup();
    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    records.set(record.nodeId, { ...record, port });
    const failure = await failureOf(provider.transcribe(await run(), recorder().sink, new AbortController().signal));
    expect(failure).toMatchObject({ kind: 'node-lost', details: { reason: 'unreachable', node: record.nodeId } });
  });

  it('取消：节点确认后删除任务，结果为 cancelled 且没有警告', async () => {
    const { node, provider, run } = await setup();
    const controller = new AbortController();
    const { sink, seen } = recorder();
    const pending = provider.transcribe(await run(`${TEST_NODE_BUNDLE}#slow`), sink, controller.signal);
    await until(() => seen.progress.length > 0);
    controller.abort();
    expect(await pending).toEqual({ outcome: 'cancelled', workerVersion: null });
    await until(() => node.manager.list().some((j) => j.submitter.kind === 'node' && j.state === 'cancelled'));
    expect(nodeJobsGone(node)).toBe(true);
    expect(await fs.readdir(node.home.nodeJobsDir).catch(() => [])).toEqual([]);
  });

  it('取消时节点不可达：仍然 cancelled，带 remote-cancel-unconfirmed', async () => {
    const { provider, proxy, run } = await setup({ proxy: true });
    const controller = new AbortController();
    const { sink, seen } = recorder();
    const pending = provider.transcribe(await run(`${TEST_NODE_BUNDLE}#slow`), sink, controller.signal);
    await until(() => seen.progress.length > 0);
    proxy!.down();
    controller.abort();
    expect(await pending).toEqual({ outcome: 'cancelled', workerVersion: null, warnings: [{ code: 'remote-cancel-unconfirmed' }] });
  });

  it('事件流断一次：带 since 重连，进度不倒退、不重复，照常完成', async () => {
    const { provider, proxy, run } = await setup({ proxy: true });
    proxy!.dropOnce((line) => line.includes('/events'), 700);
    const { sink, seen } = recorder();
    const attempt = await provider.transcribe(await run(`${TEST_NODE_BUNDLE}#slow`), sink, new AbortController().signal);
    expect(attempt.outcome).toBe('completed');
    const streams = proxy!.requests.filter((line) => line.includes('/events'));
    expect(streams.length).toBeGreaterThanOrEqual(2);
    expect(streams[1]).toMatch(/since=\d+/);
    const done = seen.progress.filter((p) => p.phase === 'transcribing').map((p) => p.done);
    for (let i = 1; i < done.length; i++) expect(done[i]!).toBeGreaterThan(done[i - 1]!);
    expect(done.at(-1)).toBe(20);
  });

  it('心跳超时也算断开：重连后照常完成', async () => {
    // 节点每 300 毫秒才有一条进度、心跳 15 秒：100 毫秒没有数据就断开重连。
    const { provider, proxy, run } = await setup({ proxy: true, timing: { heartbeatTimeoutMs: 100, lostAfterMs: 5_000 } });
    const attempt = await provider.transcribe(await run(`${TEST_NODE_BUNDLE}#slow`), recorder().sink, new AbortController().signal);
    expect(attempt.outcome).toBe('completed');
    expect(proxy!.requests.filter((line) => line.includes('/events')).length).toBeGreaterThan(3);
  });

  it('节点失联：重连期限到了 node-lost / stream-lost', async () => {
    const { provider, proxy, run, record } = await setup({ proxy: true });
    const { sink, seen } = recorder();
    // 先挂上处理：失败可能发生在下面的 await 期间。
    const failing = failureOf(provider.transcribe(await run(`${TEST_NODE_BUNDLE}#slow`), sink, new AbortController().signal));
    await until(() => seen.progress.length > 0);
    proxy!.down();
    const failure = await failing;
    expect(failure).toMatchObject({ kind: 'node-lost', details: { reason: 'stream-lost', node: record.nodeId } });
  });

  it('节点重启：重连时任务已不存在，node-lost / node-restarted', async () => {
    const { node, provider, proxy, run } = await setup({ proxy: true, timing: { lostAfterMs: 10_000 } });
    const { sink, seen } = recorder();
    // 先挂上处理：失败可能发生在下面的 await 期间。
    const failing = failureOf(provider.transcribe(await run(`${TEST_NODE_BUNDLE}#slow`), sink, new AbortController().signal));
    await until(() => seen.progress.length > 0);
    proxy!.down();
    await node.close({ keepDir: true });
    const restarted = await startTestNode({ dir: node.dir });
    cleanups.push(() => restarted.close());
    proxy!.retarget(restarted.service.port!);
    proxy!.up();
    const failure = await failing;
    expect(failure).toMatchObject({ kind: 'node-lost', details: { reason: 'node-restarted' } });
  });

  it('节点停止共享：任务被节点取消（不是我们取消的），node-lost / node-restarted', async () => {
    const { node, provider, run } = await setup();
    const { sink, seen } = recorder();
    // 先挂上处理：失败可能发生在下面的 await 期间。
    const failing = failureOf(provider.transcribe(await run(`${TEST_NODE_BUNDLE}#slow`), sink, new AbortController().signal));
    await until(() => seen.progress.length > 0);
    await node.service.stop();
    const failure = await failing;
    expect(failure.kind).toBe('node-lost');
    expect(['node-restarted', 'stream-lost', 'unreachable']).toContain((failure.details as { reason: string }).reason);
  });
});
