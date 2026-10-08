import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyJobsEvent } from '@baocut/client';
import { FAKE_MODEL_WORKER } from '@baocut/jobs';
import { BUNDLES, MANIFEST_FILE, defaultTranscribeBundle } from '@baocut/models';
import { RpcError, newId, type JobsSnapshot, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';

/**
 * 端到端：网关 → JobManager → 本地 Provider → 假的 Model Worker（Node 脚本）→ 真实的视频引擎写 speech 文档。
 * 模型目录是合成的清单与小文件；要 engine-host 与 ffmpeg，默认模型包要 Apple Silicon 的 macOS，缺了就跳过。
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
/** 这台机器上的默认转写模型包：Apple Silicon 是 MLX 的，别的平台是 candle 的（同样的仓库）。 */
const DEFAULT_TRANSCRIBE_BUNDLE = defaultTranscribeBundle(process.platform, process.arch);

if (!engine) console.warn('跳过转写端到端测试：没有构建 engine-host（npm run build:engine）');
if (!ffmpeg) console.warn('跳过转写端到端测试：没有 ffmpeg');

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
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

describe('模型与任务方法（不需要引擎）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('没有 Model Worker 时模型包显示不可用，提交转写被拒绝', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-models-'));
    const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
    await installSyntheticModels(home.modelsDir);
    runtime = await startRuntime({ home, drivers: () => [], watchSpace: false, engineHost: null, modelWorker: null });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();

    for (const dir of [home.stagingDir, home.artifactsDir, home.modelsDir]) expect((await fs.stat(dir)).isDirectory()).toBe(true);
    const { bundles } = await client.request('models.list', {});
    expect(bundles.find((b) => b.bundleId === DEFAULT_TRANSCRIBE_BUNDLE)).toEqual(
      expect.objectContaining({
        capability: 'transcribe',
        state: 'error',
        reason: 'worker-missing',
      }),
    );
    // 本地语音合成的模型包也列出，没装就是 not-installed。
    expect(bundles.filter((b) => b.capability === 'synthesize').every((b) => b.state === 'not-installed')).toBe(true);
    expect(await client.request('jobs.list', {})).toEqual({ jobs: [] });
    const missing = await client.request('jobs.inspect', { jobId: 'job_nope' }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(RpcError);
    expect(missing).toMatchObject({ code: 'not-found' });
    const invalid = await client.request('models.transcribe', { videoId: 'mov_1', assetId: 'ast_1', track: -1 }).catch((e: unknown) => e);
    expect(invalid).toMatchObject({ code: 'invalid-request' });
  });
});

describe.skipIf(!engine || !ffmpeg)('转写（真实引擎 + 假 Model Worker）', () => {
  let fixtures: string;
  let audio: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    audio = path.join(fixtures, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '16000', '-ac', '1', audio]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-'));
    const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
    await installSyntheticModels(home.modelsDir);
    runtime = await startRuntime({
      home,
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: { command: process.execPath, args: [FAKE_MODEL_WORKER] },
      jobIdleMs: 60_000,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '转写测试' }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function videoWithAudio() {
    const opened = await client.request('videos.create', { projectId: project.id });
    const videoId = opened.ref.videoId;
    const imported = await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: opened.snapshot.video.revision,
      operations: [{ type: 'importAsset', path: audio, ref: 'voice' }],
    });
    return { videoId, assetId: imported.receipt.refs!.voice! };
  }

  it('转写一段录音：任务主题从排队到完成，视频里多一份 system 写入的 speech 文档', async () => {
    let jobs: JobsSnapshot | null = null;
    const live: Array<{ from: number; texts: string[] }> = [];
    client.subscribeJobs({
      snapshot: (snapshot) => (jobs = snapshot),
      event: (event) => {
        if (event.type === 'job.segments') live.push({ from: event.from, texts: event.segments.map((s) => s.text) });
        jobs = applyJobsEvent(jobs!, event);
      },
    });
    await until(() => jobs);
    expect(jobs!.jobs).toEqual([]);

    expect((await client.request('models.list', {})).bundles[0]).toMatchObject({ bundleId: DEFAULT_TRANSCRIBE_BUNDLE, state: 'installed' });
    const { videoId, assetId } = await videoWithAudio();
    const { jobId } = await client.request('models.transcribe', { videoId, assetId, commandId: 'cmd_transcribe_1' });
    expect(await client.request('models.transcribe', { videoId, assetId, commandId: 'cmd_transcribe_1' })).toEqual({ jobId });

    const done = await until(() => jobs!.jobs.find((j) => j.jobId === jobId && j.state === 'completed'));
    expect(done).toMatchObject({
      kind: 'transcribe',
      videoId,
      assetId,
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      providerId: 'local',
      attempt: 1,
      error: null,
      submitter: { kind: 'connection' },
      result: { documentId: expect.any(String), artifactId: expect.stringMatching(/^sha256:/) },
    });
    expect(await client.request('jobs.inspect', { jobId })).toEqual(done);
    // 识别途中的段落经 `job.segments` 到达，任务结束后镜像里不再有。
    expect(live).toEqual([
      { from: 0, texts: ['testing one two'] },
      { from: 1, texts: ['three baocut is'] },
      { from: 2, texts: ['ready'] },
    ]);
    expect(jobs!).not.toHaveProperty('liveSegments');
    expect((await client.request('jobs.list', { videoId })).jobs.map((j) => j.jobId)).toEqual([jobId]);
    expect(await client.request('jobs.cancel', { jobId })).toEqual({ state: 'completed' });

    const content = await client.request('documents.read', { videoId, documentId: done.result!.documentId! });
    expect(content.document).toMatchObject({ kind: 'speech', name: '转写', language: 'en', sourceAssetId: assetId });
    expect(content.document.extensions).toMatchObject({ jobId, asrOutcome: 'transcribed', inputHash: done.inputHash });
    const body = content.body as { schema: string; words: Array<{ text: string }>; engine: Record<string, unknown> };
    expect(body.schema).toBe('baocut.speech/1');
    expect(body.engine).toMatchObject({
      provider: 'local',
      bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
      backend: 'mlx',
      workerVersion: '0.0.0-fake',
    });
    expect(body.words.map((w) => w.text).join(' ')).toBe('testing one two three baocut is ready');

    const { entries } = await client.request('videos.history', { videoId });
    expect(entries[0]).toMatchObject({ actor: { kind: 'system', id: 'system:jobs' } });
    expect((await client.request('models.list', {})).bundles[0]!.state).toBe('ready');

    // 同样的输入再提交一次是新的任务（上一个已经结束）。P0 不替换已有的 speech 文档（可能有手工修改，
    // 架构设计 §7.3），而是新增一份。
    const again = await client.request('models.transcribe', { videoId, assetId });
    expect(again.jobId).not.toBe(jobId);
    const second = await until(() => jobs!.jobs.find((j) => j.jobId === again.jobId && j.state === 'completed'));
    expect(second.result!.documentId).not.toBe(done.result!.documentId);
    const content2 = await client.request('documents.read', { videoId, documentId: second.result!.documentId! });
    expect(content2.document).toMatchObject({ kind: 'speech', sourceAssetId: assetId });
  });

  it('任务进行中关闭视频：任务持有视频，完成后才真正关闭', async () => {
    const { videoId, assetId } = await videoWithAudio();
    const { jobId } = await client.request('models.transcribe', { videoId, assetId });
    expect(await client.request('videos.close', { videoId })).toEqual({ closed: false });
    const job = await until(async () => {
      const record = await client.request('jobs.inspect', { jobId });
      return record.state === 'completed' ? record : null;
    });
    expect(job.result!.documentId).toEqual(expect.any(String));
    await until(() => !runtime.videos.ref(videoId), 2000);
  });
});
