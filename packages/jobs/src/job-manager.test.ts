import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type EditOperation, type JobRecord, type JobState } from '@baocut/protocol';
import { FileCredentialStore } from '@baocut/runtime-storage';
import {
  DEFAULT_TRANSCRIBE_BUNDLE,
  LocalProviderSource,
  MANIFEST_FILE,
  ModelCatalog,
  ModelServiceStore,
  ModelServices,
  ProviderFailure,
  type BundleDefinition,
  type ProviderSource,
  type TranscribeAttempt,
  type TranscribeProvider,
  type TranscribeRun,
  type TranscribeSink,
} from '@baocut/models';
import { JobLedger } from './job-ledger.ts';
import { JobManager, type FileJobOutput, type FileTranscribeRequest, type JobVideos } from './job-manager.ts';
import { LocalTranscribeProvider } from './local-provider.ts';
import { FAKE_MODEL_WORKER } from './index.ts';

/**
 * JobManager 与本地 Provider，对着假的 Model Worker（`testing/fake-model-worker.ts`）跑。
 * 故障由模型包 ID 的 `#` 后缀注入；模型目录是合成的小文件与清单。
 */

const COMPONENTS: BundleDefinition['components'] = {
  asr: { family: 'qwen3-asr', repo: 'test/asr', revision: 'r-asr' },
  vad: { family: 'silero-vad', repo: 'test/vad', revision: 'r-vad' },
};
const FAULTS = [
  '',
  '#crash-once',
  '#crash-on-run',
  '#hang-on-cancel,slow',
  '#slow',
  '#slow-load',
  '#invalid-output',
  '#load-fail:MODEL_NOT_INSTALLED',
  '#no-speech',
];
/** 「说话人区分」模型包：装上之后假模型包的 Worker 带上它的组件，假 Worker 据此给段与词标说话人。 */
const FAKE_DIARIZATION: BundleDefinition = {
  bundleId: 'fake-diarization@cpu',
  capability: 'diarize',
  backend: 'candle',
  device: 'cpu',
  label: 'Fake Diarization',
  components: {
    segmentation: { family: 'pyannote-segmentation', repo: 'test/segmentation', revision: 'r-seg' },
    speaker: { family: 'wespeaker', repo: 'test/speaker', revision: 'r-spk' },
  },
};
const BUNDLES: BundleDefinition[] = [
  ...FAULTS.map((suffix): BundleDefinition => ({
    bundleId: `fake@cpu${suffix}`,
    capability: 'transcribe',
    backend: 'candle',
    device: 'cpu',
    label: 'Fake',
    components: COMPONENTS,
    diarization: FAKE_DIARIZATION.bundleId,
  })),
  FAKE_DIARIZATION,
];

async function writeRepo(root: string, repo: string, revision: string): Promise<void> {
  const dir = path.join(root, ...repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const content = `weights of ${repo}`;
  await fs.writeFile(path.join(dir, 'model.safetensors'), content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo, revision, files: [{ path: 'model.safetensors', size: content.length, sha256 }] }),
  );
}

/** 内存里的视频：一个素材，记下租约与提交的编辑。 */
class FakeVideos implements JobVideos {
  leases = 0;
  revision = 7;
  contentHash = 'sha256:' + 'a'.repeat(64);
  applied: Array<{ commandId: string; expectedRevision: string; operations: EditOperation[] }> = [];
  file: string;

  constructor(file: string) {
    this.file = file;
  }

  retain(): void {
    this.leases++;
  }

  release(): void {
    this.leases--;
  }

  async source(videoId: string, assetId: string) {
    if (videoId !== 'mov_1') throw new RpcError('not-found', '视频没有打开');
    if (assetId !== 'ast_1') throw new RpcError('not-found', '素材不存在');
    return { file: this.file, revision: '1', contentHash: this.contentHash, mediaType: 'audio/wav' };
  }

  current() {
    return { videoRevision: String(this.revision), asset: { revision: '1', contentHash: this.contentHash } };
  }

  videoRevision(videoId: string) {
    return videoId === 'mov_1' ? String(this.revision) : null;
  }

  async apply(_videoId: string, request: { commandId: string; expectedRevision: string; operations: EditOperation[] }) {
    this.applied.push(request);
    this.revision++;
    return { refs: { speech: 'doc_speech' } };
  }
}

/**
 * 假的远端节点 Provider（id `node`）：记下每次尝试，按 `next` 的脚本执行。完成时借本地 Provider 在 staging 里产出真实的
 * 结果（`runGeneration` 可以换成节点自己的尝试序号），用来检查 JobManager 的路由、队列与失败归一化。
 */
class FakeNodeProvider implements TranscribeProvider {
  readonly id = 'node';
  readonly runs: TranscribeRun[] = [];
  next: (run: TranscribeRun, sink: TranscribeSink, signal: AbortSignal) => Promise<TranscribeAttempt>;

  constructor(local: () => LocalTranscribeProvider) {
    this.next = (run, sink, signal) => local().transcribe({ ...run, bundleId: 'fake@cpu' }, sink, signal);
  }

  transcribe(run: TranscribeRun, sink: TranscribeSink, signal: AbortSignal): Promise<TranscribeAttempt> {
    this.runs.push(run);
    return this.next(run, sink, signal);
  }

  async close(): Promise<void> {}
}

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 测试用的节点来源：`resolveNode` 认得的节点都在线，接受任何模型包。 */
function fakeNodeSource(remote: TranscribeProvider, resolveNode: (node: string) => string | null): ProviderSource {
  const resolve = (providerId: string) => {
    const nodeId = providerId.startsWith('node:') ? resolveNode(providerId.slice('node:'.length)) : null;
    return nodeId ? `node:${nodeId}` : null;
  };
  const view = (providerId: string) => ({
    providerId,
    kind: 'node' as const,
    label: providerId,
    config: null,
    capabilities: {
      transcribe: {
        models: [
          {
            modelId: DEFAULT_TRANSCRIBE_BUNDLE,
            label: DEFAULT_TRANSCRIBE_BUNDLE,
            default: true,
            maxInputBytes: null,
            maxDurationSec: null,
            wordTimestamps: 'native' as const,
            languages: 'any' as const,
            acceptsHint: true,
            cost: 'free-local' as const,
          },
        ],
        available: true,
      },
    },
  });
  return {
    kind: 'node',
    owns: (providerId) => providerId.startsWith('node:'),
    resolve,
    list: async () => [view('node:node_a')],
    describe: async (providerId) => (resolve(providerId) ? view(resolve(providerId)!) : null),
    transcriber: () => remote,
    queue: (providerId) => ({ key: providerId, concurrency: 1 }),
    executors: () => [remote],
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('JobManager（假 Model Worker）', () => {
  let dir: string;
  let paths: { jobsFile: string; stagingDir: string; artifactsDir: string; diagnosticsDir: string };
  let catalog: ModelCatalog;
  let videos: FakeVideos;
  let provider: LocalTranscribeProvider;
  let manager: JobManager;
  let events: JobRecord[];

  async function start(
    options: {
      idleMs?: number;
      crashLimit?: number;
      crashWindowMs?: number;
      remote?: TranscribeProvider;
      resolveNode?: (node: string) => string | null;
      /** 假 Worker 的控制文件内容（`capabilities`、`transcribeFamilies` 等）。 */
      control?: object;
    } = {},
  ) {
    catalog = new ModelCatalog({ root: path.join(dir, 'models'), bundles: BUNDLES });
    const controlArgs: string[] = [];
    if (options.control) {
      const controlFile = path.join(dir, 'control.json');
      await fs.writeFile(controlFile, JSON.stringify(options.control));
      controlArgs.push('--control', controlFile);
    }
    provider = new LocalTranscribeProvider({
      catalog,
      command: () => ({ command: process.execPath, args: [FAKE_MODEL_WORKER, ...controlArgs] }),
      env: async () => process.env,
      idleMs: options.idleMs ?? 60_000,
      // 不给时用 Provider 的默认值（5 分钟内 3 次）。
      ...(options.crashLimit !== undefined ? { crashLimit: options.crashLimit } : {}),
      ...(options.crashWindowMs !== undefined ? { crashWindowMs: options.crashWindowMs } : {}),
      cancelGraceMs: 5_000,
    });
    const store = await ModelServiceStore.open(
      { modelServicesFile: path.join(dir, 'store', 'model-services.json') },
      new FileCredentialStore(path.join(dir, 'store', 'model-credentials.json')),
    );
    const sources: ProviderSource[] = [new LocalProviderSource({ catalog, transcriber: provider })];
    if (options.remote) sources.push(fakeNodeSource(options.remote, options.resolveNode ?? (() => null)));
    manager = new JobManager({ paths, catalog, router: new ModelServices({ store, sources }), videos });
    await manager.open();
    events = [];
    manager.onChange((job) => events.push(job));
  }

  const submit = (bundleId = 'fake@cpu', extra: object = {}) =>
    manager.submitTranscribe({ videoId: 'mov_1', assetId: 'ast_1', bundleId, ...extra }, { kind: 'connection', id: 'conn_1' });

  async function run(bundleId = 'fake@cpu'): Promise<JobRecord> {
    const { jobId } = await submit(bundleId);
    await manager.settled(jobId);
    return manager.inspect(jobId);
  }

  const stagingOf = (jobId: string) => path.join(paths.stagingDir, 'jobs', jobId);
  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false,
    );

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-jobs-'));
    paths = {
      jobsFile: path.join(dir, 'store', 'jobs.jsonl'),
      stagingDir: path.join(dir, 'staging'),
      artifactsDir: path.join(dir, 'artifacts'),
      diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
    };
    await writeRepo(path.join(dir, 'models'), 'test/asr', 'r-asr');
    await writeRepo(path.join(dir, 'models'), 'test/vad', 'r-vad');
    const audio = path.join(dir, 'audio.wav');
    await fs.writeFile(audio, 'not really audio');
    videos = new FakeVideos(audio);
  });

  afterEach(async () => {
    await manager?.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('完成：写出 speech 文档、发布原始结果、删除 staging，主题事件有序', async () => {
    await start();
    const job = await run();
    expect(job).toMatchObject({
      state: 'completed',
      phase: 'done',
      attempt: 1,
      error: null,
      kind: 'transcribe',
      providerId: 'local',
      bundleId: 'fake@cpu',
      assetRevision: '1',
      contentHash: videos.contentHash,
      submitter: { kind: 'connection', id: 'conn_1' },
      result: { documentId: 'doc_speech', artifactId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
      warnings: [],
    });
    expect(job.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // 应用：一个 putDocument，以当时的视频版本为准。
    expect(videos.applied).toHaveLength(1);
    expect(videos.applied[0]!.expectedRevision).toBe('7');
    const op = videos.applied[0]!.operations[0] as Extract<EditOperation, { type: 'putDocument' }>;
    const body = op.body as { words: Array<{ id: string; start: number; end: number; text: string }> } & Record<string, unknown>;
    expect(op).toMatchObject({
      type: 'putDocument',
      ref: 'speech',
      kind: 'speech',
      name: '转写',
      language: 'en',
      sourceAsset: { assetId: 'ast_1' },
    });
    expect(body).toMatchObject({
      schema: 'baocut.speech/1',
      clock: 'source-asset',
      timescale: 1_000_000,
      engine: {
        provider: 'local',
        bundleId: 'fake@cpu',
        models: { asr: { family: 'qwen3-asr', revision: 'r-asr' }, vad: { family: 'silero-vad', revision: 'r-vad' } },
        backend: 'candle',
        device: 'cpu',
        workerVersion: '0.0.0-fake',
      },
      speakers: [],
      sentences: null,
      chapters: [],
    });
    expect(typeof body.createdAt).toBe('string');
    expect(body.words.map((w) => w.text).join(' ')).toBe('testing one two three baocut is ready');
    expect(body.words[0]).toEqual({ id: 'w-000001', start: 0, end: 400_000, text: 'testing', timingQuality: 'estimated' });
    expect(body.words[6]!.id).toBe('w-000007');
    expect(op.summary).toEqual({ wordCount: 7, speakerCount: 0, sentenceCount: null, chapterCount: 0, language: 'en' });
    expect(op.extensions).toMatchObject({
      rawResultArtifactId: job.result!.artifactId,
      asrOutcome: 'transcribed',
      language: { tag: 'en', source: 'detected', confidence: 0.87 },
      warnings: [],
      inputHash: job.inputHash,
    });

    // 产物与 staging
    const artifact = path.join(paths.artifactsDir, `${job.result!.artifactId.slice('sha256:'.length)}.json`);
    expect(JSON.parse(await fs.readFile(artifact, 'utf8'))).toMatchObject({ schema: 'baocut.asr-result/v1', outcome: 'transcribed' });
    expect(await exists(stagingOf(job.jobId))).toBe(false);
    expect(videos.leases).toBe(0);

    // 主题事件：排队 → 运行（加载、识别、校验、发布、应用）→ 完成
    const states = events.map((e) => e.state).filter((s, i, all) => s !== all[i - 1]);
    expect(states).toEqual(['queued', 'running', 'completed']);
    const phases = events.map((e) => e.phase).filter((p, i, all) => p !== all[i - 1]);
    expect(phases).toEqual(
      expect.arrayContaining(['queued', 'starting', 'loading', 'transcribing', 'validating', 'publishing', 'applying', 'done']),
    );
    expect(phases.indexOf('transcribing')).toBeLessThan(phases.indexOf('applying'));
    expect(events.some((e) => e.progress?.unit === 'segments' && e.progress.total === 3)).toBe(true);

    // 账本
    const ledger = { jobs: await new JobLedger(paths.jobsFile).load() };
    expect(ledger.jobs[0]!.record).toMatchObject({ jobId: job.jobId, state: 'completed' });
    expect(manager.list('mov_1').map((j) => j.jobId)).toEqual([job.jobId]);
    expect(manager.list('other')).toEqual([]);
  });

  it('说话人区分：不给 diarize 时按模型，装了「说话人区分」模型包就区分，说话人进 speech 文档；显式关掉不区分', async () => {
    await start();
    // 每个任务都等它结束再提交下一个：最后应用的就是它的 speech 文档。
    const lastSpeech = () => {
      const op = videos.applied.at(-1)!.operations[0];
      return (op as Extract<EditOperation, { type: 'putDocument' }>).body as {
        speakers: Array<{ id: string; name: string }>;
        words: Array<{ text: string; speaker?: string }>;
      };
    };
    // 没装：不区分，也不报警告；显式要区分时报 diarization-unavailable。
    const plain = await run();
    expect(plain.warnings).toEqual([]);
    expect(lastSpeech().speakers).toEqual([]);
    // 记录上写着定下的语言请求与生效的说话人区分（视频卡的模型一行读它）。
    expect(plain.transcribe).toEqual({ language: { mode: 'prefer', tag: null }, diarize: false });
    const { jobId: wanted } = await submit('fake@cpu', { diarize: true });
    await manager.settled(wanted);
    expect(manager.inspect(wanted).warnings).toEqual([{ code: 'diarization-unavailable' }]);
    expect(manager.inspect(wanted).transcribe?.diarize).toBe(true);

    await writeRepo(path.join(dir, 'models'), 'test/segmentation', 'r-seg');
    await writeRepo(path.join(dir, 'models'), 'test/speaker', 'r-spk');
    await provider.unload('fake@cpu');
    const { jobId } = await submit('fake@cpu', { hint: 'with speakers' });
    await manager.settled(jobId);
    const job = manager.inspect(jobId);
    expect(job).toMatchObject({ state: 'completed', warnings: [], transcribe: { diarize: true } });
    const body = lastSpeech();
    expect(body.speakers).toEqual([
      { id: 'spk-1', name: '说话人 1' },
      { id: 'spk-2', name: '说话人 2' },
    ]);
    expect(body.words.map((w) => w.speaker)).toEqual(['spk-1', 'spk-1', 'spk-1', 'spk-2', 'spk-2', 'spk-2', 'spk-1']);

    const { jobId: off } = await submit('fake@cpu', { hint: 'without speakers', diarize: false });
    await manager.settled(off);
    expect(manager.inspect(off).warnings).toEqual([]);
    expect(manager.inspect(off).transcribe?.diarize).toBe(false);
    expect(lastSpeech().speakers).toEqual([]);
  });

  it('相同输入的在途任务去重；commandId 去重；输入不同就是新任务', async () => {
    await start();
    const first = await submit('fake@cpu#slow');
    expect(await submit('fake@cpu#slow')).toEqual(first);
    const other = await submit('fake@cpu#slow', { language: { mode: 'assert', tag: 'zh-cn' } });
    expect(other.jobId).not.toBe(first.jobId);
    const byCommand = await submit('fake@cpu', { commandId: 'cmd_x' });
    expect(await submit('fake@cpu', { commandId: 'cmd_x', hint: 'different' })).toEqual(byCommand);
    expect(manager.inspect(other.jobId).state).toBe('queued');
    for (const jobId of [first.jobId, other.jobId, byCommand.jobId]) await manager.cancel(jobId);
    expect(videos.leases).toBe(0);
  });

  it('提交时的校验：不认识的模型包、不可用的模型包、非法的语言标签', async () => {
    await start();
    await expect(submit('nope')).rejects.toMatchObject({ code: 'not-found' });
    await expect(submit('fake@cpu', { language: { mode: 'assert', tag: '???' } })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(
      manager.submitTranscribe({ videoId: 'mov_2', assetId: 'ast_1', bundleId: 'fake@cpu' }, { kind: 'system', id: 'rt' }),
    ).rejects.toMatchObject({
      code: 'not-found',
    });
    await fs.rm(path.join(dir, 'models', 'test', 'vad'), { recursive: true });
    const error = await submit().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    // 显式指定的本机模型包没有装好：在提交时以 `CAPABILITY_NOT_CONFIGURED` 拒绝，不创建任务（§6.2）。
    expect(error).toMatchObject({
      code: 'conflict',
      details: { code: 'CAPABILITY_NOT_CONFIGURED', reason: 'not-installed', providerId: 'local', remedy: { action: 'install-model' } },
    });
    expect(manager.list()).toEqual([]);
  });

  it('取消：Worker 在分段边界停下并确认，进程与模型留着，下一个任务直接用', async () => {
    await start();
    const { jobId } = await submit('fake@cpu#slow');
    await until(() => manager.inspect(jobId).progress);
    const pid = provider.workerPid('fake@cpu#slow')!;
    const started = Date.now();
    expect(await manager.cancel(jobId)).toEqual({ state: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(manager.inspect(jobId)).toMatchObject({ state: 'cancelled', result: null, error: null });
    expect(await exists(stagingOf(jobId))).toBe(false);
    expect(alive(pid)).toBe(true);
    expect((await catalog.status('fake@cpu#slow'))!.state).toBe('ready');
    expect(videos.leases).toBe(0);
    expect(await manager.cancel(jobId)).toEqual({ state: 'cancelled' });
  });

  it('取消：Worker 确认后不停，期限到了结束进程；下一个任务按需起新进程', async () => {
    await start();
    const bundle = 'fake@cpu#hang-on-cancel,slow';
    const { jobId } = await submit(bundle);
    await until(() => manager.inspect(jobId).progress);
    const pid = provider.workerPid(bundle)!;
    const started = Date.now();
    expect(await manager.cancel(jobId)).toEqual({ state: 'cancelled' });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThan(4_500);
    expect(elapsed).toBeLessThan(6_500);
    await until(() => !alive(pid));
    expect(provider.workerPid(bundle)).toBeNull();
    expect((await catalog.status(bundle))!.state).toBe('installed');
    const next = await run(bundle);
    expect(next.state).toBe('completed');
    expect(provider.workerPid(bundle)).not.toBe(pid);
  }, 30_000);

  it('取消发生在加载模型时：任务立即取消，加载在后台完成', async () => {
    await start();
    const { jobId } = await submit('fake@cpu#slow-load');
    await until(() => manager.inspect(jobId).phase === 'loading');
    const started = Date.now();
    expect(await manager.cancel(jobId)).toEqual({ state: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(500);
    await until(async () => (await catalog.status('fake@cpu#slow-load'))!.state === 'ready');
    expect(provider.workerPid('fake@cpu#slow-load')).not.toBeNull();
  });

  it('崩溃一次：标为中断，自动重试，以 attempt 2 完成', async () => {
    await start();
    const job = await run('fake@cpu#crash-once');
    expect(job).toMatchObject({ state: 'completed', attempt: 2, error: null, result: { documentId: 'doc_speech' } });
    const states = events.map((e) => e.state).filter((s, i, all) => s !== all[i - 1]);
    expect(states).toEqual(['queued', 'running', 'interrupted', 'running', 'completed']);
    const interrupted = events.find((e) => e.state === 'interrupted')!;
    expect(interrupted).toMatchObject({ attempt: 1, error: { code: 'MODEL_WORKER_CRASHED' } });
  });

  it('反复崩溃：两次尝试后 MODEL_WORKER_CRASHED；默认 5 分钟内第 3 次崩溃停用模型包，enable 恢复', async () => {
    // 默认的上限与窗口：计的是崩溃次数，不是任务数——第一个任务自动重试一次，占两次。
    await start();
    const first = await run('fake@cpu#crash-on-run');
    expect(first).toMatchObject({ state: 'failed', attempt: 2, error: { code: 'MODEL_WORKER_CRASHED' } });
    const details = first.error!.details as { stderrTail: string; exitCode: number };
    expect(details.stderrTail).toContain('模拟崩溃');
    expect(details.exitCode).toBe(70);
    expect(await exists(stagingOf(first.jobId))).toBe(false);

    // 第三次崩溃让模型包停用：这个任务不再重试。
    const second = await run('fake@cpu#crash-on-run');
    expect(second).toMatchObject({ state: 'failed', attempt: 1, error: { code: 'MODEL_WORKER_CRASHED' } });
    expect(await catalog.status('fake@cpu#crash-on-run')).toMatchObject({ state: 'error', reason: 'resource' });
    await expect(submit('fake@cpu#crash-on-run')).rejects.toMatchObject({ code: 'conflict' });

    manager.enable('fake@cpu#crash-on-run');
    expect(await catalog.status('fake@cpu#crash-on-run')).toMatchObject({ state: 'installed' });
    const third = await run('fake@cpu#crash-on-run');
    expect(third.attempt).toBe(2);
  });

  it('崩溃窗口：窗口之外的崩溃不累计，模型包不停用', async () => {
    await start({ crashWindowMs: 1_000 });
    const first = await run('fake@cpu#crash-on-run');
    expect(first).toMatchObject({ state: 'failed', attempt: 2, error: { code: 'MODEL_WORKER_CRASHED' } });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    // 窗口里只剩这个任务的两次崩溃：还会自动重试，模型包仍然可用。
    const second = await run('fake@cpu#crash-on-run');
    expect(second).toMatchObject({ state: 'failed', attempt: 2, error: { code: 'MODEL_WORKER_CRASHED' } });
    expect(await catalog.status('fake@cpu#crash-on-run')).toMatchObject({ state: 'installed' });
    expect((await submit('fake@cpu#crash-on-run')).jobId).toMatch(/^job_/);
  });

  it('输出不合合同：MODEL_OUTPUT_INVALID，不重试，原始结果留在诊断目录', async () => {
    await start();
    const job = await run('fake@cpu#invalid-output');
    expect(job).toMatchObject({ state: 'failed', attempt: 1, error: { code: 'MODEL_OUTPUT_INVALID' }, result: null });
    expect((job.error!.details as { problems: string[] }).problems).toContain('segments[1] 与前一段重叠或没有按 start 递增');
    const kept = path.join(paths.diagnosticsDir, job.jobId, 'result.json');
    expect(JSON.parse(await fs.readFile(kept, 'utf8'))).toMatchObject({ schema: 'baocut.asr-result/v1' });
    expect(await exists(path.join(paths.diagnosticsDir, job.jobId, 'job.json'))).toBe(true);
    expect(await exists(stagingOf(job.jobId))).toBe(false);
    expect(videos.applied).toEqual([]);
  });

  it('加载失败：MODEL_LOAD_FAILED，不重试，模型包记为未安装', async () => {
    await start();
    const job = await run('fake@cpu#load-fail:MODEL_NOT_INSTALLED');
    expect(job).toMatchObject({
      state: 'failed',
      attempt: 1,
      error: { code: 'MODEL_LOAD_FAILED', details: { reason: 'not-installed', workerCode: 'MODEL_NOT_INSTALLED' } },
    });
    expect(await catalog.status('fake@cpu#load-fail:MODEL_NOT_INSTALLED')).toMatchObject({ state: 'not-installed', reason: 'load-failed' });
    expect(provider.workerPid('fake@cpu#load-fail:MODEL_NOT_INSTALLED')).toBeNull();
  });

  it('Worker 没列出 asr 的 family 或不声明 transcribe：capability-missing，不发 model.load，模型包不停用', async () => {
    for (const control of [{ transcribeFamilies: ['whisper-coreml'] }, { capabilities: ['synthesize'] }]) {
      await manager?.shutdown();
      await start({ control });
      const job = await run();
      expect(job).toMatchObject({
        state: 'failed',
        attempt: 1,
        error: {
          code: 'MODEL_LOAD_FAILED',
          details: expect.objectContaining({ reason: 'unsupported', detail: 'capability-missing', family: 'qwen3-asr' }),
        },
      });
      expect(catalog.blocked('fake@cpu')).toBe(false);
      expect(await catalog.status('fake@cpu')).toMatchObject({ state: 'installed' });
    }
  });

  it('空闲卸载：idleMs 之后 model.unload 并关闭进程', async () => {
    await start({ idleMs: 200 });
    await run();
    const pid = provider.workerPid('fake@cpu')!;
    expect(alive(pid)).toBe(true);
    expect((await catalog.status('fake@cpu'))!.state).toBe('ready');
    await until(() => !alive(pid), 3000);
    expect(provider.workerPid('fake@cpu')).toBeNull();
    await until(async () => (await catalog.status('fake@cpu'))!.state === 'installed');
    // 下一个任务按需再起。
    expect((await run()).state).toBe('completed');
  });

  it('没有语音：完成但不写文档，结果种类记在 warnings', async () => {
    await start();
    const job = await run('fake@cpu#no-speech');
    expect(job).toMatchObject({ state: 'completed', result: { documentId: null }, warnings: [{ code: 'no-speech' }] });
    expect(job.result!.artifactId).toMatch(/^sha256:/);
    expect(videos.applied).toEqual([]);
  });

  it('素材在转写期间换了内容：STALE_JOB_INPUT，保留产物，不写文档', async () => {
    await start();
    const { jobId } = await submit('fake@cpu#slow');
    await until(() => manager.inspect(jobId).progress);
    videos.contentHash = 'sha256:' + 'b'.repeat(64);
    await manager.settled(jobId);
    const job = manager.inspect(jobId);
    expect(job).toMatchObject({ state: 'failed', error: { code: 'STALE_JOB_INPUT' }, result: { documentId: null } });
    expect(await exists(path.join(paths.artifactsDir, `${job.result!.artifactId.slice(7)}.json`))).toBe(true);
    expect(videos.applied).toEqual([]);
  }, 15_000);

  it('启动对账：上次运行中的任务标为中断，不属于在途任务的 staging 目录删除', async () => {
    const record = (jobId: string, state: JobState): JobRecord => ({
      jobId,
      kind: 'transcribe',
      state,
      phase: 'transcribing',
      progress: null,
      videoId: 'mov_1',
      assetId: 'ast_1',
      assetRevision: '1',
      contentHash: 'sha256:x',
      bundleId: 'fake@cpu',
      providerId: 'local',
      modelId: 'fake@cpu',
      inputHash: 'sha256:y',
      submitter: { kind: 'connection', id: 'c' },
      attempt: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
    });
    const spec = {
      contentHash: 'sha256:x',
      track: 0,
      range: null,
      language: { mode: 'prefer', tag: null },
      bundleId: 'fake@cpu',
      diarize: false,
      hint: null,
      outputContract: 'baocut.asr-result/v1',
    };
    // 旧格式的 `jobs.json`：启动时导入成 `jobs.jsonl`，旧文件改名为 `.migrated`。
    const legacy = path.join(path.dirname(paths.jobsFile), 'jobs.json');
    await fs.mkdir(path.dirname(paths.jobsFile), { recursive: true });
    await fs.writeFile(
      legacy,
      JSON.stringify({
        formatVersion: 1,
        jobs: [
          { record: record('job_running', 'running'), spec, workerVersion: null },
          { record: record('job_done', 'completed'), spec, workerVersion: null },
        ],
      }),
    );
    for (const name of ['job_running', 'job_done', 'job_unknown']) {
      await fs.mkdir(stagingOf(name), { recursive: true });
      await fs.writeFile(path.join(stagingOf(name), 'segments.jsonl'), '{}\n');
    }
    await start();
    expect(manager.inspect('job_running')).toMatchObject({ state: 'interrupted', error: { code: 'JOB_INTERRUPTED' } });
    expect(manager.inspect('job_done').state).toBe('completed');
    for (const name of ['job_running', 'job_done', 'job_unknown']) expect(await exists(stagingOf(name))).toBe(false);
    expect(await exists(legacy)).toBe(false);
    expect(await exists(`${legacy}.migrated`)).toBe(true);
    const jobs = await new JobLedger(paths.jobsFile).load();
    expect(jobs.map((j) => j.record.state)).toEqual(['interrupted', 'completed']);
  });

  it('产物引用：账本里任何状态的任务的结果、输出与冻结的规格里出现的产物 id 都算', async () => {
    const result = `sha256:${'a'.repeat(64)}`;
    const output = `sha256:${'b'.repeat(64)}`;
    const inSpec = `sha256:${'c'.repeat(64)}`;
    const base = {
      kind: 'transcribe',
      phase: 'transcribing',
      progress: null,
      videoId: 'mov_1',
      assetId: 'ast_1',
      assetRevision: '1',
      contentHash: 'sha256:x',
      bundleId: 'fake@cpu',
      providerId: 'local',
      modelId: 'fake@cpu',
      inputHash: 'sha256:y',
      submitter: { kind: 'connection', id: 'c' },
      attempt: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      endedAt: '2026-01-01T00:00:00.000Z',
      error: null,
      warnings: [],
    };
    const spec = { contentHash: 'sha256:x', track: 0, range: null, language: { mode: 'prefer', tag: null }, bundleId: 'fake@cpu' };
    await fs.mkdir(path.dirname(paths.jobsFile), { recursive: true });
    await fs.writeFile(
      path.join(path.dirname(paths.jobsFile), 'jobs.json'),
      JSON.stringify({
        formatVersion: 1,
        jobs: [
          {
            record: { ...base, jobId: 'job_done', state: 'completed', result: { documentId: null, artifactId: result, outputs: [{ artifactId: output }] } },
            spec,
            workerVersion: null,
          },
          { record: { ...base, jobId: 'job_failed', state: 'failed', result: null }, spec: { ...spec, reference: inSpec }, workerVersion: null },
        ],
      }),
    );
    await start();
    expect([...manager.referencedArtifactIds()].sort()).toEqual([result, output, inSpec]);
  });

  it('停止：在途任务标为中断，Worker 进程退出', async () => {
    await start();
    const { jobId } = await submit('fake@cpu#slow');
    const queued = await submit('fake@cpu#slow', { hint: 'another' });
    await until(() => manager.inspect(jobId).progress);
    const pid = provider.workerPid('fake@cpu#slow')!;
    await manager.shutdown();
    expect(manager.inspect(jobId)).toMatchObject({ state: 'interrupted', error: { code: 'JOB_INTERRUPTED' } });
    expect(manager.inspect(queued.jobId).state).toBe('interrupted');
    expect(alive(pid)).toBe(false);
    expect(videos.leases).toBe(0);
    await expect(submit()).rejects.toMatchObject({ code: 'busy' });
  });

  describe('实时段落（job.segments）', () => {
    type Update = { jobId: string; from: number; segments: Array<{ start: number; end: number; text: string }> };
    let updates: Update[];
    const listen = () => {
      updates = [];
      manager.onSegments((update) => updates.push(update));
    };

    it('逐段通知，from 递增，tick 换成秒；在跑时进快照，完成后快照不再带', async () => {
      await start();
      listen();
      const { jobId } = await submit();
      await manager.settled(jobId);
      expect(manager.inspect(jobId).state).toBe('completed');
      expect(updates).toEqual([
        { jobId, from: 0, segments: [{ start: 0, end: 1.4, text: 'testing one two' }] },
        { jobId, from: 1, segments: [{ start: 1.6, end: 3, text: 'three baocut is' }] },
        { jobId, from: 2, segments: [{ start: 3.2, end: 3.6, text: 'ready' }] },
      ]);
      expect(manager.snapshot()).not.toHaveProperty('liveSegments');
    });

    it('在跑时快照带着到目前为止的全部段落；取消后丢掉', async () => {
      await start();
      listen();
      const { jobId } = await submit('fake@cpu#slow');
      const live = await until(() => {
        const list = manager.snapshot().liveSegments?.[jobId];
        return list && list.length >= 2 ? list : null;
      });
      expect(live).toEqual(updates.slice(0, live.length).flatMap((u) => u.segments));
      expect(updates.map((u) => u.from)).toEqual(updates.map((_, i) => i));
      await manager.cancel(jobId);
      await manager.settled(jobId);
      expect(manager.inspect(jobId).state).toBe('cancelled');
      expect(manager.snapshot()).not.toHaveProperty('liveSegments');
    });

    it('崩溃后自动重试：中断时丢掉，新一次尝试从 from 0 重来', async () => {
      await start();
      listen();
      const atInterrupt: unknown[] = [];
      manager.onChange((job) => {
        if (job.state === 'interrupted') atInterrupt.push(manager.snapshot().liveSegments);
      });
      const job = await run('fake@cpu#crash-once');
      expect(job).toMatchObject({ state: 'completed', attempt: 2 });
      expect(atInterrupt).toEqual([undefined]);
      expect(updates.map((u) => u.from)).toEqual([0, 0, 1, 2]);
      expect(updates[0]!.segments).toEqual(updates[1]!.segments);
      expect(manager.snapshot()).not.toHaveProperty('liveSegments');
    });

    it('空白文字与不合法的时间丢掉；任务失败后迟到的段落不再收', async () => {
      const remote = new FakeNodeProvider(() => provider);
      await start({ remote, resolveNode: (node) => (node === 'studio' ? 'node_a' : null) });
      listen();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let late: TranscribeSink | null = null;
      remote.next = async (_run, sink) => {
        late = sink;
        sink.segment({ id: 'seg-0001', start: 2_500_000, end: 3_000_000, text: '  hi  ', speakerId: null, words: [] });
        sink.segment({ id: 'seg-0002', start: 3_000_000, end: 3_100_000, text: '   ', speakerId: null, words: [] });
        sink.segment({ id: 'seg-0003', start: 4_000_000, end: 3_900_000, text: 'backwards', speakerId: null, words: [] });
        sink.segment({ id: 'seg-0004', start: Number.NaN, end: 5_000_000, text: 'nan', speakerId: null, words: [] });
        sink.segment({ id: 'seg-0005', start: 5_000_000, end: 5_000_000, text: 'point', speakerId: null, words: [] });
        await gate;
        throw new ProviderFailure('node-lost', '节点失联', { reason: 'stream-lost', node: 'node_a' });
      };
      const { jobId } = await submit('fake@cpu', { node: 'studio' });
      await until(() => updates.length === 2);
      expect(updates).toEqual([
        { jobId, from: 0, segments: [{ start: 2.5, end: 3, text: 'hi' }] },
        { jobId, from: 1, segments: [{ start: 5, end: 5, text: 'point' }] },
      ]);
      expect(manager.snapshot().liveSegments).toEqual({ [jobId]: [updates[0]!.segments[0], updates[1]!.segments[0]] });
      release();
      await manager.settled(jobId);
      expect(manager.inspect(jobId).state).toBe('failed');
      expect(manager.snapshot()).not.toHaveProperty('liveSegments');
      late!.segment({ id: 'seg-0006', start: 6_000_000, end: 7_000_000, text: 'late', speakerId: null, words: [] });
      expect(updates).toHaveLength(2);
    });
  });

  describe('远端节点（node 参数）', () => {
    const resolveNode = (node: string) => (node === 'studio' || node === 'node_a' ? 'node_a' : null);
    let remote: FakeNodeProvider;
    const startRemote = () => {
      remote = new FakeNodeProvider(() => provider);
      return start({ remote, resolveNode });
    };

    it('不看本机模型目录：providerId 为 node:<nodeId>，结果照常校验、发布、应用', async () => {
      await startRemote();
      // 节点上 Worker 崩溃重试过：结果回填的是节点的尝试序号 2。
      remote.next = async (run, sink, signal) => {
        const attempt = await provider.transcribe({ ...run, bundleId: 'fake@cpu', runGeneration: 2 }, sink, signal);
        return attempt.outcome === 'completed' ? { ...attempt, runGeneration: 2 } : attempt;
      };
      const { jobId } = await submit(undefined, { bundleId: undefined, node: 'studio' });
      await manager.settled(jobId);
      const job = manager.inspect(jobId);
      expect(job).toMatchObject({
        state: 'completed',
        attempt: 1,
        providerId: 'node:node_a',
        bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
        result: { documentId: 'doc_speech' },
      });
      expect(remote.runs).toHaveLength(1);
      expect(remote.runs[0]).toMatchObject({
        node: 'node_a',
        mediaType: 'audio/wav',
        runGeneration: 1,
        bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      });
      expect(videos.applied).toHaveLength(1);
      expect(await exists(stagingOf(jobId))).toBe(false);
    });

    it('结果的 runGeneration 仍然严格校验：Provider 不说明时按本机的尝试序号', async () => {
      await startRemote();
      remote.next = (run, sink, signal) => provider.transcribe({ ...run, bundleId: 'fake@cpu', runGeneration: 2 }, sink, signal);
      const { jobId } = await submit(undefined, { node: 'studio' });
      await manager.settled(jobId);
      expect(manager.inspect(jobId)).toMatchObject({ state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } });
    });

    it('不认识的节点 not-found；没有发起端时 node 参数一律 not-found', async () => {
      await startRemote();
      await expect(submit(undefined, { node: 'nowhere' })).rejects.toMatchObject({ code: 'not-found' });
      await manager.shutdown();
      await start();
      await expect(submit(undefined, { node: 'studio' })).rejects.toMatchObject({ code: 'not-found' });
    });

    it('输入哈希含节点：同一素材的本机任务与远端任务是两个任务；远端不占本机模型包的队列', async () => {
      await startRemote();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      remote.next = async (run, sink, signal) => {
        await gate;
        return provider.transcribe({ ...run, bundleId: 'fake@cpu' }, sink, signal);
      };
      const remoteJob = await submit('fake@cpu', { node: 'studio' });
      expect(await submit('fake@cpu', { node: 'node_a' })).toEqual(remoteJob);
      await until(() => manager.inspect(remoteJob.jobId).state === 'running');
      // 远端任务卡住时，同一模型包的本机任务照常执行。
      const local = await run('fake@cpu');
      expect(local.state).toBe('completed');
      expect(local.jobId).not.toBe(remoteJob.jobId);
      expect(local.inputHash).not.toBe(manager.inspect(remoteJob.jobId).inputHash);
      release();
      await manager.settled(remoteJob.jobId);
      expect(manager.inspect(remoteJob.jobId).state).toBe('completed');
    });

    it('同一个节点的远端任务一个一个交（每个节点一个队列）', async () => {
      await startRemote();
      let inFlight = 0;
      let peak = 0;
      remote.next = async (run, sink, signal) => {
        peak = Math.max(peak, ++inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return await provider.transcribe({ ...run, bundleId: 'fake@cpu' }, sink, signal);
        } finally {
          inFlight--;
        }
      };
      const jobs = await Promise.all(['a', 'b', 'c'].map((hint) => submit('fake@cpu', { node: 'studio', hint })));
      for (const { jobId } of jobs) await manager.settled(jobId);
      expect(peak).toBe(1);
      expect(jobs.map(({ jobId }) => manager.inspect(jobId).state)).toEqual(['completed', 'completed', 'completed']);
    });

    it('失败归一化：拒绝与失联不重试；节点上的失败保留节点的错误码并记下节点', async () => {
      await startRemote();
      const cases: Array<[ProviderFailure, object]> = [
        [
          new ProviderFailure('node-rejected', '模型包在节点上不可用', { reason: 'model-not-ready', node: 'node_a' }),
          { code: 'REMOTE_NODE_REJECTED', details: { reason: 'model-not-ready', node: 'node_a' } },
        ],
        [
          new ProviderFailure('node-lost', '节点失联', { reason: 'stream-lost', node: 'node_a' }),
          { code: 'REMOTE_NODE_LOST', details: { reason: 'stream-lost', node: 'node_a' } },
        ],
        [
          new ProviderFailure('remote-failed', 'Worker 反复崩溃', {
            code: 'MODEL_WORKER_CRASHED',
            node: 'node_a',
            details: { attempts: 2 },
          }),
          { code: 'MODEL_WORKER_CRASHED', message: 'Worker 反复崩溃', details: { attempts: 2, node: 'node_a' } },
        ],
      ];
      for (const [index, [failure, error]] of cases.entries()) {
        remote.runs.length = 0;
        remote.next = async () => {
          throw failure;
        };
        const { jobId } = await submit('fake@cpu', { node: 'studio', hint: `case ${index}` });
        await manager.settled(jobId);
        expect(manager.inspect(jobId)).toMatchObject({ state: 'failed', attempt: 1, error });
        expect(remote.runs).toHaveLength(1);
      }
      expect(videos.leases).toBe(0);
    });

    it('取消：Provider 的取消警告进任务记录', async () => {
      await startRemote();
      remote.next = (_run, _sink, signal) =>
        new Promise((resolve) => {
          const cancelled = () => resolve({ outcome: 'cancelled', workerVersion: null, warnings: [{ code: 'remote-cancel-unconfirmed' }] });
          if (signal.aborted) cancelled();
          else signal.addEventListener('abort', cancelled);
        });
      const { jobId } = await submit('fake@cpu', { node: 'studio' });
      await until(() => manager.inspect(jobId).state === 'running');
      await manager.cancel(jobId);
      await manager.settled(jobId);
      expect(manager.inspect(jobId)).toMatchObject({ state: 'cancelled', warnings: [{ code: 'remote-cancel-unconfirmed' }] });
    });
  });

  describe('外部文件任务（节点）', () => {
    const NODE = { kind: 'node', id: 'client-a' } as const;
    const fileRequest = async (extra: Partial<FileTranscribeRequest> = {}): Promise<FileTranscribeRequest> => {
      const file = path.join(dir, 'remote-input');
      await fs.writeFile(file, 'remote audio');
      return {
        file,
        contentHash: 'sha256:' + 'b'.repeat(64),
        bundleId: 'fake@cpu',
        resultFile: path.join(dir, 'remote-result.json'),
        ...extra,
      };
    };

    it('完成：结果交到指定文件，不发布产物、不碰视频；记录里没有视频', async () => {
      await start();
      const outputs: FileJobOutput[] = [];
      const languages: string[] = [];
      const warnings: string[] = [];
      const request = await fileRequest({ jobId: 'job_remote', diarize: true, timescale: 1000, range: { start: 0, end: 5000 } });
      const { jobId } = await manager.submitFile(request, NODE, {
        output: (o) => outputs.push(o),
        language: (tag) => languages.push(tag),
        warning: (w) => warnings.push(w.code),
      });
      expect(jobId).toBe('job_remote');
      expect(await manager.settled(jobId)).toBe('completed');
      const job = manager.inspect(jobId);
      expect(job).toMatchObject({
        state: 'completed',
        submitter: NODE,
        videoId: null,
        assetId: null,
        assetRevision: null,
        contentHash: request.contentHash,
        result: null,
        warnings: [{ code: 'diarization-unavailable' }],
      });
      expect(languages).toEqual(['en']);
      expect(warnings).toEqual(['diarization-unavailable']);
      const bytes = await fs.readFile(request.resultFile);
      expect(outputs).toEqual([
        { file: request.resultFile, byteLength: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
      ]);
      const result = JSON.parse(bytes.toString()) as { timescale: number };
      expect(result.timescale).toBe(1000);
      expect(videos.applied).toEqual([]);
      expect(videos.leases).toBe(0);
      expect(await fs.readdir(paths.artifactsDir).catch(() => [])).toEqual([]);
      expect(await exists(stagingOf(jobId))).toBe(false);
      // 外部文件任务不去重：同样的输入再交一次就是新任务。
      const again = await manager.submitFile(await fileRequest(), NODE);
      expect(again.jobId).not.toBe(jobId);
      await manager.settled(again.jobId);
      expect(manager.list().map((j) => j.submitter.kind)).toEqual(['node', 'node']);
    });

    it('提交时的校验', async () => {
      await start();
      await expect(manager.submitFile(await fileRequest({ file: 'relative' }), NODE)).rejects.toMatchObject({ code: 'invalid-request' });
      await expect(manager.submitFile(await fileRequest({ resultFile: 'out.json' }), NODE)).rejects.toMatchObject({
        code: 'invalid-request',
      });
      await expect(manager.submitFile(await fileRequest({ contentHash: 'md5:1' }), NODE)).rejects.toMatchObject({
        code: 'invalid-request',
      });
      await expect(manager.submitFile(await fileRequest({ bundleId: 'nope' }), NODE)).rejects.toBeInstanceOf(RpcError);
      await expect(manager.submitFile(await fileRequest({ range: { start: 5, end: 5 } }), NODE)).rejects.toMatchObject({
        code: 'invalid-request',
      });
      const { jobId } = await manager.submitFile(await fileRequest({ jobId: 'job_dup' }), NODE);
      await expect(manager.submitFile(await fileRequest({ jobId: 'job_dup' }), NODE)).rejects.toMatchObject({ code: 'conflict' });
      await manager.settled(jobId);
    });

    it('崩溃一次：先通知重试再标中断，以 attempt 2 完成', async () => {
      await start();
      const retries: number[] = [];
      const seen: string[] = [];
      manager.onChange((job) => seen.push(`${job.state}:${job.attempt}`));
      const { jobId } = await manager.submitFile(await fileRequest({ bundleId: 'fake@cpu#crash-once' }), NODE, {
        retrying: (attempt) => {
          retries.push(attempt);
          seen.push(`retrying:${attempt}`);
        },
      });
      await manager.settled(jobId);
      expect(manager.inspect(jobId)).toMatchObject({ state: 'completed', attempt: 2 });
      expect(retries).toEqual([2]);
      expect(seen.indexOf('retrying:2')).toBeLessThan(seen.indexOf('interrupted:1'));
    });

    it('与视频任务共用一个队列：同一个模型包按到达顺序一次一个', async () => {
      await start();
      const first = await submit('fake@cpu#slow-load');
      const remote = await manager.submitFile(await fileRequest({ bundleId: 'fake@cpu#slow-load' }), NODE);
      const second = await submit('fake@cpu#slow-load', { hint: 'second' });
      expect(manager.inspect(remote.jobId).state).toBe('queued');
      for (const { jobId } of [first, remote, second]) await manager.settled(jobId);
      const records = [first, remote, second].map(({ jobId }) => manager.inspect(jobId));
      for (let i = 1; i < records.length; i++) {
        expect(Date.parse(records[i]!.startedAt!)).toBeGreaterThanOrEqual(Date.parse(records[i - 1]!.endedAt!));
      }
      expect(videos.applied).toHaveLength(2);
    });

    it('输出不合合同：诊断目录里不留原始结果（可能含转写文字）', async () => {
      await start();
      const { jobId } = await manager.submitFile(await fileRequest({ bundleId: 'fake@cpu#invalid-output' }), NODE);
      await manager.settled(jobId);
      expect(manager.inspect(jobId)).toMatchObject({ state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } });
      expect(await exists(path.join(paths.diagnosticsDir, jobId, 'job.json'))).toBe(true);
      expect(await exists(path.join(paths.diagnosticsDir, jobId, 'result.json'))).toBe(false);
    });

    it('停止与重启：在途的外部文件任务标为中断', async () => {
      await start();
      const { jobId } = await manager.submitFile(await fileRequest({ bundleId: 'fake@cpu#slow' }), NODE);
      await until(() => manager.inspect(jobId).state === 'running');
      await manager.shutdown();
      expect(manager.inspect(jobId)).toMatchObject({ state: 'interrupted', videoId: null });
      await start();
      expect(manager.inspect(jobId)).toMatchObject({ state: 'interrupted', submitter: NODE, videoId: null });
    });
  });
});
