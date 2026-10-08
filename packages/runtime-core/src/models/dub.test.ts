import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyJobsEvent } from '@baocut/client';
import { DUB_EXTENSION, DUBBING_PLAN_SCHEMA, FAKE_MODEL_WORKER, fakeSpeechAnswer, resolveSpeechWorkerCommand } from '@baocut/jobs';
import { BUNDLES, MODELS_ENDPOINT_ENV } from '@baocut/models';
import { serveRepo, startFakeModelSource, syntheticBytes, syntheticManifest, type FakeModelSource } from '@baocut/models/testing';
import {
  chatCompletionReply,
  startFakeProviderServer,
  wavFixture,
  type FakeHandler,
  type FakeProviderServer,
} from '@baocut/providers/testing';
import {
  grantCreateParamsFor,
  newId,
  type DubSummary,
  type GrantRequestItem,
  type Id,
  type JobRecord,
  type JobsSnapshot,
  type Sequence,
  type VideoSnapshot,
} from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * 翻译配音（架构设计 §7.9）经网关端到端：真实引擎里的视频，翻译在真的 Speech Worker 里（模型是假 OpenAI），假 ElevenLabs 逐句返回能解码的 WAV
 * （长度按句子定，覆盖原样、加速、占用之后的静音与超长）；授权的调用次数小于句数时停在合成并说明，放宽之后重试只合成剩下的；
 * 已有译文过期的句子不合成；应用之后的配音轨、实例、配音计划与原声的压低或静音。测试只连假供应商，密钥是测试里编的字符串。
 */

const engine = resolveEngineHostCommand();
const speechWorker = resolveSpeechWorkerCommand(engine);
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !speechWorker || !ffmpeg) console.warn('跳过翻译配音的端到端测试：没有构建 engine-host、speech-worker 或没有 ffmpeg');

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-dub-0123456789';
const ELEVENLABS_KEY = 'xi-test-ONLY-FOR-TESTS-dub-0123456789';
const VOICE = 'voice_abc123';
/** 视频里绑定给说话人的另一个 Provider 音色。 */
const VOICE2 = 'voice_def456';

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 每句的英文译文（按句子 ID）；合成的长度按译文里的这几句认（`LENGTHS`）。 */
const ENGLISH: Record<string, string> = {
  's-w1': 'Hello everyone.',
  's-w3': 'Today we talk about editing.',
  's-w5': 'This is the third one.',
  's-w7': 'This is the fourth one.',
};

/** 假 OpenAI：按 Speech Worker 的请求答（`fakeSpeechAnswer`），每句回 `ENGLISH` 里的那句。 */
const translator: FakeHandler = (request) => {
  if (request.method === 'GET' && request.path.endsWith('/models')) return { status: 200, json: { object: 'list', data: [] } };
  if (request.method !== 'POST' || !request.path.endsWith('/chat/completions'))
    return { status: 404, json: { error: { message: 'not found' } } };
  const messages = (request.json as { messages: Array<{ role: string; content: string }> }).messages;
  const user = messages.find((m) => m.role === 'user')!.content;
  return chatCompletionReply(
    request,
    fakeSpeechAnswer(user, (id) => ENGLISH[id] ?? `Line ${id}.`),
  );
};

/**
 * 每句合成的长度（秒）：按原文（直接合成时）或它的英文译文定，对着下面的时间窗覆盖对齐的每个分支。
 * 第 1 句窗 1.1 秒放 0.6 秒（原样）；第 2 句窗 1.1 秒放 1.3 秒（加速）；第 3 句窗 0.9 秒放 1.25 秒（加速到上限仍超，占用之后的静音）；
 * 第 4 句窗 0.6 秒、到序列终点 1.5 秒，放 3 秒（超长）。
 */
const LENGTHS: Array<[string, string, number]> = [
  ['大家好', 'Hello everyone', 0.6],
  ['今天讲剪辑', 'about editing', 1.3],
  ['第三句', 'third one', 1.25],
  ['第四句', 'fourth one', 3],
];

/** 合成的音频：880 Hz、振幅 0.5 的正弦（比原声的 lavfi 正弦响得多，导出里一测音量就分得出来）。 */
function toneWav(seconds: number, sampleRate = 24_000): Buffer {
  const wav = wavFixture(seconds, sampleRate);
  for (let i = 0; 44 + i * 2 < wav.length; i++)
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 880 * i) / sampleRate) * 0.5 * 32767), 44 + i * 2);
  return wav;
}

/** 一段音频的均方根（dBFS）：用 ffmpeg 解成单声道浮点。 */
function rmsDb(file: string, start: number, end: number): number {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-to', String(end), '-i', file, '-f', 'f32le', '-ac', '1', '-']);
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  let sum = 0;
  for (const v of samples) sum += v * v;
  return samples.length === 0 || sum === 0 ? -Infinity : 10 * Math.log10(sum / samples.length);
}

/** `voices` 记下每次合成用的音色，`seeds` 记下请求里的种子（没有时 undefined）。 */
function elevenlabs(texts: string[], voices: string[] = [], seeds: unknown[] = []): FakeHandler {
  return (request) => {
    const url = new URL(request.path, 'http://fake');
    if (request.method === 'GET' && url.pathname.endsWith('/models')) return { status: 200, json: [] };
    if (request.method === 'GET' && url.pathname.endsWith('/voices')) return { status: 200, json: { voices: [] } };
    const voice = /^\/v1\/text-to-speech\/([^/]+)$/.exec(url.pathname)?.[1];
    if (request.method === 'POST' && voice && [VOICE, VOICE2].includes(voice)) {
      const text = (request.json as { text: string }).text;
      texts.push(text);
      voices.push(voice);
      seeds.push((request.json as { seed?: unknown }).seed);
      const seconds = LENGTHS.find(([source, english]) => text.includes(source) || text.includes(english))?.[2] ?? 0.5;
      return { status: 200, bytes: toneWav(seconds), headers: { 'content-type': 'audio/wav' } };
    }
    return { status: 404, json: { detail: { status: 'not_found', message: 'not found' } } };
  };
}

const word = (id: string, text: string, start: number, end: number) => ({ id, text, start, end });
const WORDS = [
  word('w1', '大家好', 0, 1000),
  word('w2', '。', 1000, 1100),
  word('w3', '今天讲剪辑', 1500, 2500),
  word('w4', '。', 2500, 2600),
  word('w5', '第三句', 3000, 3800),
  word('w6', '。', 3800, 3900),
  word('w7', '第四句', 4500, 5000),
  word('w8', '。', 5000, 5100),
];
const speechBody = (words: typeof WORDS) => ({
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  engine: null,
  createdAt: null,
  speakers: [],
  words,
  sentences: null,
  chapters: [],
});

/** 人声分离的模型包（MLX 的，只在 Apple Silicon 的 macOS 上装得上）：从本机回环地址上的假模型来源装合成的权重，分离走假的 Model Worker。 */
const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
const SEPARATE_BUNDLE = 'htdemucs-ft@mlx';
const separator = BUNDLES.find((b) => b.bundleId === SEPARATE_BUNDLE)!.components.separator!;
const separateRepo = {
  repo: separator.repo,
  revision: separator.revision,
  files: { 'htdemucs_ft_config.json': Buffer.from('{"synthetic":"sep"}'), 'htdemucs_ft.safetensors': syntheticBytes(50_000, 15) },
};

interface Side {
  dir: string;
  home: RuntimeHome;
  runtime: RunningRuntime;
  client: BaoCutClient;
  received: unknown[];
  jobs(): JobsSnapshot | null;
}

describe.skipIf(!engine || !speechWorker || !ffmpeg)('翻译配音（真实引擎 + 假供应商）', () => {
  let side: Side;
  let models: FakeModelSource;
  let openai: FakeProviderServer;
  let tts: FakeProviderServer;
  let texts: string[];
  let voices: string[];
  let seeds: unknown[];

  beforeEach(async () => {
    texts = [];
    voices = [];
    seeds = [];
    models = await startFakeModelSource();
    serveRepo(models, separateRepo);
    openai = await startFakeProviderServer(translator);
    tts = await startFakeProviderServer(elevenlabs(texts, voices, seeds));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-dub-e2e-'));
    const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
    // 假 Model Worker 只做人声分离；分离模型包只在要它的测试里从假模型来源装（装进临时 Home 的模型目录）。
    const control = path.join(dir, 'fake-worker-control.json');
    await fs.writeFile(control, JSON.stringify({ capabilities: ['separate'] }));
    const runtime = await startRuntime({
      home,
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: { command: process.execPath, args: [FAKE_MODEL_WORKER, '--control', control] },
      jobIdleMs: 60_000,
      modelInstall: {
        env: { [MODELS_ENDPOINT_ENV]: models.endpoint },
        installer: { manifests: [syntheticManifest(separateRepo)], freeBytes: async () => null, backoffMs: () => 5 },
      },
      online: { baseUrls: { openai: `${openai.origin}/v1`, elevenlabs: `${tts.origin}/v1` }, http: { backoffMs: () => 5 } },
    });
    const { endpoint, token } = runtime.discovery;
    const client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    const received: unknown[] = [];
    let jobs: JobsSnapshot | null = null;
    client.subscribeJobs({
      snapshot: (snapshot) => {
        received.push(snapshot);
        jobs = snapshot;
      },
      event: (event) => {
        received.push(event);
        jobs = applyJobsEvent(jobs!, event);
      },
    });
    await until(() => jobs);
    side = { dir, home, runtime, client, received, jobs: () => jobs };
    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await client.request('models.setDefault', { capability: 'generateText', providerId: 'openai' });
    await client.request('models.configure', { providerId: 'elevenlabs', enabled: true, credential: ELEVENLABS_KEY });
    await client.request('models.setDefault', { capability: 'synthesizeSpeech', providerId: 'elevenlabs' });
  });

  afterEach(async () => {
    side.client.close();
    await side.runtime.close();
    await openai.close();
    await tts.close();
    await models.close();
    await fs.rm(side.dir, { recursive: true, force: true });
  });

  async function read(projectId: Id, relPath: string): Promise<VideoSnapshot> {
    return (await side.client.request('videos.open', { projectId, path: relPath })).snapshot.video;
  }

  /** 6 秒的音频放在 0 秒，转写挂在它上面；`split` 在给出的秒数处把实例切开。 */
  async function videoWithSpeech(split?: number, words: Array<(typeof WORDS)[number] & { speaker?: string }> = WORDS) {
    const { project } = await side.client.request('projects.create', { name: '配音' });
    const audio = path.join(project.path, 'media', 'a.wav');
    await fs.mkdir(path.dirname(audio), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-ar', '48000', '-ac', '1', audio]);
    const opened = await side.client.request('videos.create', { projectId: project.id, name: '配音' });
    const videoId = opened.ref.videoId;
    const sequenceId = opened.snapshot.video.rootSequenceId;
    const { receipt } = await side.client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: opened.snapshot.video.revision,
      operations: [
        { type: 'importAsset', path: audio, ref: 'a' },
        { type: 'addItem', sequenceId, asset: { ref: 'a' }, at: { unit: 'seconds', value: '0' }, alignment: 'nearest-frame' },
        {
          type: 'putDocument',
          ref: 'speech',
          kind: 'speech',
          name: '转写',
          language: 'zh',
          sourceAsset: { ref: 'a' },
          body: speechBody(words),
        },
      ],
    });
    if (split !== undefined) {
      const snapshot = await read(project.id, opened.ref.relPath);
      const itemId = snapshot.sequences[sequenceId]!.items[0]!.id;
      await side.client.request('edits.apply', {
        videoId,
        commandId: newId('cmd'),
        expectedRevision: snapshot.revision,
        operations: [{ type: 'splitItem', sequenceId, itemId, at: { unit: 'seconds', value: String(split) }, alignment: 'nearest-frame' }],
      });
    }
    return { videoId, sequenceId, projectId: project.id, relPath: opened.ref.relPath, speechId: receipt.refs!.speech! };
  }

  async function settled(jobId: string, attempt = 1): Promise<JobRecord> {
    return until(() =>
      side
        .jobs()!
        .jobs.find(
          (j) => j.jobId === jobId && j.attempt === attempt && ['completed', 'failed', 'cancelled', 'interrupted'].includes(j.state),
        ),
    );
  }

  const grantTranscript = async (maxCalls: number | null = null) =>
    (
      await side.client.request('grants.create', {
        recipient: 'elevenlabs',
        dataKinds: ['transcript'],
        purpose: '配音',
        budgetMode: 'per-call-unknown-cost',
        maxCalls,
      })
    ).grant.grantId;

  const roleOf = (item: unknown) => (item as { role?: string }).role;
  const dubItems = (sequence: Sequence) => sequence.items.filter((i) => roleOf(i) === 'dub');
  const extensionOf = (item: unknown) =>
    ((item as { extensions?: Record<string, unknown> }).extensions ?? {})[DUB_EXTENSION] as Record<string, unknown> | undefined;

  it('译文要交给语音合成的 Provider：没有覆盖 transcript 的授权时启动即拒绝，不建任务、不发请求', async () => {
    const { videoId } = await videoWithSpeech();
    const error = await side.client
      .request('pipelines.start', { pipeline: 'dub', params: { videoId, targetLanguage: 'en', voice: VOICE } })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden', details: { recipient: 'elevenlabs', dataKinds: ['transcript'] } });
    // 默认授权不放宽（不含文字稿）：拒绝里说清楚要发哪一条授权，之后重新执行。
    expect(error).toMatchObject({
      details: {
        code: 'GRANT_REQUIRED',
        remedy: {
          action: 'create-grant',
          hint: expect.stringContaining('默认授权不含文字稿'),
          commands: [`baocut grants create --recipient elevenlabs --data transcript --video ${videoId} --purpose "<用途>"`],
        },
      },
    });
    const { grants } = await side.client.request('grants.list', {});
    expect(grants.filter((g) => g.recipient === 'elevenlabs').every((g) => !g.dataKinds.includes('transcript'))).toBe(true);
    expect(await side.client.request('jobs.list', { children: true })).toEqual({ jobs: [] });
    expect(texts).toEqual([]);
  });

  it('工具页的当场授权：一次拒绝列出翻译与合成两项待批准的外发，逐项发放之后用同一个 commandId 重新提交即启动；命令行不带待批准项', async () => {
    const { videoId } = await videoWithSpeech();
    // 用户撤销了 OpenAI 的默认授权（撤销后不补发）：翻译与合成都要当场授权。
    const openaiDefault = (await side.client.request('grants.list', { recipient: 'openai' })).grants.find(
      (g) => g.origin === 'provider-enable',
    )!;
    await side.client.request('grants.revoke', { grantId: openaiDefault.grantId });
    const before = (await side.client.request('grants.list', { includeEnded: true })).grants.length;

    const commandId = newId('cmd');
    const start = () =>
      side.client.request('pipelines.start', { pipeline: 'dub', params: { videoId, targetLanguage: 'en', voice: VOICE }, commandId });
    const refused = (await start().catch((e: unknown) => e)) as { code: string; message: string; details: Record<string, unknown> };
    expect(refused).toMatchObject({ code: 'forbidden', details: { code: 'GRANT_REQUIRED' } });
    const pending = refused.details.pendingGrants as GrantRequestItem[];
    expect(pending).toEqual([
      expect.objectContaining({
        capability: 'synthesizeSpeech',
        recipient: 'elevenlabs',
        dataKinds: ['transcript'],
        videoId,
        reason: 'none',
      }),
      expect.objectContaining({ capability: 'generateText', recipient: 'openai', dataKinds: ['transcript'], videoId, reason: 'revoked' }),
    ]);
    // 命令的补救照旧，两项都在。
    expect((refused.details.remedy as { commands: string[] }).commands).toEqual([
      expect.stringContaining('--recipient elevenlabs --data transcript'),
      expect.stringContaining('--recipient openai --data transcript'),
    ]);
    // 拒绝本身不发放、不放宽任何授权，也不建任务。
    expect((await side.client.request('grants.list', { includeEnded: true })).grants).toHaveLength(before);
    expect(await side.client.request('jobs.list', { children: true })).toEqual({ jobs: [] });

    // 命令行（不在场）照旧只有拒绝与命令提示。
    const cli = new BaoCutClient({
      resolve: async () => side.runtime.discovery,
      client: { kind: 'cli', name: 'test', version: '0' },
      reconnect: false,
    });
    await cli.connect();
    try {
      const cliRefusal = (await cli
        .request('pipelines.start', { pipeline: 'dub', params: { videoId, targetLanguage: 'en', voice: VOICE } })
        .catch((e: unknown) => e)) as { details: Record<string, unknown> };
      expect(cliRefusal.details).toMatchObject({ code: 'GRANT_REQUIRED', remedy: { action: 'create-grant' } });
      expect(cliRefusal.details).not.toHaveProperty('pendingGrants');
    } finally {
      cli.close();
    }

    for (const item of pending) await side.client.request('grants.create', grantCreateParamsFor(item));
    const { jobId } = await start();
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    expect(texts.length).toBeGreaterThan(0);
  });

  it('工具页直接提交的任务（生成语音）：额度用完时同样带待批准项，发放之后同一个 commandId 重新提交即创建任务', async () => {
    const elevenDefault = (await side.client.request('grants.list', { recipient: 'elevenlabs' })).grants.find(
      (g) => g.origin === 'provider-enable',
    )!;
    await side.client.request('grants.revoke', { grantId: elevenDefault.grantId });
    const { grant: once } = await side.client.request('grants.create', {
      recipient: 'elevenlabs',
      dataKinds: ['document'],
      purpose: '只一次',
      budgetMode: 'per-call-unknown-cost',
      maxCalls: 1,
    });
    const first = await side.client.request('models.synthesizeSpeech', { text: '大家好', voice: VOICE, format: 'wav' });
    const firstJob = await settled(first.jobId);
    expect(firstJob.state, JSON.stringify(firstJob.error)).toBe('completed');
    expect(
      (await side.client.request('grants.list', { recipient: 'elevenlabs' })).grants.find((g) => g.grantId === once.grantId),
    ).toBeUndefined();

    const commandId = newId('cmd');
    const submit = () => side.client.request('models.synthesizeSpeech', { text: '今天讲剪辑', voice: VOICE, format: 'wav', commandId });
    const refused = (await submit().catch((e: unknown) => e)) as { details: Record<string, unknown> };
    const pending = refused.details.pendingGrants as GrantRequestItem[];
    expect(pending).toEqual([
      expect.objectContaining({
        capability: 'synthesizeSpeech',
        recipient: 'elevenlabs',
        dataKinds: ['document'],
        videoId: null,
        reason: 'exhausted',
      }),
    ]);
    await side.client.request('grants.create', grantCreateParamsFor(pending[0]!));
    const { jobId } = await submit();
    expect((await settled(jobId)).state).toBe('completed');
    // 同一个 commandId 再交一次：同一个任务。
    expect((await submit()).jobId).toBe(jobId);
  });

  it('按说话人选音色：视频里的绑定优先、其次参数；库里的音色没有克隆时那位说话人的句子不合成、逐句报告，不换成别的音色', async () => {
    // 第 1、3 句是 S1，第 2 句是 S2，第 4 句没有说话人。
    const speakerOf: Record<string, string> = { w1: 'S1', w2: 'S1', w3: 'S2', w4: 'S2', w5: 'S1', w6: 'S1' };
    const words = WORDS.map((w) => (speakerOf[w.id] ? { ...w, speaker: speakerOf[w.id]! } : w));
    const { videoId, sequenceId, projectId, relPath, speechId } = await videoWithSpeech(undefined, words);
    const wav = path.join(side.dir, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-ac', '1', '-ar', '16000', wav]);
    const { entry: voice } = await side.client.request('library.put', {
      library: 'voices',
      content: { name: '旁白', language: 'en', transcript: '测试', origin: 'recorded', consent: { declared: true, statement: '本人录制' } },
      source: { path: wav },
    });
    await side.client.request('library.setVideoSelection', {
      videoId,
      commandId: newId('cmd'),
      speakerVoices: [
        { documentId: speechId, speakerId: 'S1', voice: VOICE2, providerId: 'elevenlabs' },
        { documentId: speechId, speakerId: 'S2', voice: `library:${voice.id}` },
      ],
    });
    await grantTranscript();
    const { jobId } = await side.client.request('pipelines.start', {
      pipeline: 'dub',
      params: { videoId, targetLanguage: 'en', voice: VOICE, originalAudio: 'mute' },
    });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    const summary = job.pipeline!.summary as unknown as DubSummary;
    expect(summary.units).toMatchObject({ total: 4, placed: 2, overlong: 1, voiceUnavailable: 1, offTimeline: 0 });
    expect(summary.voiceUnavailableUnits).toEqual([
      { unitId: 't-s-w3', speakerId: 'S2', voice: `library:${voice.id}`, code: 'VOICE_CLONE_REQUIRED', reason: 'missing' },
    ]);
    expect(summary.speakers).toEqual([
      { speakerId: 'S1', voice: VOICE2, voiceSource: 'video', available: true, units: 2 },
      { speakerId: 'S2', voice: `library:${voice.id}`, voiceSource: 'video', available: false, units: 1 },
      { speakerId: null, voice: VOICE, voiceSource: 'params', available: true, units: 1 },
    ]);
    expect(job.warnings.map((w) => w.code)).toContain('DUB_VOICE_UNAVAILABLE');
    // S2 的句子没有发出去，也没有换成参数的音色。
    expect(texts.some((t) => t.includes('剪辑'))).toBe(false);
    expect([...voices].sort()).toEqual([VOICE, VOICE2, VOICE2]);

    const plan = (await side.client.request('documents.read', { videoId, documentId: summary.planDocumentId })).body as {
      units: Array<{ id: string; status: string; speakerBindingId: string | null; extensions: Record<string, Record<string, unknown>> }>;
    };
    const unit = (id: string) => plan.units.find((u) => u.id === `d-t-${id}`)!;
    expect(unit('s-w1')).toMatchObject({
      status: 'ready',
      speakerBindingId: 'S1',
      extensions: { [DUB_EXTENSION]: { voice: VOICE2, voiceSource: 'video' } },
    });
    expect(unit('s-w3')).toMatchObject({
      status: 'failed',
      speakerBindingId: 'S2',
      extensions: {
        [DUB_EXTENSION]: {
          voiceUnavailable: { speakerId: 'S2', voice: `library:${voice.id}`, code: 'VOICE_CLONE_REQUIRED', reason: 'missing' },
        },
      },
    });
    expect(unit('s-w7')).toMatchObject({
      speakerBindingId: null,
      extensions: { [DUB_EXTENSION]: { voice: VOICE, voiceSource: 'params' } },
    });
    // 原声：S2 的句子与别的句子在同一个实例里，一起静音了，如实提醒。
    expect(job.warnings.map((w) => w.code)).toContain('DUB_MUTED_UNVOICED');
    const sequence = (await read(projectId, relPath)).sequences[sequenceId]!;
    expect(dubItems(sequence)).toHaveLength(2);
  });

  it('译文用了库里的术语表：术语表改了之后，含改动术语的句子过期、不合成（glossary-changed），别的句子照常', async () => {
    const { videoId, speechId } = await videoWithSpeech();
    await grantTranscript();
    const { entry: glossary } = await side.client.request('library.put', {
      library: 'glossaries',
      content: {
        name: '剪辑词',
        kind: 'translation',
        sourceLanguage: null,
        targetLanguage: 'en',
        defaultEnabled: false,
        terms: [
          { source: '剪辑', target: 'editing', note: null },
          { source: '第三句', target: 'third', note: null },
        ],
      },
    });
    const { jobId: translateJob } = await side.client.request('pipelines.start', {
      pipeline: 'translate',
      params: { videoId, targetLanguage: 'en', documentId: speechId, glossaries: [{ id: glossary.id }] },
    });
    const translated = await settled(translateJob);
    expect(translated.state, JSON.stringify(translated.error)).toBe('completed');
    expect(translated.library?.entries).toEqual([
      { library: 'glossaries', id: glossary.id, version: 1, contentHash: glossary.contentHash },
    ]);
    const translationId = translated.result!.documentId!;
    const translation = (await side.client.request('documents.read', { videoId, documentId: translationId })).body as {
      glossaryRef: unknown;
    };
    expect(translation.glossaryRef).toMatchObject({
      entries: [{ id: glossary.id, version: 1 }],
      terms: [{ source: '剪辑' }, { source: '第三句' }],
    });

    // 改「剪辑」的译法：只有第 2 句过期。
    await side.client.request('library.put', {
      library: 'glossaries',
      id: glossary.id,
      content: {
        name: '剪辑词',
        kind: 'translation',
        sourceLanguage: null,
        targetLanguage: 'en',
        defaultEnabled: false,
        terms: [
          { source: '剪辑', target: 'cutting', note: null },
          { source: '第三句', target: 'third', note: null },
        ],
      },
    });
    const { jobId } = await side.client.request('pipelines.start', { pipeline: 'dub', params: { videoId, translationId, voice: VOICE } });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    const summary = job.pipeline!.summary as unknown as DubSummary;
    expect(summary.units).toMatchObject({ total: 4, stale: 1 });
    expect(summary.staleUnits).toEqual(['t-s-w3']);
    expect(texts.some((t) => t.includes('剪辑'))).toBe(false);
    const plan = (await side.client.request('documents.read', { videoId, documentId: summary.planDocumentId })).body as {
      units: Array<{ status: string; extensions: Record<string, Record<string, unknown>> }>;
    };
    expect(plan.units.find((u) => u.status === 'stale')!.extensions[DUB_EXTENSION]).toMatchObject({ staleReason: 'glossary-changed' });
  });

  it('翻译 → 逐句合成 → 对齐 → 一笔事务应用：配音轨、实例、配音计划与压低原声；超长的句子不放、如实报告', async () => {
    // 第 2 句被切成两段（前后相连）：只配一次。
    const { videoId, sequenceId, projectId, relPath } = await videoWithSpeech(2);
    await grantTranscript();
    const { jobId } = await side.client.request('pipelines.start', {
      pipeline: 'dub',
      params: { videoId, targetLanguage: 'en', voice: VOICE, duckDb: 15 },
    });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    const summary = job.pipeline!.summary as unknown as DubSummary;
    expect(summary).toMatchObject({
      videoId,
      language: 'en',
      translation: { created: true },
      units: { total: 4, placed: 3, stale: 0, offTimeline: 0, tempo: 1, extended: 1, overlong: 1 },
      synthesis: {
        providerId: 'elevenlabs',
        modelId: 'eleven_multilingual_v2',
        voice: VOICE,
        calls: 4,
        retries: 0,
        failures: 0,
        reused: 0,
      },
      originalAudio: 'duck',
      separation: 'not-requested',
    });
    expect(summary.overlongUnits).toHaveLength(1);
    expect(summary.overlongUnits[0]!.overflowSeconds).toBeGreaterThan(0.8);
    expect(job.warnings.map((w) => w.code)).toContain('DUB_UNITS_OVERLONG');
    expect([...texts].sort()).toEqual(Object.values(ENGLISH).sort());
    expect(job.pipeline!.steps.find((s) => s.name === 'separate')!.status).toBe('skipped');

    const video = await read(projectId, relPath);
    const sequence = video.sequences[sequenceId]!;
    const track = sequence.tracks.find((t) => t.id === summary.trackId)!;
    expect(track).toMatchObject({ kind: 'audio', name: '配音（en）' });
    const items = dubItems(sequence);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.trackId === track.id && i.type === 'audio')).toBe(true);
    for (const item of items) expect(extensionOf(item)).toMatchObject({ groupId: summary.groupId, language: 'en' });
    // 配音从原句的起点开始：0 秒、1.5 秒、3 秒。
    const fps = sequence.fps.num / sequence.fps.den;
    const starts = items.map((i) => Math.round(((i as { fromFrame: number }).fromFrame / fps) * 10) / 10).sort((a, b) => a - b);
    expect(starts).toEqual([0, 1.5, 3]);
    for (const item of items) {
      const assetId = (item as { assetRef: { id: Id } }).assetRef.id;
      expect(video.assets[assetId]).toMatchObject({
        revisions: { '1': { storage: { mode: 'managed' }, provenance: { origin: 'generated' } } },
      });
    }
    // 原声：两段原句实例都被压低，触发是配音轨。
    const originals = sequence.items.filter((i) => i.trackId !== track.id);
    expect(originals).toHaveLength(2);
    expect(sequence.ducking).toHaveLength(1);
    const rule = sequence.ducking![0]!;
    expect(rule).toMatchObject({ enabled: true, trigger: { kind: 'items', trackIds: [track.id] }, depth: 15 });
    expect([...rule.target.itemIds!].sort()).toEqual(originals.map((i) => i.id).sort());

    const plan = await side.client.request('documents.read', { videoId, documentId: summary.planDocumentId });
    expect(plan.document).toMatchObject({ kind: 'dubbing-plan', language: 'en', sourceDocumentId: summary.translation.documentId });
    const body = plan.body as { schema: string; groupId: string; units: Array<{ status: string; sourceSentenceIds: string[] }> };
    expect(body.schema).toBe(DUBBING_PLAN_SCHEMA);
    expect(body.groupId).toBe(summary.groupId);
    expect(body.units.map((u) => u.status).sort()).toEqual(['needs-fit', 'ready', 'ready', 'ready']);
    expect(body.units.find((u) => u.status === 'needs-fit')!.sourceSentenceIds).toEqual(['s-w7']);
    const history = await side.client.request('videos.history', { videoId });
    expect(history.entries[0]).toMatchObject({ actor: { kind: 'system', id: 'system:pipeline' } });

    // 密钥只在认证头里。
    for (const file of [side.home.jobsFile, path.join(side.home.logsDir, 'runtime.log')]) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      expect(text).not.toContain(ELEVENLABS_KEY);
      expect(text).not.toContain(OPENAI_KEY);
    }
    expect(JSON.stringify(side.received)).not.toContain(ELEVENLABS_KEY);
  });

  it('句级重配：先改译文再只重配这几句，写回同一组（同一条轨、同一份计划的新版本）；种子透传；放不下的句子留着旧的一版；切回旧版本是一笔可撤销的编辑', async () => {
    const { videoId, sequenceId, projectId, relPath } = await videoWithSpeech();
    const grantId = await grantTranscript();
    const first = await settled(
      (await side.client.request('pipelines.start', { pipeline: 'dub', params: { videoId, targetLanguage: 'en', voice: VOICE } })).jobId,
    );
    expect(first.state, JSON.stringify(first.error)).toBe('completed');
    const dubbed = first.pipeline!.summary as unknown as DubSummary;
    const before = (await read(projectId, relPath)).sequences[sequenceId]!;
    const oldItems = dubItems(before);
    expect(oldItems).toHaveLength(3);
    const itemOf = (sequence: Sequence, unitId: string) => dubItems(sequence).find((i) => extensionOf(i)?.unitId === unitId)!;
    const old1 = itemOf(before, 't-s-w1') as Sequence['items'][number] & { assetRef: { id: Id; revision: string } };
    const callsBefore = texts.length;

    // 授权撤销之后与配音一样拒绝，带待批准的合成一项（不翻译，没有文本模型那一项），不建任务。
    await side.client.request('grants.revoke', { grantId });
    const refused = (await side.client
      .request('pipelines.start', { pipeline: 'dub', params: { videoId, regroup: { groupId: dubbed.groupId, units: ['t-s-w1'] } } })
      .catch((e: unknown) => e)) as { code: string; details: Record<string, unknown> };
    expect(refused).toMatchObject({ code: 'forbidden', details: { code: 'GRANT_REVOKED' } });
    expect((refused.details.pendingGrants as GrantRequestItem[]).map((g) => g.capability)).toEqual(['synthesizeSpeech']);
    await grantTranscript();

    // 不在这一组里的句子、不存在的组：提交时拒绝。
    await expect(
      side.client.request('pipelines.start', { pipeline: 'dub', params: { videoId, regroup: { groupId: 'dub_nope', units: ['t-s-w1'] } } }),
    ).rejects.toMatchObject({ code: 'invalid-request', details: { code: 'DUB_GROUP_NOT_FOUND' } });
    await expect(
      side.client.request('pipelines.start', {
        pipeline: 'dub',
        params: { videoId, regroup: { groupId: dubbed.groupId, units: ['t-nope'] } },
      }),
    ).rejects.toMatchObject({ code: 'invalid-request', details: { missing: ['t-nope'] } });

    // 改第 1 句的译文（与界面的改译文同一条路：译文文档的新版本），再只重配这一句，种子给定。
    const translationId = dubbed.translation.documentId;
    const translation = await side.client.request('documents.read', { videoId, documentId: translationId });
    const tBody = structuredClone(translation.body) as { units: Array<{ id: string; naturalText: string }> };
    tBody.units.find((u) => u.id === 't-s-w1')!.naturalText = '[en] Hello again.';
    await side.client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: (await read(projectId, relPath)).revision,
      operations: [{ type: 'putDocument', documentId: translationId, kind: 'translation', body: tBody }],
    });
    const { jobId } = await side.client.request('pipelines.start', {
      pipeline: 'dub',
      params: { videoId, regroup: { groupId: dubbed.groupId, units: ['t-s-w1'], seed: 42 } },
    });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    // 冻结的参数里有这一组与这几句（界面据此画排队）。
    expect(job.pipeline!.params.regroup).toEqual({
      groupId: dubbed.groupId,
      units: ['t-s-w1'],
      planDocumentId: dubbed.planDocumentId,
      trackId: dubbed.trackId,
      seed: 42,
    });
    // 只合成这一句，用的是改过的译文与种子。
    expect(texts.slice(callsBefore)).toEqual(['[en] Hello again.']);
    expect(seeds.slice(callsBefore)).toEqual([42]);
    const summary = job.pipeline!.summary as unknown as DubSummary;
    expect(summary).toMatchObject({
      groupId: dubbed.groupId,
      trackId: dubbed.trackId,
      planDocumentId: dubbed.planDocumentId,
      translation: { documentId: translationId, created: false },
      units: { total: 1, placed: 1 },
      regroup: { seed: 42, units: [{ unitId: 't-s-w1', status: 'replaced', take: 2, seed: 42 }] },
    });

    const after = (await read(projectId, relPath)).sequences[sequenceId]!;
    expect(after.tracks).toHaveLength(before.tracks.length);
    const items = dubItems(after);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.trackId === dubbed.trackId)).toBe(true);
    // 别的句子不动；这一句换成新的实例与素材，带版本与种子。
    for (const unitId of ['t-s-w3', 't-s-w5']) expect(itemOf(after, unitId).id).toBe(itemOf(before, unitId).id);
    const new1 = itemOf(after, 't-s-w1') as typeof old1;
    expect(new1.id).not.toBe(old1.id);
    expect(new1.assetRef.id).not.toBe(old1.assetRef.id);
    expect(extensionOf(new1)).toEqual({ groupId: dubbed.groupId, language: 'en', unitId: 't-s-w1', take: 2, seed: 42 });
    expect(after.ducking).toHaveLength(1);

    // 同一份计划的新版本：第 1 版补记了旧的素材，第 2 版是当前版本。
    const plan = await side.client.request('documents.read', { videoId, documentId: dubbed.planDocumentId });
    expect(plan.revision).not.toBe('1');
    expect(plan.document.revisions[plan.document.currentRevision]!.summary).toMatchObject({ groupId: dubbed.groupId, placed: 3 });
    type PlanUnit = { id: string; status: string; script: { text: string }; extensions: Record<string, Record<string, unknown>> };
    const unit1 = (plan.body as { units: PlanUnit[] }).units.find((u) => u.id === 'd-t-s-w1')!;
    expect(unit1).toMatchObject({ status: 'ready', script: { text: '[en] Hello again.' } });
    expect(unit1.extensions[DUB_EXTENSION]).toMatchObject({ take: 2, seed: 42 });
    const takes = unit1.extensions[DUB_EXTENSION]!.takes as Array<Record<string, unknown>>;
    expect(takes).toEqual([
      expect.objectContaining({ k: 1, seed: null, assetRef: old1.assetRef, text: ENGLISH['s-w1'], jobId: first.jobId }),
      expect.objectContaining({ k: 2, seed: 42, text: '[en] Hello again.', jobId, fit: 'fit' }),
    ]);

    // 两句一起重配，第 3 句改得太长放不下：第 1 句换上第 3 版，第 3 句留着旧的一版，计划里记下没放上的那一版；种子随机取一个。
    const tBody2 = structuredClone(tBody);
    tBody2.units.find((u) => u.id === 't-s-w5')!.naturalText = 'This is the fourth one, too long.';
    await side.client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: (await read(projectId, relPath)).revision,
      operations: [{ type: 'putDocument', documentId: translationId, kind: 'translation', body: tBody2 }],
    });
    const middle = (await read(projectId, relPath)).sequences[sequenceId]!;
    const second = await settled(
      (
        await side.client.request('pipelines.start', {
          pipeline: 'dub',
          params: { videoId, regroup: { groupId: dubbed.groupId, units: ['t-s-w1', 't-s-w5'] } },
        })
      ).jobId,
    );
    expect(second.state, JSON.stringify(second.error)).toBe('completed');
    const random = (second.pipeline!.params.regroup as { seed: number }).seed;
    expect(Number.isInteger(random) && random >= 1).toBe(true);
    expect(seeds.slice(-2)).toEqual([random, random]);
    expect((second.pipeline!.summary as unknown as DubSummary).regroup!.units).toEqual([
      { unitId: 't-s-w1', status: 'replaced', take: 3, seed: random },
      { unitId: 't-s-w5', status: 'overlong', take: 2, seed: random },
    ]);
    const late = (await read(projectId, relPath)).sequences[sequenceId]!;
    expect(itemOf(late, 't-s-w5').id).toBe(itemOf(middle, 't-s-w5').id);
    expect(extensionOf(itemOf(late, 't-s-w1'))).toMatchObject({ take: 3, seed: random });
    const plan2 = await side.client.request('documents.read', { videoId, documentId: dubbed.planDocumentId });
    const unit5 = (plan2.body as { units: PlanUnit[] }).units.find((u) => u.id === 'd-t-s-w5')!;
    expect(unit5.status).toBe('ready');
    expect(unit5.extensions[DUB_EXTENSION]).toMatchObject({ take: 1 });
    expect(unit5.extensions[DUB_EXTENSION]!.takes).toEqual([
      expect.objectContaining({ k: 1, assetRef: (itemOf(middle, 't-s-w5') as typeof old1).assetRef }),
      expect.objectContaining({ k: 2, seed: random, fit: null, samples: null, overflowSeconds: expect.any(Number) }),
    ]);

    // 切回第 1 句的第 1 版：删掉当前实例、用那一版的素材放回原处、计划改成第 1 版——一笔编辑，撤销一次全部回去。
    const current = itemOf(late, 't-s-w1') as typeof old1 & { fromFrame: number; subframeOffset: unknown; playDuration: unknown };
    const planUnits = structuredClone((plan2.body as { units: PlanUnit[] }).units);
    const target = planUnits.find((u) => u.id === 'd-t-s-w1')!;
    const take1 = (
      target.extensions[DUB_EXTENSION]!.takes as Array<{
        k: number;
        assetRef: { id: Id; revision: string };
        samples: number;
        sampleRate: number;
      }>
    )[0]!;
    target.extensions[DUB_EXTENSION]!.take = 1;
    const switched = await side.client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: (await read(projectId, relPath)).revision,
      operations: [
        { type: 'deleteItems', sequenceId, itemIds: [current.id] },
        {
          type: 'insertItems',
          sequenceId,
          items: [
            {
              type: 'audio',
              trackId: current.trackId,
              assetRef: take1.assetRef,
              fromFrame: current.fromFrame,
              subframeOffset: current.subframeOffset,
              playDuration: { ticks: String(take1.samples), timescale: take1.sampleRate },
              timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
              mix: { volume: 1 },
              role: 'dub',
              extensions: { [DUB_EXTENSION]: { groupId: dubbed.groupId, language: 'en', unitId: 't-s-w1', take: 1 } },
            } as never,
          ],
        },
        {
          type: 'putDocument',
          documentId: dubbed.planDocumentId,
          kind: 'dubbing-plan',
          body: { ...(plan2.body as object), units: planUnits },
        },
      ],
    });
    const back = (await read(projectId, relPath)).sequences[sequenceId]!;
    expect((itemOf(back, 't-s-w1') as typeof old1).assetRef).toEqual(old1.assetRef);
    await side.client.request('edits.undo', { videoId, commandId: newId('cmd'), target: { transaction: switched.receipt.transactionId } });
    const undone = (await read(projectId, relPath)).sequences[sequenceId]!;
    expect(itemOf(undone, 't-s-w1').id).toBe(current.id);
  });

  it('授权只够 2 次调用、要合成 4 句：停在合成，说明合成了几句、还剩几句；放宽之后重试只合成剩下的', async () => {
    const { videoId } = await videoWithSpeech();
    const grantId = await grantTranscript(2);
    const { jobId } = await side.client.request('pipelines.start', {
      pipeline: 'dub',
      params: { videoId, targetLanguage: 'en', voice: VOICE, separateBackground: true },
    });
    const failed = await settled(jobId);
    expect(failed).toMatchObject({
      state: 'failed',
      error: { code: 'BUDGET_EXCEEDED', details: { step: 'synthesize', synthesized: 2, remaining: 2 } },
      pipeline: { stoppedAt: 'synthesize' },
    });
    expect(texts).toHaveLength(2);
    const before = (await side.client.request('videos.history', { videoId })).entries.length;

    await side.client.request('grants.update', { grantId, maxCalls: null });
    await side.client.request('pipelines.retry', { jobId });
    const retried = await settled(jobId, 2);
    expect(retried.state, JSON.stringify(retried.error)).toBe('completed');
    const summary = retried.pipeline!.summary as unknown as DubSummary;
    expect(summary.synthesis).toMatchObject({ reused: 2, calls: 2 });
    expect(texts).toHaveLength(4);
    // 要求了分离但没有配置：这一步跳过，如实报告。
    expect(summary.separation).toBe('not-configured');
    expect(retried.warnings.map((w) => w.code)).toContain('DUB_SEPARATION_NOT_CONFIGURED');
    expect(retried.pipeline!.steps.find((s) => s.name === 'separate')!.status).toBe('skipped');
    expect((await side.client.request('videos.history', { videoId })).entries.length).toBe(before + 1);
  });

  it('用已有的译文：原文改过的句子过期、不合成，计划里记为 stale；静音原声并提醒背景一起没了', async () => {
    const { videoId, sequenceId, projectId, relPath, speechId } = await videoWithSpeech();
    await grantTranscript();
    const { jobId: translateJob } = await side.client.request('pipelines.start', {
      pipeline: 'translate',
      params: { videoId, targetLanguage: 'en' },
    });
    const translated = await settled(translateJob);
    const translationId = translated.result!.documentId!;
    // 改第 2 句的原文：译文的这一句过期。
    const current = await read(projectId, relPath);
    await side.client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: current.revision,
      operations: [
        {
          type: 'putDocument',
          documentId: speechId,
          kind: 'speech',
          body: speechBody(WORDS.map((w) => (w.id === 'w3' ? { ...w, text: '今天讲调色' } : w))),
        },
      ],
    });
    const { jobId } = await side.client.request('pipelines.start', {
      pipeline: 'dub',
      params: { videoId, translationId, voice: VOICE, originalAudio: 'mute' },
    });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    const summary = job.pipeline!.summary as unknown as DubSummary;
    expect(summary).toMatchObject({
      translation: { documentId: translationId, created: false },
      units: { total: 4, stale: 1, placed: 2, overlong: 1 },
      originalAudio: 'mute',
    });
    expect(summary.staleUnits).toHaveLength(1);
    expect(texts.some((t) => t.includes('剪辑') || t.includes('调色'))).toBe(false);
    expect(job.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['DUB_UNITS_STALE', 'DUB_BACKGROUND_MUTED']));
    expect(job.pipeline!.steps.filter((s) => s.status === 'skipped').map((s) => s.name)).toEqual([
      'target',
      'translate',
      'assemble',
      'write',
      'separate',
    ]);

    const sequence = (await read(projectId, relPath)).sequences[sequenceId]!;
    const original = sequence.items.find((i) => roleOf(i) !== 'dub')!;
    expect((original as { mix: { muted: boolean } }).mix.muted).toBe(true);
    expect(sequence.ducking ?? []).toEqual([]);
    const plan = (await side.client.request('documents.read', { videoId, documentId: summary.planDocumentId })).body as {
      units: Array<{ status: string; script: unknown; sourceSentenceIds: string[] }>;
    };
    expect(plan.units.find((u) => u.status === 'stale')).toMatchObject({ script: null, sourceSentenceIds: ['s-w3'] });
  });

  /** 从假模型来源装上人声分离的模型包（只装进临时 Home 的模型目录），等它成为 `separateAudio` 的生效执行者。 */
  async function installSeparator(): Promise<void> {
    const { path: modelsDir } = await side.client.request('models.getDir', {});
    expect(path.relative(side.dir, modelsDir).startsWith('..')).toBe(false);
    const { plan } = await side.client.request('models.install', { bundleId: SEPARATE_BUNDLE });
    const { jobId } = await side.client.request('models.install', { bundleId: SEPARATE_BUNDLE, confirmBytes: plan.confirmBytes });
    expect((await settled(jobId!)).state).toBe('completed');
    await until(async () => (await side.client.request('models.capabilities', {})).capabilities.separateAudio.effective);
  }

  it.skipIf(!appleSilicon)(
    '分离过、原声压低：原句实例静音，换成「背景声」（原样）与「人声」（被压低）两轨；静音的实例记进计划；撤销那一笔全部还原',
    async () => {
      const { videoId, sequenceId, projectId, relPath } = await videoWithSpeech();
      await installSeparator();
      await grantTranscript();
      const before = (await read(projectId, relPath)).sequences[sequenceId]!;
      const { jobId } = await side.client.request('pipelines.start', {
        pipeline: 'dub',
        params: { videoId, targetLanguage: 'en', voice: VOICE, duckDb: 18, separateBackground: true },
      });
      const job = await settled(jobId);
      expect(job.state, JSON.stringify(job.error)).toBe('completed');
      const summary = job.pipeline!.summary as unknown as DubSummary;
      expect(summary).toMatchObject({ originalAudio: 'duck', separation: 'completed' });
      expect(job.warnings.map((w) => w.code)).not.toContain('DUB_BACKGROUND_MUTED');

      const sequence = (await read(projectId, relPath)).sequences[sequenceId]!;
      const original = before.items[0]!;
      const named = (name: string) => sequence.tracks.find((t) => t.name === name)!;
      const [bgTrack, vocalsTrack] = [named('背景声（en）'), named('人声（en）')];
      const on = (trackId: Id) => sequence.items.filter((i) => i.trackId === trackId);
      expect(on(bgTrack.id)).toHaveLength(1);
      expect(on(vocalsTrack.id)).toHaveLength(1);
      expect(extensionOf(on(bgTrack.id)[0])).toEqual({ groupId: summary.groupId, stem: 'background' });
      expect(extensionOf(on(vocalsTrack.id)[0])).toEqual({ groupId: summary.groupId, stem: 'vocals' });
      for (const stem of [...on(bgTrack.id), ...on(vocalsTrack.id)]) {
        expect(stem).toMatchObject({ fromFrame: (original as { fromFrame: number }).fromFrame, mix: { volume: 1 } });
      }
      expect((sequence.items.find((i) => i.id === original.id) as { mix: { muted?: boolean } }).mix.muted).toBe(true);
      expect(sequence.ducking).toHaveLength(1);
      expect(sequence.ducking![0]).toMatchObject({
        enabled: true,
        trigger: { kind: 'items', trackIds: [summary.trackId] },
        target: { trackIds: [vocalsTrack.id] },
        depth: 18,
      });
      const plan = (await side.client.request('documents.read', { videoId, documentId: summary.planDocumentId })).body as {
        backgroundPolicy: string;
        extensions: Record<string, { mutedItemIds?: string[] }>;
      };
      expect(plan.backgroundPolicy).toBe('separate-stems');
      expect(plan.extensions[DUB_EXTENSION]!.mutedItemIds).toEqual([original.id]);

      // 一键撤销：撤掉应用配音的那一笔，轨道、实例、闪避与原声的静音一起还原。
      const history = await side.client.request('videos.history', { videoId });
      await side.client.request('edits.undo', {
        videoId,
        commandId: newId('cmd'),
        target: { transaction: history.entries[0]!.transactionId },
      });
      const undone = (await read(projectId, relPath)).sequences[sequenceId]!;
      expect(undone.tracks.map((t) => t.name)).toEqual(before.tracks.map((t) => t.name));
      expect(undone.items).toEqual(before.items);
      expect(undone.ducking ?? []).toEqual([]);
    },
  );

  it.skipIf(!appleSilicon)('分离过、原声静音：只放「背景声」一轨，不放人声；不提醒背景一起没了', async () => {
    const { videoId, sequenceId, projectId, relPath } = await videoWithSpeech();
    await installSeparator();
    await grantTranscript();
    const { jobId } = await side.client.request('pipelines.start', {
      pipeline: 'dub',
      params: { videoId, targetLanguage: 'en', voice: VOICE, originalAudio: 'mute', separateBackground: true },
    });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    expect((job.pipeline!.summary as unknown as DubSummary).separation).toBe('completed');
    expect(job.warnings.map((w) => w.code)).not.toContain('DUB_BACKGROUND_MUTED');
    const sequence = (await read(projectId, relPath)).sequences[sequenceId]!;
    expect(sequence.tracks.map((t) => t.name)).toEqual(expect.arrayContaining(['配音（en）', '背景声（en）']));
    expect(sequence.tracks.some((t) => t.name === '人声（en）')).toBe(false);
    expect(sequence.ducking ?? []).toEqual([]);
  });

  it('音频导出的声音来源：混音（原声已静音）、只要原声（去掉配音、恢复静音的原声）、只要这一组配音', async () => {
    const { videoId } = await videoWithSpeech();
    await grantTranscript();
    const { jobId } = await side.client.request('pipelines.start', {
      pipeline: 'dub',
      params: { videoId, targetLanguage: 'en', voice: VOICE, originalAudio: 'mute' },
    });
    const job = await settled(jobId);
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    const summary = job.pipeline!.summary as unknown as DubSummary;
    const plan = (await side.client.request('documents.read', { videoId, documentId: summary.planDocumentId })).body as {
      extensions: Record<string, { mutedItemIds?: string[] }>;
    };
    expect(plan.extensions[DUB_EXTENSION]!.mutedItemIds).toHaveLength(1);

    const exportAudio = async (source?: unknown, kind: 'audio' | 'video' = 'audio') => {
      const { jobId: exportId } = await side.client.request('exports.create', {
        videoId,
        commandId: newId('cmd'),
        settings: { kind, format: kind === 'audio' ? 'wav' : 'mp4', ...(source !== undefined ? { source } : {}) } as never,
      });
      const exported = await until(async () => {
        const record = await side.client.request('exports.get', { jobId: exportId });
        return ['completed', 'failed', 'cancelled', 'interrupted'].includes(record.state) && record;
      });
      expect(exported.state, JSON.stringify(exported.error)).toBe('completed');
      return exported.result!.outputs![0]!.path!;
    };
    // 0–0.5 秒有第 1 句配音；5.2 秒之后没有配音，只有原声。
    const mix = await exportAudio();
    expect(rmsDb(mix, 0.05, 0.5)).toBeGreaterThan(-15);
    expect(rmsDb(mix, 5.3, 5.9)).toBeLessThan(-60);

    const original = await exportAudio('original');
    for (const [start, end] of [
      [0.05, 0.5],
      [5.3, 5.9],
    ] as const) {
      const db = rmsDb(original, start, end);
      expect(db).toBeGreaterThan(-30);
      expect(db).toBeLessThan(-15);
    }

    const dubOnly = await exportAudio({ dubGroupId: summary.groupId });
    expect(rmsDb(dubOnly, 0.05, 0.5)).toBeGreaterThan(-15);
    expect(rmsDb(dubOnly, 5.3, 5.9)).toBeLessThan(-60);

    await expect(
      side.client.request('exports.create', {
        videoId,
        settings: { kind: 'audio', format: 'wav', source: { dubGroupId: 'dub_nope' } } as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid-request', details: { code: 'DUB_GROUP_NOT_FOUND' } });
    // 成片接受同样的来源：只换声音，视频本身不变。
    const revision = side.runtime.videos.mirror(videoId)!.video.revision;
    const film = await exportAudio('original', 'video');
    const filmDb = rmsDb(film, 0.05, 0.5);
    expect(filmDb).toBeGreaterThan(-30);
    expect(filmDb).toBeLessThan(-15);
    const dubFilm = await exportAudio({ dubGroupId: summary.groupId }, 'video');
    expect(rmsDb(dubFilm, 5.3, 5.9)).toBeLessThan(-60);
    expect(side.runtime.videos.mirror(videoId)!.video.revision).toBe(revision);
    await expect(
      side.client.request('exports.create', {
        videoId,
        settings: { kind: 'subtitles', format: 'srt', source: 'original' } as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    // 两次成片要真的画面与编码：全量并行时比缺省的 15 秒慢。
  }, 60_000);
});
