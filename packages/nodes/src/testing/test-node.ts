import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FAKE_MODEL_WORKER, JobManager, LocalTranscribeProvider, type JobVideos } from '@baocut/jobs';
import { LocalProviderSource, MANIFEST_FILE, ModelCatalog, ModelServiceStore, ModelServices, type BundleDefinition } from '@baocut/models';
import {
  NODE_PROTOCOL_HEADER,
  NODE_PROTOCOL_VERSION,
  RpcError,
  type NodeJob,
  type NodeJobEvent,
  type NodeJobRequest,
  type ShareStartParams,
  type ShareStatus,
} from '@baocut/protocol';
import { FileCredentialStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import type { AdvertiseInfo, Advertiser } from '../advertiser.ts';
import type { NodeLimits } from '../node-jobs.ts';
import { NodeService, type NodeServiceOptions } from '../node-service.ts';
import type { Clock, PairingLimits } from '../pairing.ts';

/**
 * 测试工具：在临时目录里起一个只听回环地址的节点，背后是真的 JobManager 与假的 Model Worker。
 * 节点端与发起端的测试都用它；不碰真实的 mDNS，端口由系统分配。
 */

const COMPONENTS: BundleDefinition['components'] = {
  asr: { family: 'qwen3-asr', repo: 'test/asr', revision: 'r-asr' },
  vad: { family: 'silero-vad', repo: 'test/vad', revision: 'r-vad' },
};

/** 假 Model Worker 认得的故障后缀（见 `@baocut/jobs` 的 `testing/fake-model-worker.ts`）。 */
export const TEST_NODE_FAULTS = [
  '',
  '#crash-once',
  '#crash-on-run',
  '#hang-on-cancel,slow',
  '#slow',
  '#slow-load',
  '#invalid-output',
  '#no-speech',
] as const;

/** 默认可用的模型包。 */
export const TEST_NODE_BUNDLE = 'fake@cpu';
/** 仓库没有安装的模型包：`models.status` 为 `not-installed`。 */
export const TEST_NODE_MISSING_BUNDLE = 'fake@cpu#missing';

export const TEST_NODE_BUNDLES: BundleDefinition[] = [
  ...TEST_NODE_FAULTS.map((suffix): BundleDefinition => ({
    bundleId: `${TEST_NODE_BUNDLE}${suffix}`,
    capability: 'transcribe',
    backend: 'candle',
    device: 'cpu',
    label: 'Fake',
    components: COMPONENTS,
  })),
  {
    bundleId: TEST_NODE_MISSING_BUNDLE,
    capability: 'transcribe',
    backend: 'candle',
    device: 'cpu',
    label: 'Fake (missing)',
    components: { asr: { family: 'qwen3-asr', repo: 'test/missing', revision: 'r-missing' } },
  },
];

/** 给合成模型包的仓库写清单与小文件。 */
export async function installTestModels(modelsDir: string): Promise<void> {
  for (const [repo, revision] of [
    ['test/asr', 'r-asr'],
    ['test/vad', 'r-vad'],
  ] as const) {
    const dir = path.join(modelsDir, ...repo.split('/'));
    await fs.mkdir(dir, { recursive: true });
    const content = `weights of ${repo}`;
    await fs.writeFile(path.join(dir, 'model.safetensors'), content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    await fs.writeFile(
      path.join(dir, MANIFEST_FILE),
      JSON.stringify({ format_version: 1, repo, revision, files: [{ path: 'model.safetensors', size: content.length, sha256 }] }),
    );
  }
}

/** 记下登记与撤销，不碰真实的 mDNS。 */
export class FakeAdvertiser implements Advertiser {
  readonly started: AdvertiseInfo[] = [];
  stops = 0;
  active: AdvertiseInfo | null = null;

  start(info: AdvertiseInfo): void {
    this.started.push(info);
    this.active = info;
  }

  async stop(): Promise<void> {
    this.stops++;
    this.active = null;
  }
}

/** 手动拨动的时钟（配对码期限与锁定）。 */
export class ManualClock implements Clock {
  #now: number;

  constructor(start = Date.parse('2026-01-01T00:00:00Z')) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

/** 没有打开任何视频：节点的任务不该碰视频，碰了就抛错。 */
export const noVideos: JobVideos = {
  retain() {
    throw new Error('节点任务不应该租用视频');
  },
  release() {
    throw new Error('节点任务不应该租用视频');
  },
  async source() {
    throw new RpcError('not-found', '视频没有打开');
  },
  current() {
    return null;
  },
  videoRevision() {
    return null;
  },
  async apply() {
    throw new Error('节点任务不应该修改视频');
  },
};

/** `ShareStatus.pairing` 里的配对码；没有（或已锁定）时为 null。 */
export function pairingCodeOf(status: ShareStatus): string | null {
  const pairing = status.pairing;
  return pairing && 'code' in pairing ? pairing.code : null;
}

export interface TestNodeOptions {
  /** 换掉默认的空视频（共享队列的测试要一个本地视频任务）。 */
  videos?: JobVideos;
  clock?: Clock;
  limits?: Partial<NodeLimits>;
  pairing?: Partial<PairingLimits>;
  freeBytes?: (dir: string) => Promise<number>;
  /** 开启共享之后经 `setCapability` 设的能力开关（与网关同一条路）。 */
  capabilities?: Record<string, boolean>;
  /** 支持共享的模型能力（模拟将来新加的能力）。 */
  shareableCapabilities?: readonly string[];
  heartbeatMs?: number;
  /** 传给 `nodes.share.start`；默认 `{ port: 0 }`。null 表示不开启共享。 */
  share?: ShareStartParams | null;
  /** 复用已有的临时目录（重启测试）。 */
  dir?: string;
}

export interface TestNode {
  dir: string;
  home: RuntimeHome;
  service: NodeService;
  manager: JobManager;
  catalog: ModelCatalog;
  provider: LocalTranscribeProvider;
  advertiser: FakeAdvertiser;
  /** `http://127.0.0.1:<port>`（跟随当前监听的端口）。 */
  readonly baseUrl: string;
  /** 用当前配对码（没有就新发一个）配对，返回令牌。 */
  pair(clientId?: string, clientName?: string): Promise<string>;
  /** 停服务与 JobManager；`keepDir` 为真时留下临时目录。 */
  close(options?: { keepDir?: boolean }): Promise<void>;
}

/** 起一个只听 127.0.0.1 的测试节点，默认已开启共享（端口由系统分配）。 */
export async function startTestNode(options: TestNodeOptions = {}): Promise<TestNode> {
  const dir = options.dir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-node-')));
  const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  await installTestModels(home.modelsDir);
  const catalog = new ModelCatalog({ root: home.modelsDir, bundles: TEST_NODE_BUNDLES });
  const provider = new LocalTranscribeProvider({
    catalog,
    command: () => ({ command: process.execPath, args: [FAKE_MODEL_WORKER] }),
    env: async () => process.env,
    idleMs: 60_000,
    cancelGraceMs: 5_000,
  });
  const manager = new JobManager({
    paths: {
      jobsFile: home.jobsFile,
      stagingDir: home.stagingDir,
      artifactsDir: home.artifactsDir,
      diagnosticsDir: path.join(home.logsDir, 'diagnostics'),
    },
    catalog,
    router: new ModelServices({
      store: await ModelServiceStore.open(home, new FileCredentialStore(home.modelCredentialsFile)),
      sources: [new LocalProviderSource({ catalog, transcriber: provider })],
    }),
    videos: options.videos ?? noVideos,
  });
  await manager.open();
  const advertiser = new FakeAdvertiser();
  const serviceOptions: NodeServiceOptions = {
    shareFile: home.nodeShareFile,
    jobsDir: home.nodeJobsDir,
    runner: manager,
    models: catalog,
    host: '127.0.0.1',
    advertiser,
    hostname: () => 'test-node',
    // 只在监听所有接口时用到；测试节点只听 127.0.0.1，status 里应该只看到它，看不到这个文档用的地址。
    addresses: () => ['192.0.2.1'],
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.pairing ? { pairing: options.pairing } : {}),
    ...(options.freeBytes ? { freeBytes: options.freeBytes } : {}),
    ...(options.shareableCapabilities ? { shareableCapabilities: options.shareableCapabilities } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  };
  const service = await NodeService.open(serviceOptions);
  if (options.share !== null) await service.start(options.share ?? { port: 0 });
  for (const [capability, enabled] of Object.entries(options.capabilities ?? {})) await service.setCapability(capability, enabled);
  const baseUrl = () => `http://127.0.0.1:${service.port}`;

  return {
    dir,
    home,
    service,
    manager,
    catalog,
    provider,
    advertiser,
    get baseUrl() {
      return baseUrl();
    },
    async pair(clientId = 'client-a', clientName = 'Test Client') {
      const code = pairingCodeOf(service.status()) ?? pairingCodeOf(service.pairingCode());
      if (!code) throw new Error('没有可用的配对码');
      const response = await fetch(`${baseUrl()}/v1/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [NODE_PROTOCOL_HEADER]: String(NODE_PROTOCOL_VERSION) },
        body: JSON.stringify({ code, clientId, clientName }),
      });
      if (!response.ok) throw new Error(`配对失败：${response.status} ${await response.text()}`);
      return ((await response.json()) as { token: string }).token;
    },
    async close({ keepDir = false } = {}) {
      await service.close();
      await manager.shutdown();
      if (!keepDir) await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/** 带协议版本头与令牌的 fetch。 */
export function nodeFetch(baseUrl: string, token: string | null, pathname: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has(NODE_PROTOCOL_HEADER)) headers.set(NODE_PROTOCOL_HEADER, String(NODE_PROTOCOL_VERSION));
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${pathname}`, { ...init, headers });
}

/** 一份合规的创建请求，摘要与长度按 `media` 算。 */
export function testJobRequest(media: Buffer, overrides: Partial<NodeJobRequest> = {}): NodeJobRequest {
  return {
    clientJobId: overrides.clientJobId ?? `cj_${crypto.randomUUID()}`,
    kind: 'transcribe',
    bundleId: overrides.bundleId ?? TEST_NODE_BUNDLE,
    input: overrides.input ?? {
      contentHash: `sha256:${crypto.createHash('sha256').update(media).digest('hex')}`,
      byteLength: media.length,
      mediaType: 'audio/wav',
      track: 0,
      range: null,
    },
    options: overrides.options ?? { language: { mode: 'prefer', tag: null }, diarize: false, timescale: 1_000_000 },
  };
}

/** 读完一条 NDJSON 事件流（节点在终态后关闭它），去掉心跳。 */
export async function readEvents(response: Response): Promise<Exclude<NodeJobEvent, { type: 'heartbeat' }>[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as NodeJobEvent)
    .filter((event): event is Exclude<NodeJobEvent, { type: 'heartbeat' }> => event.type !== 'heartbeat');
}

/** 创建任务并上传媒体，返回创建时的任务与请求。 */
export async function submitTestJob(
  baseUrl: string,
  token: string,
  media: Buffer,
  overrides: Partial<NodeJobRequest> = {},
): Promise<{ job: NodeJob; request: NodeJobRequest }> {
  const request = testJobRequest(media, overrides);
  const created = await nodeFetch(baseUrl, token, '/v1/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!created.ok) throw new Error(`创建失败：${created.status} ${await created.text()}`);
  const job = (await created.json()) as NodeJob;
  const uploaded = await nodeFetch(baseUrl, token, `/v1/jobs/${job.jobId}/input`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(media),
  });
  if (!uploaded.ok) throw new Error(`上传失败：${uploaded.status} ${await uploaded.text()}`);
  await uploaded.arrayBuffer();
  return { job, request };
}

export { startTcpProxy, type TcpProxy } from './tcp-proxy.ts';
