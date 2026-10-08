import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BaoCutClient, applyJobsEvent } from '@baocut/client';
import { FAKE_MODEL_WORKER } from '@baocut/jobs';
import { BUNDLES, DEFAULT_TRANSCRIBE_BUNDLE, MANIFEST_FILE } from '@baocut/models';
import type { Discoverer, RemoteTiming } from '@baocut/nodes';
import { FakeAdvertiser, nodeFetch, pairingCodeOf, startTcpProxy, type TcpProxy } from '@baocut/nodes/testing';
import { newId, type DiscoveredNode, type JobRecord, type JobsEvent, type JobsSnapshot, type ShareStatus } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * 两台 Runtime（各自的临时 Home）之间的局域网能力共享，全部经网关：
 * - 节点 A：开启共享（127.0.0.1、系统分配端口、假的 mDNS），合成的默认模型包，假的 Model Worker（故障由控制文件注入）；
 * - 发起端 B：真实的视频引擎，默认没有模型也没有 Worker，经回环 TCP 代理连 A（模拟断流与失联）。
 * 要 engine-host、ffmpeg 与 Apple Silicon（默认模型包是 MLX），缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
if (!engine) console.warn('跳过两台 Runtime 的节点测试：没有构建 engine-host（npm run build:engine）');
if (!ffmpeg) console.warn('跳过两台 Runtime 的节点测试：没有 ffmpeg');
if (!appleSilicon) console.warn('跳过两台 Runtime 的节点测试：默认模型包（MLX）只在 Apple Silicon 的 macOS 上可用');

/** 发起端的期限：失联判定缩短到 1.5 秒。 */
const FAST: Partial<RemoteTiming> = {
  requestTimeoutMs: 3_000,
  transferIdleMs: 5_000,
  lostAfterMs: 1_500,
  heartbeatTimeoutMs: 3_000,
  backoffMinMs: 50,
  backoffMaxMs: 200,
  cancelTimeoutMs: 5_000,
  deleteTimeoutMs: 2_000,
};
const TRANSCRIPT = 'testing one two three baocut is ready';

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 给默认模型包的每个仓库写一份合成的清单与文件。 */
async function installSyntheticModels(modelsDir: string): Promise<void> {
  const bundle = BUNDLES.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)!;
  for (const source of Object.values(bundle.components)) {
    if (!source) continue;
    const dir = path.join(modelsDir, ...source.repo.split('/'));
    await fs.mkdir(dir, { recursive: true });
    const content = `synthetic ${source.repo}`;
    await fs.writeFile(path.join(dir, 'model.safetensors'), content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const manifest = {
      format_version: 1,
      repo: source.repo,
      revision: source.revision,
      files: [{ path: 'model.safetensors', size: content.length, sha256 }],
    };
    await fs.writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest));
  }
}

const listDir = (dir: string) => fs.readdir(dir).catch(() => [] as string[]);

/** 可以在测试中途改结果的假发现。 */
class FakeDiscoverer implements Discoverer {
  nodes: DiscoveredNode[] = [];
  async discover(): Promise<DiscoveredNode[]> {
    return this.nodes;
  }
}

interface NodeSide {
  home: RuntimeHome;
  runtime: RunningRuntime;
  client: BaoCutClient;
  share: ShareStatus;
  /** 假 Model Worker 的控制文件：`{ faults: [...] }`，每次 job.run 重新读。 */
  faults(list: string[]): Promise<void>;
}

interface InitiatorSide {
  home: RuntimeHome;
  runtime: RunningRuntime;
  client: BaoCutClient;
  discoverer: FakeDiscoverer;
  videoId: string;
  assetId: string;
  /** 主题上收到的全部 jobs 事件（令牌检查用）。 */
  events: JobsEvent[];
  jobs(): JobsSnapshot | null;
}

/** 主题事件里的任务记录（`job.updated`），按到达顺序。 */
const jobUpdates = (events: JobsEvent[]): JobRecord[] => events.flatMap((e) => (e.type === 'job.updated' ? [e.job] : []));

describe.skipIf(!engine || !ffmpeg || !appleSilicon)('局域网能力共享：两台 Runtime', () => {
  let fixtures: string;
  let audio: string;
  const cleanups: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    audio = path.join(fixtures, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '16000', '-ac', '1', audio]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
  });

  async function connect(runtime: RunningRuntime): Promise<BaoCutClient> {
    const { endpoint, token } = runtime.discovery;
    const client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'cli', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    cleanups.push(async () => client.close());
    return client;
  }

  async function tempHome(prefix: string): Promise<RuntimeHome> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    return resolveRuntimeHome({ BAOCUT_HOME: dir });
  }

  /** 节点 A：每个测试一台新的（本地 Provider 5 分钟内崩溃 3 次会停用模型包）。 */
  async function startNode(options: { models?: boolean; faults?: string[] } = {}): Promise<NodeSide> {
    const home = await tempHome('baocut-node-a-');
    if (options.models !== false) await installSyntheticModels(home.modelsDir);
    const control = path.join(home.root, 'worker-control.json');
    const faults = (list: string[]) => fs.writeFile(control, JSON.stringify({ faults: list }));
    await faults(options.faults ?? []);
    const runtime = await startRuntime({
      home,
      drivers: () => [],
      watchSpace: false,
      engineHost: null,
      modelWorker: { command: process.execPath, args: [FAKE_MODEL_WORKER, '--control', control] },
      jobIdleMs: 60_000,
      nodes: { host: '127.0.0.1', advertiser: new FakeAdvertiser() },
      initiator: { discoverer: null },
    });
    cleanups.push(() => runtime.close());
    const client = await connect(runtime);
    const share = await client.request('nodes.share.start', { port: 0, name: 'Studio' });
    return { home, runtime, client, share, faults };
  }

  /** 发起端 B：真实引擎；默认没有模型也没有 Worker。一个视频、一段录音。 */
  async function startInitiator(options: { local?: boolean; timing?: Partial<RemoteTiming> } = {}): Promise<InitiatorSide> {
    const home = await tempHome('baocut-initiator-b-');
    if (options.local) await installSyntheticModels(home.modelsDir);
    const discoverer = new FakeDiscoverer();
    const runtime = await startRuntime({
      home,
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: options.local ? { command: process.execPath, args: [FAKE_MODEL_WORKER] } : null,
      jobIdleMs: 60_000,
      nodes: { host: '127.0.0.1', advertiser: new FakeAdvertiser() },
      initiator: { discoverer, timing: { ...FAST, ...options.timing }, clientName: 'Laptop' },
    });
    cleanups.push(() => runtime.close());
    const client = await connect(runtime);
    let snapshot: JobsSnapshot | null = null;
    const events: JobsEvent[] = [];
    client.subscribeJobs({
      snapshot: (s) => (snapshot = s),
      event: (event) => {
        events.push(event);
        snapshot = applyJobsEvent(snapshot!, event);
      },
    });
    await until(() => snapshot);
    const { project } = await client.request('projects.create', { name: '远端转写' });
    const opened = await client.request('videos.create', { projectId: project.id });
    const videoId = opened.ref.videoId;
    const imported = await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: opened.snapshot.video.revision,
      operations: [{ type: 'importAsset', path: audio, ref: 'voice' }],
    });
    return { home, runtime, client, discoverer, videoId, assetId: imported.receipt.refs!.voice!, events, jobs: () => snapshot };
  }

  async function proxyTo(node: NodeSide): Promise<TcpProxy> {
    const proxy = await startTcpProxy(node.share.port);
    cleanups.push(() => proxy.close());
    return proxy;
  }

  /** B 经代理与 A 配对，返回 A 的 nodeId。 */
  async function pair(b: InitiatorSide, a: NodeSide, proxy: TcpProxy, alias?: string) {
    // 配对码用过一次就作废：没有了就让 A 重新发一个。
    const code =
      pairingCodeOf(await a.client.request('nodes.share.status', {})) ??
      pairingCodeOf(await a.client.request('nodes.share.pairingCode', {}))!;
    const { node } = await b.client.request('nodes.pair', { host: '127.0.0.1', port: proxy.port, code, ...(alias ? { alias } : {}) });
    return node;
  }

  const settled = (b: InitiatorSide, jobId: string) =>
    until(
      () => b.jobs()!.jobs.find((j) => j.jobId === jobId && ['completed', 'failed', 'cancelled', 'interrupted'].includes(j.state)),
      30_000,
    );

  /** B 存下的令牌（只用来检查它没有漏出去，以及直接问节点）。令牌在凭据存储里，不在 nodes.json 里。 */
  async function storedToken(b: InitiatorSide): Promise<string> {
    const stored = JSON.parse(await fs.readFile(b.home.nodesFile, 'utf8')) as { nodes: Array<{ nodeId: string; token?: string }> };
    expect(stored.nodes[0]).not.toHaveProperty('token');
    const token = await b.runtime.initiator.store.token(stored.nodes[0]!.nodeId);
    expect(token).toBeTruthy();
    return token!;
  }

  async function speechDocuments(b: InitiatorSide): Promise<number> {
    const { entries } = await b.client.request('videos.history', { videoId: b.videoId });
    return entries.filter((e) => e.actor.kind === 'system').length;
  }

  it('a. 配对与列表：经网关配对，列表带健康；错的配对码 REMOTE_NODE_REJECTED / pairing-code-invalid；发现排除自己', async () => {
    const a = await startNode();
    const b = await startInitiator();
    const proxy = await proxyTo(a);

    const wrong = await b.client.request('nodes.pair', { host: '127.0.0.1', port: proxy.port, code: '000000x' }).catch((e: unknown) => e);
    expect(wrong).toMatchObject({ code: 'conflict', details: { code: 'REMOTE_NODE_REJECTED', reason: 'pairing-code-invalid' } });

    const node = await pair(b, a, proxy);
    expect(node).toMatchObject({
      nodeId: a.share.nodeId,
      alias: 'Studio',
      name: 'Studio',
      host: '127.0.0.1',
      port: proxy.port,
      problem: null,
    });
    expect(node.health).toMatchObject({ nodeId: a.share.nodeId, capabilities: { transcribe: { enabled: true } } });
    expect(JSON.stringify(node)).not.toContain('token');

    const { nodes } = await b.client.request('nodes.list', {});
    expect(nodes).toEqual([
      expect.objectContaining({
        nodeId: a.share.nodeId,
        alias: 'Studio',
        problem: null,
        health: expect.objectContaining({ name: 'Studio' }),
      }),
    ]);
    expect((await fs.stat(b.home.nodesFile)).mode & 0o777).toBe(0o600);
    const status = await a.client.request('nodes.share.status', {});
    expect(status.clients).toEqual([expect.objectContaining({ name: 'Laptop', clientId: b.runtime.initiator.clientId })]);

    // 同一个节点再配对一次：替换记录，别名保留。
    const again = await pair(b, a, proxy);
    expect(again.alias).toBe('Studio');
    expect((await b.client.request('nodes.list', {})).nodes).toHaveLength(1);

    // 节点连不上：列表照常返回，problem 为 unreachable。
    proxy.down();
    expect((await b.client.request('nodes.list', {})).nodes[0]).toMatchObject({ problem: 'unreachable', health: null });
    proxy.up();

    // 发现：B 自己也在共享，自己的节点不出现在结果里。
    const own = await b.client.request('nodes.share.start', { port: 0, name: 'Laptop' });
    b.discoverer.nodes = [
      { name: 'Studio', host: '127.0.0.1', port: a.share.port, nodeId: a.share.nodeId },
      { name: 'Laptop', host: '127.0.0.1', port: own.port, nodeId: own.nodeId },
    ];
    expect(await b.client.request('nodes.discover', { timeoutMs: 200 })).toEqual({ nodes: [b.discoverer.nodes[0]] });

    await expect(b.client.request('nodes.remove', { nodeId: 'node_nope' })).rejects.toMatchObject({ code: 'not-found' });
    expect(await b.client.request('nodes.remove', { nodeId: node.nodeId })).toEqual({});
    expect((await b.client.request('nodes.list', {})).nodes).toEqual([]);
    await expect(b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' })).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('b. 用节点转写：B 没有模型与 Worker，视频里多一份 system 写的 speech 文档；A 不留任何东西', async () => {
    const a = await startNode();
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    const node = await pair(b, a, proxy);

    const { jobId } = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    const done = await settled(b, jobId);
    expect(done).toMatchObject({
      state: 'completed',
      attempt: 1,
      error: null,
      providerId: `node:${node.nodeId}`,
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      submitter: { kind: 'connection' },
      result: { documentId: expect.any(String), artifactId: expect.stringMatching(/^sha256:/) },
    });
    // B 的 jobs 主题里看得到节点上的阶段与进度。
    const phases = jobUpdates(b.events)
      .filter((job) => job.jobId === jobId)
      .map((job) => job.phase);
    expect(phases).toEqual(expect.arrayContaining(['transcribing', 'validating', 'applying', 'done']));

    const content = await b.client.request('documents.read', { videoId: b.videoId, documentId: done.result!.documentId! });
    expect(content.document).toMatchObject({ kind: 'speech', sourceAssetId: b.assetId });
    expect((content.body as { words: Array<{ text: string }> }).words.map((w) => w.text).join(' ')).toBe(TRANSCRIPT);
    expect((content.body as { engine: { provider: string } }).engine.provider).toBe(done.providerId);
    const { entries } = await b.client.request('videos.history', { videoId: b.videoId });
    expect(entries[0]).toMatchObject({ actor: { kind: 'system', id: 'system:jobs' } });
    expect(await listDir(b.home.artifactsDir)).toHaveLength(1);
    expect(await listDir(path.join(b.home.stagingDir, 'jobs'))).toEqual([]);

    // A：任务以节点身份提交，没有视频、产物与 staging；节点上的任务已删除（404）。
    const remote = (await a.client.request('jobs.list', {})).jobs;
    expect(remote).toEqual([
      expect.objectContaining({
        state: 'completed',
        videoId: null,
        assetId: null,
        submitter: { kind: 'node', id: b.runtime.initiator.clientId },
      }),
    ]);
    expect(await listDir(a.home.artifactsDir)).toEqual([]);
    expect(await listDir(a.home.nodeJobsDir)).toEqual([]);
    expect(a.runtime.nodes.jobs.counts()).toEqual({ running: 0, queued: 0 });
    const remoteJobId = proxy.requests.map((line) => /^PUT \/v1\/jobs\/([A-Za-z0-9_-]+)\/input/.exec(line)?.[1]).find(Boolean)!;
    expect(remoteJobId).toBeTruthy();
    const probe = await nodeFetch(`http://127.0.0.1:${a.share.port}`, await storedToken(b), `/v1/jobs/${remoteJobId}`);
    expect(probe.status).toBe(404);
  });

  it('c. 节点在任务中途失联：REMOTE_NODE_LOST（stream-lost），attempt 1，B 的 staging 清空，视频不变', async () => {
    const a = await startNode({ faults: ['slow'] });
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    const node = await pair(b, a, proxy);
    const before = await speechDocuments(b);

    const { jobId } = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: node.alias });
    await until(() => b.jobs()!.jobs.find((j) => j.jobId === jobId && j.progress));
    proxy.down();
    const failed = await settled(b, jobId);
    expect(failed).toMatchObject({
      state: 'failed',
      attempt: 1,
      error: { code: 'REMOTE_NODE_LOST', details: { reason: 'stream-lost', node: node.nodeId } },
    });
    expect(await listDir(path.join(b.home.stagingDir, 'jobs'))).toEqual([]);
    expect(await speechDocuments(b)).toBe(before);
  });

  it('d. 事件流断一次而节点还在：带 since 续上，照常完成，进度不倒退', async () => {
    const a = await startNode({ faults: ['slow'] });
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    await pair(b, a, proxy);
    proxy.dropOnce((line) => line.includes('/events'), 1_000);

    const { jobId } = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    expect(await settled(b, jobId)).toMatchObject({ state: 'completed', attempt: 1 });
    const streams = proxy.requests.filter((line) => line.includes('/events'));
    expect(streams.length).toBeGreaterThanOrEqual(2);
    expect(streams[1]).toMatch(/since=\d+/);
    const done = jobUpdates(b.events)
      .filter((job) => job.jobId === jobId && job.phase === 'transcribing' && job.progress)
      .map((job) => job.progress!.done);
    for (let i = 1; i < done.length; i++) expect(done[i]!).toBeGreaterThanOrEqual(done[i - 1]!);
    expect(done.at(-1)).toBe(20);
  });

  it('e. B 中途取消：B cancelled；A 的任务取消并删除；A 的 Worker 之后照常可用', async () => {
    const a = await startNode({ faults: ['slow'] });
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    await pair(b, a, proxy);

    const { jobId } = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    await until(() => b.jobs()!.jobs.find((j) => j.jobId === jobId && j.progress));
    expect(await b.client.request('jobs.cancel', { jobId })).toEqual({ state: 'cancelled' });
    expect(b.jobs()!.jobs.find((j) => j.jobId === jobId)).toMatchObject({ state: 'cancelled', warnings: [] });
    const onA = await until(async () => (await a.client.request('jobs.list', {})).jobs.find((j) => j.state === 'cancelled'));
    expect(onA.submitter.kind).toBe('node');
    expect(a.runtime.nodes.jobs.counts()).toEqual({ running: 0, queued: 0 });
    await until(async () => (await listDir(a.home.nodeJobsDir)).length === 0);

    await a.faults([]);
    const next = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio', hint: 'again' });
    expect(await settled(b, next.jobId)).toMatchObject({ state: 'completed' });
  });

  it('f. A 吊销 B：下一次转写 REMOTE_NODE_REJECTED / unpaired，列表显示 unpaired', async () => {
    const a = await startNode();
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    const node = await pair(b, a, proxy);
    await a.client.request('nodes.share.revoke', { clientId: b.runtime.initiator.clientId });

    const { jobId } = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    expect(await settled(b, jobId)).toMatchObject({
      state: 'failed',
      attempt: 1,
      error: { code: 'REMOTE_NODE_REJECTED', details: { reason: 'unpaired', node: node.nodeId } },
    });
    expect((await b.client.request('nodes.list', {})).nodes[0]).toMatchObject({ problem: 'unpaired', health: expect.any(Object) });
  });

  it('g. 模型包没有装在 A 上：REMOTE_NODE_REJECTED / model-not-ready', async () => {
    const a = await startNode({ models: false });
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    await pair(b, a, proxy);
    const { jobId } = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    expect(await settled(b, jobId)).toMatchObject({
      state: 'failed',
      attempt: 1,
      error: { code: 'REMOTE_NODE_REJECTED', details: { reason: 'model-not-ready' } },
    });
    expect((await a.client.request('jobs.list', {})).jobs).toEqual([]);
  });

  it('h. A 上 Worker 崩溃一次：节点自己重试后完成；崩两次：节点的 MODEL_WORKER_CRASHED，带 details.node，B 的 attempt 1', async () => {
    const once = await startNode({ faults: ['crash-once'] });
    const b = await startInitiator();
    const proxyOnce = await proxyTo(once);
    await pair(b, once, proxyOnce, 'once');
    const first = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'once' });
    expect(await settled(b, first.jobId)).toMatchObject({ state: 'completed', attempt: 1 });
    expect((await once.client.request('jobs.list', {})).jobs[0]).toMatchObject({ state: 'completed', attempt: 2 });

    const twice = await startNode({ faults: ['crash-on-run'] });
    const proxyTwice = await proxyTo(twice);
    const node = await pair(b, twice, proxyTwice, 'twice');
    const second = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'twice' });
    expect(await settled(b, second.jobId)).toMatchObject({
      state: 'failed',
      attempt: 1,
      providerId: `node:${node.nodeId}`,
      error: { code: 'MODEL_WORKER_CRASHED', details: { node: node.nodeId } },
    });
  });

  it('i. 同一素材的本机任务与远端任务是两个任务，都完成', async () => {
    const a = await startNode({ faults: ['slow'] });
    const b = await startInitiator({ local: true });
    const proxy = await proxyTo(a);
    const node = await pair(b, a, proxy);
    const remote = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    const local = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId });
    expect(local.jobId).not.toBe(remote.jobId);
    const [r, l] = await Promise.all([settled(b, remote.jobId), settled(b, local.jobId)]);
    expect(r).toMatchObject({ state: 'completed', providerId: `node:${node.nodeId}` });
    expect(l).toMatchObject({ state: 'completed', providerId: 'local' });
    expect(r.inputHash).not.toBe(l.inputHash);
    expect(r.result!.documentId).not.toBe(l.result!.documentId);
  });

  it('j. 令牌只在 nodes.json 与 Authorization 头里：日志、任务账本、jobs 事件、网关结果里都没有', async () => {
    const a = await startNode();
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    await pair(b, a, proxy);
    const token = await storedToken(b);
    const secret = token.slice(token.indexOf('.') + 1);
    expect(secret.length).toBeGreaterThan(20);

    const ok = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    expect(await settled(b, ok.jobId)).toMatchObject({ state: 'completed' });
    const listed = await b.client.request('nodes.list', {});
    await a.client.request('nodes.share.revoke', { clientId: b.runtime.initiator.clientId });
    const bad = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio', hint: 'x' });
    expect(await settled(b, bad.jobId)).toMatchObject({ state: 'failed', error: { code: 'REMOTE_NODE_REJECTED' } });
    proxy.down();
    const lost = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio', hint: 'y' });
    expect(await settled(b, lost.jobId)).toMatchObject({ state: 'failed', error: { code: 'REMOTE_NODE_LOST' } });
    const records: JobRecord[] = (await b.client.request('jobs.list', {})).jobs;

    // 让日志落盘。
    await b.runtime.close();
    await a.runtime.close();
    const haystacks = {
      bLog: await fs.readFile(path.join(b.home.logsDir, 'runtime.log'), 'utf8'),
      aLog: await fs.readFile(path.join(a.home.logsDir, 'runtime.log'), 'utf8'),
      bLedger: await fs.readFile(b.home.jobsFile, 'utf8'),
      aLedger: await fs.readFile(a.home.jobsFile, 'utf8'),
      events: JSON.stringify(b.events),
      records: JSON.stringify(records),
      listed: JSON.stringify(listed),
    };
    for (const [name, text] of Object.entries(haystacks)) {
      expect(text.length, name).toBeGreaterThan(0);
      expect(text.includes(secret), name).toBe(false);
    }
    expect(haystacks.bLog).toContain('Remote job completed');
  });

  it('k. A 关闭了转写的共享：B 的转写 REMOTE_NODE_REJECTED / capability-disabled，说明带补救，A 上不建任务；打开后照常完成', async () => {
    const a = await startNode();
    const b = await startInitiator();
    const proxy = await proxyTo(a);
    const node = await pair(b, a, proxy);
    const off = await a.client.request('nodes.share.setCapability', { capability: 'transcribe', enabled: false });
    expect(off.capabilities).toEqual({ transcribe: { enabled: false } });

    expect((await b.client.request('nodes.list', {})).nodes[0]).toMatchObject({
      problem: null,
      health: { capabilities: { transcribe: { enabled: false } } },
    });
    const { jobId } = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio' });
    const failed = await settled(b, jobId);
    expect(failed).toMatchObject({
      state: 'failed',
      attempt: 1,
      error: { code: 'REMOTE_NODE_REJECTED', details: { reason: 'capability-disabled', node: node.nodeId, capability: 'transcribe' } },
    });
    expect(failed.error!.message).toContain('Studio');
    expect(failed.error!.message).toContain('baocut share capability transcribe on');
    expect((await a.client.request('jobs.list', {})).jobs).toEqual([]);
    expect(proxy.requests.some((line) => line.startsWith('POST /v1/jobs'))).toBe(false);

    await a.client.request('nodes.share.setCapability', { capability: 'transcribe', enabled: true });
    const again = await b.client.request('models.transcribe', { videoId: b.videoId, assetId: b.assetId, node: 'Studio', hint: 'again' });
    expect(await settled(b, again.jobId)).toMatchObject({ state: 'completed', providerId: `node:${node.nodeId}` });
  });
});
