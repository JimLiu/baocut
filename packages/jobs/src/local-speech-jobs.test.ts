import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type EditOperation, type JobRecord, type JobSubmitter, type SynthesizeSpeechRequest } from '@baocut/protocol';
import { FileCredentialStore } from '@baocut/runtime-storage';
import { LibraryStore } from '@baocut/runtime-storage/library';
import {
  LocalProviderSource,
  MANIFEST_FILE,
  MODEL_ASSETS_ENV,
  ModelCatalog,
  ModelServiceStore,
  ModelServices,
  SPEECH_BUNDLES,
  SPEECH_PEAK_CEILING,
  builtinVoice,
  builtinVoiceFile,
  speechSelfTestVerdict,
  type BundleDefinition,
} from '@baocut/models';
import { generatedImportOperation } from './generated-import.ts';
import { JobManager, type JobVideos } from './job-manager.ts';
import { LocalSpeechProvider } from './local-speech-provider.ts';
import { modelWorkerDemand, modelWorkerHolder } from './resource-profiles.ts';
import { ResourceScheduler } from './resource-scheduler.ts';
import { writeFakeAudioCpp, type FakeAudioCpp, type FakeAudioCppControl, type FakeAudioCppRecord } from './testing/fake-tools.ts';

/**
 * 本地语音合成走完整条路（架构设计 §6.1、§6.5）：ModelServices 选择 `local` 的合成模型，JobManager 在提交时冻结声音，
 * `LocalSpeechProvider` 起 audio.cpp 的常驻服务、发合成请求，输出按生成任务的规则校验与发布。服务是假的（一个按同样的配置文件
 * 监听、按同样的 HTTP 接口回 WAV 的脚本），ffmpeg 也是假的（原样复制参考录音）；模型包是测试用的，特性借真实模型包的。
 */

const real = (id: string) => SPEECH_BUNDLES.find((b) => b.bundleId === id)!;
const speechBundle = (bundleId: string, like: string): BundleDefinition => ({
  ...real(like),
  bundleId,
  label: bundleId,
  components: { tts: { family: real(like).components.tts!.family, repo: `test/${bundleId.split('@')[0]}`, revision: 'r' } },
});
const CLONE = 'clone@audio-cpp';
const SPEAKERS = 'speakers@audio-cpp';
const FISH = 'fish@audio-cpp';
const BUNDLES: BundleDefinition[] = [
  speechBundle(CLONE, 'qwen3-tts-0.6b-base@audio-cpp-q8'),
  speechBundle(SPEAKERS, 'qwen3-tts-1.7b-customvoice@audio-cpp-q8'),
  speechBundle(FISH, 'fish-s2-pro@audio-cpp-q8'),
];
const ggufContent = (bundle: BundleDefinition) => `weights of ${bundle.bundleId}`;

/** 假的 ffmpeg：把 `-i file:<输入>` 原样复制到最后一个参数 `file:<输出>`；读不出时失败。 */
const FAKE_FFMPEG = `
const fs = require('node:fs');
const args = process.argv.slice(2);
const strip = (arg) => arg.replace(/^file:/, '');
try { fs.copyFileSync(strip(args[args.indexOf('-i') + 1]), strip(args[args.length - 1])); }
catch (error) { process.stderr.write(String(error)); process.exit(1); }
`;

async function writeScript(dir: string, name: string, source: string): Promise<string> {
  await fs.writeFile(path.join(dir, `${name}.cjs`), source);
  const wrapper = path.join(dir, name);
  await fs.writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, `${name}.cjs`)}" "$@"\n`, { mode: 0o755 });
  return wrapper;
}

async function writeRepo(root: string, bundle: BundleDefinition): Promise<void> {
  const source = bundle.components.tts!;
  const dir = path.join(root, ...source.repo.split('/'));
  const file = bundle.speech!.engine.file;
  await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  const content = ggufContent(bundle);
  await fs.writeFile(path.join(dir, file), content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo: source.repo, revision: source.revision, files: [{ path: file, size: content.length, sha256 }] }),
  );
}

class FakeVideos implements JobVideos {
  applied: Array<{ commandId: string; expectedRevision: string; operations: EditOperation[] }> = [];
  retain(): void {}
  release(): void {}
  async source(): Promise<never> {
    throw new RpcError('not-found', '没有素材');
  }
  current() {
    return null;
  }
  videoRevision() {
    return null;
  }
  async apply(): Promise<never> {
    throw new Error('不用');
  }
}

type Recorded = FakeAudioCppRecord;

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform === 'win32')('本地语音合成（假 audio.cpp 服务）', () => {
  let dir: string;
  let fake: FakeAudioCpp;
  let engine: string | null;
  /** 参考录音转换用的 ffmpeg；默认是上面那个假的，测外部工具缺失时换成找不到的路径。 */
  let ffmpeg: string;
  let catalog: ModelCatalog;
  let services: ModelServices;
  let provider: LocalSpeechProvider;
  let library: LibraryStore;
  let manager: JobManager;
  let scheduler: ResourceScheduler;
  let probed: string[];
  const submitter: JobSubmitter = { kind: 'connection', id: 'conn_1' };

  const control = (value: FakeAudioCppControl) => fake.control(value);
  const recorded = (kind?: Recorded['kind']) => fake.recorded(kind);
  const requests = async () => (await recorded('request')).map((r) => r.body!);

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-local-speech-'));
    fake = await writeFakeAudioCpp(path.join(dir, 'bin'));
    engine = fake.cli;
    const ffmpegScript = await writeScript(dir, 'ffmpeg', FAKE_FFMPEG);
    ffmpeg = ffmpegScript;
    const models = path.join(dir, 'models');
    for (const bundle of BUNDLES) await writeRepo(models, bundle);
    // 内置清单只给资源调度估计常驻量用。
    const manifests = BUNDLES.map((bundle) => {
      const size = ggufContent(bundle).length;
      const source = bundle.components.tts!;
      return { repo: source.repo, revision: source.revision, files: [{ path: bundle.speech!.engine.file, size, sha256: null }], estimatedBytes: size, provenance: 'test' };
    });
    catalog = new ModelCatalog({ root: models, bundles: BUNDLES, manifests, platform: 'linux', arch: 'x64', engineAvailable: () => true });
    scheduler = new ResourceScheduler({});
    provider = new LocalSpeechProvider({
      catalog,
      engine: () => engine,
      env: async () => process.env,
      ffmpeg: async () => ({ command: ffmpeg, env: process.env }),
      threads: 2,
      resources: scheduler,
      idleMs: 60_000,
      cancelGraceMs: 500,
    });
    const store = await ModelServiceStore.open(
      { modelServicesFile: path.join(dir, 'store', 'model-services.json') },
      new FileCredentialStore(path.join(dir, 'store', 'model-credentials.json')),
    );
    services = new ModelServices({ store, sources: [new LocalProviderSource({ catalog, transcriber: null, speech: provider })] });
    library = await LibraryStore.open({ dir: path.join(dir, 'library'), validateAudio: async () => {} });
    probed = [];
    manager = new JobManager({
      paths: {
        jobsFile: path.join(dir, 'store', 'jobs.jsonl'),
        stagingDir: path.join(dir, 'staging'),
        artifactsDir: path.join(dir, 'artifacts'),
        diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
      },
      catalog,
      router: services,
      videos: new FakeVideos(),
      library,
      resources: scheduler,
      // 解码校验：用自检的 WAV 判定代替 ffprobe（只看能不能解码）。
      probe: async (file) => {
        probed.push(file);
        const verdict = speechSelfTestVerdict(await fs.readFile(file));
        return verdict.wav
          ? { ok: true, media: { kind: 'audio', durationSec: verdict.wav.durationSec, sampleRate: verdict.wav.sampleRate, channels: 1 } }
          : { ok: false, problems: [verdict.passed ? '' : verdict.problem] };
      },
    });
    await manager.open();
  });

  afterEach(async () => {
    await manager.shutdown();
    await provider.close();
    await library.idle();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function speak(request: Partial<SynthesizeSpeechRequest> = {}): Promise<JobRecord> {
    const { jobId } = await manager.submitSynthesizeSpeech({ text: '你好，世界。', provider: 'local', model: CLONE, ...request }, submitter);
    await manager.settled(jobId);
    return manager.inspect(jobId);
  }
  const rejection = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('应当被拒绝');
      },
      (error: RpcError) => error,
    );
  const artifactOf = (job: JobRecord) => fs.readFile(path.join(dir, 'artifacts', `${job.result!.artifactId.replace('sha256:', '')}.wav`));

  it('没有默认值、也不指定：CAPABILITY_NOT_CONFIGURED；设为默认后直接可用；服务只配这一个模型，说话人是 voice_id', async () => {
    const refused = await rejection(manager.submitSynthesizeSpeech({ text: '你好' }, submitter));
    expect(refused.details).toMatchObject({ code: 'CAPABILITY_NOT_CONFIGURED', capability: 'synthesizeSpeech', reason: 'no-default' });
    expect(manager.list()).toEqual([]);

    expect(await services.setDefault('synthesizeSpeech', 'local', SPEAKERS)).toEqual({ providerId: 'local', modelId: SPEAKERS });
    const { jobId } = await manager.submitSynthesizeSpeech({ text: '你好', voice: 'Ryan' }, submitter);
    await manager.settled(jobId);
    const job = manager.inspect(jobId);
    expect(job).toMatchObject({
      state: 'completed',
      providerId: 'local',
      modelId: SPEAKERS,
      bundleId: SPEAKERS,
      generation: { voice: 'Ryan', voiceMode: 'preset', format: 'wav' },
    });
    expect(job.generation).not.toHaveProperty('reference');
    const [start] = await recorded('start');
    const bundle = BUNDLES.find((b) => b.bundleId === SPEAKERS)!;
    expect(start!.args).toEqual(['--config', expect.stringMatching(/server\.json$/), '--no-ui']);
    expect(start!.config).toMatchObject({
      host: '127.0.0.1',
      // 服务不给后端时默认 CUDA：按 `--version` 列出的后端给（假引擎是 `cpu,metal`）。
      backend: 'metal',
      threads: 2,
      lazy_load: false,
      max_loaded_models: 1,
      models: [
        {
          id: 'speech',
          family: 'qwen3_tts',
          path: path.join(dir, 'models', 'test', 'speakers', bundle.speech!.engine.file),
          task: 'tts',
          mode: 'offline',
        },
      ],
    });
    expect(await requests()).toEqual([
      { model: 'speech', input: '你好', options: { text_chunk_size: bundle.speech!.engine.chunkSize, voice_id: 'Ryan' } },
    ]);
  });

  it('内置音色：随应用分发的录音在提交时冻结摘要；服务收到转好的参考与原文，输出过峰值上限后校验发布', async () => {
    const job = await speak({ voice: 'en-female', language: 'en', seed: 7 });
    const voice = builtinVoice('en-female')!;
    const voiceFile = builtinVoiceFile(voice)!;
    const digest = crypto.createHash('sha256').update(await fs.readFile(voiceFile)).digest('hex');
    expect(job).toMatchObject({
      state: 'completed',
      kind: 'synthesizeSpeech',
      bundleId: CLONE,
      progress: { done: 1, total: 1 },
      generation: {
        capability: 'synthesizeSpeech',
        voice: 'en-female',
        voiceMode: 'preset',
        language: 'en',
        seed: 7,
        reference: { source: 'builtin', path: voiceFile, sha256: `sha256:${digest}`, transcript: voice.transcript },
      },
    });
    const [request] = await recorded('request');
    expect(request).toMatchObject({
      body: {
        voice_ref: expect.stringMatching(/reference\.wav$/),
        reference_text: voice.transcript,
        seed: 7,
        options: { language: 'en' },
      },
      reference: digest,
    });
    expect(job.result!.outputs).toEqual([expect.objectContaining({ mediaType: 'audio/wav', media: expect.objectContaining({ kind: 'audio' }) })]);
    // 服务回的是满幅正弦：发布的结果峰值压到 −1 dBFS，不削波。
    expect(speechSelfTestVerdict(await artifactOf(job))).toMatchObject({
      passed: true,
      wav: { sampleRate: 24_000, durationSec: 1, clippedRatio: 0, peak: expect.closeTo(SPEECH_PEAK_CEILING, 3) },
    });
    expect(probed).toHaveLength(1);
  });

  it('服务常驻：同一个模型包的任务共用一个进程；它持有模型包在调度里的 holder（量按 GGUF 估计，计在内存），卸载后归还', async () => {
    expect((await speak({ voice: 'en-female' })).state).toBe('completed');
    expect((await speak({ voice: 'zh-male' })).state).toBe('completed');
    const starts = await recorded('start');
    expect(starts).toHaveLength(1);
    expect(new Set((await recorded('request')).map((r) => r.pid))).toEqual(new Set([starts[0]!.pid]));
    expect(await catalog.status(CLONE)).toMatchObject({ state: 'ready' });
    const bytes = Math.ceil(ggufContent(BUNDLES[0]!).length * 1.5);
    expect(scheduler.snapshot().holders).toMatchObject([
      { holder: modelWorkerHolder(CLONE), demand: modelWorkerDemand({ bytes, pool: 'memory' }) },
    ]);
    expect(await provider.unload(CLONE)).toBe(true);
    expect(alive(starts[0]!.pid)).toBe(false);
    expect(scheduler.snapshot().holders).toEqual([]);
    expect(await catalog.status(CLONE)).toMatchObject({ state: 'installed' });
    // 下次用时再起。
    expect((await speak({ voice: 'en-female' })).state).toBe('completed');
    expect(await recorded('start')).toHaveLength(2);
  });

  it('用文件克隆：提交时冻结；执行前文件变了就失败（ASSET_MISSING），不换声音', async () => {
    const ref = path.join(dir, 'ref.wav');
    await fs.copyFile(builtinVoiceFile(builtinVoice('zh-male')!)!, ref);
    const size = (await fs.stat(ref)).size;
    const job = await speak({ reference: { file: ref, transcript: '我的声音' } });
    expect(job).toMatchObject({
      state: 'completed',
      generation: { voice: 'reference', voiceMode: 'clone', reference: { source: 'file', path: ref, transcript: '我的声音', byteLength: size } },
    });
    expect((await requests())[0]).toMatchObject({ reference_text: '我的声音' });
    // 导入视频的出处不记参考录音的本机路径（§6.1、§7.3）。
    const imported = generatedImportOperation(job, { artifactId: 'art_1', file: path.join(dir, 'out.wav'), index: 0, total: 1 });
    expect(imported).toMatchObject({
      provenance: { source: { parameters: { reference: { source: 'file', byteLength: size, transcript: '我的声音' } } } },
    });
    expect(JSON.stringify(imported)).not.toContain(ref);

    // 提交后、执行前改掉文件：慢的任务占着服务，第二个任务排在后面。
    await control({ slowMs: 1000 });
    const first = await manager.submitSynthesizeSpeech({ text: '一', provider: 'local', model: CLONE }, submitter);
    const second = await manager.submitSynthesizeSpeech({ text: '二', provider: 'local', model: CLONE, reference: { file: ref } }, submitter);
    await fs.writeFile(ref, 'someone else');
    await manager.settled(first.jobId);
    await manager.settled(second.jobId);
    expect(manager.inspect(second.jobId)).toMatchObject({ state: 'failed', error: { code: 'ASSET_MISSING' } });
    expect((await requests()).filter((r) => r.input === '二')).toEqual([]);
  });

  it('Qwen3-TTS Base 克隆没有原文时只用说话人向量', async () => {
    const ref = path.join(dir, 'bare.wav');
    await fs.copyFile(builtinVoiceFile(builtinVoice('zh-male')!)!, ref);
    expect((await speak({ reference: { file: ref } })).state).toBe('completed');
    const [body] = await requests();
    expect(body).not.toHaveProperty('reference_text');
    expect(body!.options).toMatchObject({ x_vector_only_mode: true });
  });

  it('Fish 克隆在提交时检查音色库原文，内置音色会冻结自带原文；服务按 clon 任务配置', async () => {
    const ref = path.join(dir, 'fish-ref.wav');
    await fs.copyFile(builtinVoiceFile(builtinVoice('zh-male')!)!, ref);
    const voice = (
      await library.put({
        library: 'voices',
        content: { name: 'Fish test', language: null, transcript: '', origin: 'recorded', consent: { declared: true, statement: 'test' } },
        file: { path: ref },
      })
    ).entry;
    const error = await rejection(manager.submitSynthesizeSpeech({ text: 'Hello', provider: 'local', model: FISH, voice: `library:${voice.id}` }, submitter));
    expect(error).toMatchObject({ code: 'invalid-request', details: { reason: 'reference-transcript-required' } });
    const job = await speak({ model: FISH });
    expect(job).toMatchObject({ state: 'completed', generation: { reference: { source: 'builtin', transcript: expect.any(String) } } });
    expect((await recorded('start'))[0]!.config!.models[0]).toMatchObject({ family: 'fish_audio', task: 'clon' });
    expect((await requests())[0]).toMatchObject({ reference_text: expect.any(String), options: {} });
  });

  it('Fish 带原文的参考录音超过 30 秒：任务失败，不发请求', async () => {
    const ref = path.join(dir, 'long.wav');
    const rate = 8000;
    const data = Buffer.alloc(31 * rate * 2);
    for (let i = 0; i < data.length / 2; i++) data.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    await fs.writeFile(ref, Buffer.concat([header, data]));
    const job = await speak({ model: FISH, reference: { file: ref, transcript: 'Hello' } });
    expect(job).toMatchObject({ state: 'failed', error: { code: 'PROVIDER_REJECTED', details: expect.objectContaining({ reason: 'reference-duration' }) } });
    expect(job.error!.message).toContain('30');
    expect(await requests()).toEqual([]);
  });

  it('音色库条目：直接用它的参考录音，任务冻结条目的版本', async () => {
    const ref = path.join(dir, 'lib.wav');
    await fs.copyFile(builtinVoiceFile(builtinVoice('zh-male')!)!, ref);
    const content = { name: '我', language: null, transcript: '你好', origin: 'recorded' as const, consent: { declared: true, statement: '本人' } };
    const voice = (await library.put({ library: 'voices', content, file: { path: ref } })).entry;
    const job = await speak({ voice: `library:${voice.id}` });
    expect(job).toMatchObject({
      state: 'completed',
      generation: {
        voice: `library:${voice.id}`,
        voiceMode: 'clone',
        reference: { source: 'library', sha256: voice.content.reference.sha256, transcript: '你好' },
      },
      library: { entries: [{ library: 'voices', id: voice.id, version: 1, contentHash: voice.contentHash }] },
    });
    expect((await requests())[0]).toMatchObject({ reference_text: '你好' });
  });

  it('音色库条目的种子：请求的 seed 优先，其次这个模型的种子、兜底种子，都没有时抽一个并冻结', async () => {
    const ref = path.join(dir, 'seeded.wav');
    await fs.copyFile(builtinVoiceFile(builtinVoice('zh-male')!)!, ref);
    const content = { name: '种子', language: null, transcript: '你好', origin: 'recorded' as const, consent: { declared: true, statement: '本人' } };
    const voice = (
      await library.put({ library: 'voices', content: { ...content, seed: 99, seeds: { [CLONE]: 123, 'other@cpu': 5 } }, file: { path: ref } })
    ).entry;
    const perModel = await speak({ voice: `library:${voice.id}` });
    expect(perModel.generation).toMatchObject({ seed: 123 });
    expect((await requests()).at(-1)).toMatchObject({ seed: 123 });
    expect((await speak({ voice: `library:${voice.id}`, seed: 7 })).generation).toMatchObject({ seed: 7 });

    await library.put({ library: 'voices', id: voice.id, content: { ...content, seeds: { 'other@cpu': 5 } } });
    expect((await speak({ voice: `library:${voice.id}` })).generation).toMatchObject({ seed: 99 });

    const plain = (await library.put({ library: 'voices', content, file: { path: ref } })).entry;
    const drawn = await speak({ voice: `library:${plain.id}` });
    const seed = (drawn.generation as { seed: number | null }).seed;
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
    expect((await requests()).at(-1)).toMatchObject({ seed });
  });

  it('模型做不到的方式在提交时拒绝，不创建任务、不起服务', async () => {
    for (const request of [
      { model: SPEAKERS, reference: { file: path.join(dir, 'x.wav') } },
      { voiceDescription: 'calm' },
      { voice: 'Vivian' },
      { cfg: 2 },
      { format: 'mp3' as const },
      { reference: { file: path.join(dir, 'missing.wav') } },
    ]) {
      expect((await rejection(manager.submitSynthesizeSpeech({ text: '你好', provider: 'local', model: CLONE, ...request }, submitter))).code).toBe(
        'invalid-request',
      );
    }
    expect(manager.list()).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  it('读不出的参考录音：用户给的文件是 INPUT_UNREADABLE（句子点名文件）；随应用分发的录音是 APP_FILE_MISSING（重新安装，句子里没有路径）', async () => {
    const missing = path.join(dir, 'gone', 'my-voice.wav');
    const refused = await rejection(manager.submitSynthesizeSpeech({ text: '你好', provider: 'local', model: CLONE, reference: { file: missing } }, submitter));
    expect(refused).toMatchObject({ code: 'invalid-request', details: { code: 'INPUT_UNREADABLE', reference: 'file', file: missing } });
    expect(refused.message).toContain('「my-voice.wav」');
    expect(refused.message).not.toContain(dir);

    // 模型数据目录是空的：内置音色的录音不在，安装不完整。
    const empty = path.join(dir, 'empty-assets');
    await fs.mkdir(empty);
    const saved = process.env[MODEL_ASSETS_ENV];
    process.env[MODEL_ASSETS_ENV] = empty;
    try {
      const builtin = await rejection(
        manager.submitSynthesizeSpeech({ text: '你好', provider: 'local', model: CLONE, voice: 'en-female', language: 'en' }, submitter),
      );
      expect(builtin).toMatchObject({
        code: 'conflict',
        details: { code: 'APP_FILE_MISSING', asset: 'tts-voices/en-female.wav', file: path.join(empty, 'tts-voices', 'en-female.wav') },
      });
      expect(builtin.message).toContain('重新安装 BaoCut');
      expect(builtin.message).not.toContain(empty);
    } finally {
      if (saved === undefined) delete process.env[MODEL_ASSETS_ENV];
      else process.env[MODEL_ASSETS_ENV] = saved;
    }
    expect(manager.list()).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  it('内置音色的录音在提交后、执行前不见了：任务以 APP_FILE_MISSING 失败（不是 ASSET_MISSING），不换声音', async () => {
    const assets = path.join(dir, 'assets');
    await fs.mkdir(path.join(assets, 'tts-voices'), { recursive: true });
    const voiceFile = path.join(assets, 'tts-voices', 'en-female.wav');
    await fs.copyFile(builtinVoiceFile(builtinVoice('en-female')!)!, voiceFile);
    const saved = process.env[MODEL_ASSETS_ENV];
    process.env[MODEL_ASSETS_ENV] = assets;
    try {
      // 慢的任务占着服务，第二个任务排在后面。
      await control({ slowMs: 1000 });
      const first = await manager.submitSynthesizeSpeech({ text: '一', provider: 'local', model: SPEAKERS }, submitter);
      const second = await manager.submitSynthesizeSpeech({ text: '二', provider: 'local', model: CLONE, voice: 'en-female', language: 'en' }, submitter);
      await fs.rm(voiceFile);
      await manager.settled(first.jobId);
      await manager.settled(second.jobId);
      const failed = manager.inspect(second.jobId);
      expect(failed).toMatchObject({ state: 'failed', error: { code: 'APP_FILE_MISSING', details: expect.objectContaining({ file: voiceFile }) } });
      expect(failed.error!.message).toContain('重新安装 BaoCut');
      expect(failed.error!.message).not.toContain(assets);
      expect((await requests()).filter((r) => r.input === '二')).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env[MODEL_ASSETS_ENV];
      else process.env[MODEL_ASSETS_ENV] = saved;
    }
  });

  it('ffmpeg 找不到：MEDIA_TOOL_UNAVAILABLE（说安装 ffmpeg），不误报成录音读不出来、也不说成安装不完整', async () => {
    // 参考录音要经 ffmpeg 转成引擎读的 WAV：这台机器上没有能用的 ffmpeg 时，是外部工具的问题。
    ffmpeg = path.join(dir, 'no-such-tools', 'ffmpeg');
    const job = await speak({ voice: 'en-female', language: 'en' });
    expect(job).toMatchObject({
      state: 'failed',
      error: { code: 'MEDIA_TOOL_UNAVAILABLE', details: { tool: 'ffmpeg', remedy: expect.stringContaining('ffmpeg') } },
    });
    expect(job.error!.message).toContain('ffmpeg');
    expect(job.error!.message).not.toContain('重新安装 BaoCut');
    expect(job.error!.messageRef).toBeDefined();
    // 转换在起服务之前：一个请求都没发出去，服务也没起。
    expect(await recorded('start')).toEqual([]);
    expect(await requests()).toEqual([]);
  });

  it('念不了的读音标注：按表面文字合成，任务照常完成，逐条带 reading-dropped 警告', async () => {
    const job = await speak({ text: '银<行|hang2>门口', voice: 'en-female' });
    expect(job.state).toBe('completed');
    expect((await requests())[0]).toMatchObject({ input: '银行门口' });
    expect(job.warnings).toEqual([
      { code: 'reading-dropped', detail: expect.stringContaining('hang2'), detailRef: expect.objectContaining({ key: 'jobsLocalProvider.readingDroppedOne' }) },
    ]);
  });

  it('找不到内置引擎：MODEL_LOAD_FAILED（unsupported），不起服务', async () => {
    engine = null;
    const job = await speak({ voice: 'en-female' });
    expect(job).toMatchObject({ state: 'failed', error: { code: 'MODEL_LOAD_FAILED', details: expect.objectContaining({ reason: 'unsupported' }) } });
    expect(job.error!.message).toContain('audio.cpp');
    expect(await recorded()).toEqual([]);
  });

  it('模型描述按服务会用的后端提示耗时：CPU 时每个合成模型带 notes，显卡不带；找不到引擎时不知道后端，也不带', async () => {
    const modelsOf = async (speech: LocalSpeechProvider) => {
      const source = new LocalProviderSource({ catalog, transcriber: null, speech, speechBackend: () => speech.backend() });
      return (await source.describe('local', 'view'))!.capabilities.synthesizeSpeech!.models;
    };
    // 假服务的构建编进了 cpu 与 metal：按构建选是 metal。
    expect(await provider.backend()).toBe('metal');
    expect((await modelsOf(provider)).map((m) => m.notes)).toEqual(BUNDLES.map(() => undefined));
    const cpu = new LocalSpeechProvider({ catalog, engine: () => engine, env: async () => process.env, ffmpeg: async () => ({ command: 'ffmpeg', env: process.env }), backend: 'cpu' });
    expect(await cpu.backend()).toBe('cpu');
    const models = await modelsOf(cpu);
    expect(models.length).toBe(BUNDLES.length);
    for (const model of models) expect(model.notes, model.modelId).toContain('CPU');
    engine = null;
    expect(await provider.backend()).toBeNull();
    expect((await modelsOf(provider)).map((m) => m.notes)).toEqual(BUNDLES.map(() => undefined));
    await cpu.close();
  });

  it('服务启动时退出：MODEL_LOAD_FAILED，带输出的尾巴；问题解决后下次再起', async () => {
    await control({ startExit: 'cannot open model' });
    const job = await speak({ voice: 'en-female' });
    expect(job).toMatchObject({ state: 'failed', error: { code: 'MODEL_LOAD_FAILED' } });
    expect(job.error!.message).toContain('cannot open model');
    expect(await requests()).toEqual([]);
    await until(() => scheduler.snapshot().holders.length === 0);
    await control({});
    expect((await speak({ voice: 'en-female' })).state).toBe('completed');
    expect(await recorded('start')).toHaveLength(2);
  });

  it('服务拒绝请求：PROVIDER_REJECTED，带 HTTP 状态与引擎给的原因；服务照常留着', async () => {
    await control({ reject: { status: 400, message: 'unknown voice' } });
    const job = await speak({ voice: 'en-female' });
    expect(job).toMatchObject({ state: 'failed', error: { code: 'PROVIDER_REJECTED', details: expect.objectContaining({ status: 400 }) } });
    expect(job.error!.message).toMatch(/400/);
    expect(job.error!.message).toContain('unknown voice');
    const [start] = await recorded('start');
    expect(alive(start!.pid)).toBe(true);
  });

  it('返回的不是 WAV：MODEL_OUTPUT_INVALID', async () => {
    await control({ notWav: true });
    expect(await speak({ voice: 'en-female' })).toMatchObject({ state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } });
  });

  it('合成时服务退出：MODEL_WORKER_CRASHED（生成任务不自动重试）；下次新起一个服务', async () => {
    await control({ crash: 'out of memory' });
    const job = await speak({ voice: 'en-female' });
    expect(job).toMatchObject({ state: 'failed', error: { code: 'MODEL_WORKER_CRASHED' } });
    expect(job.error!.message).toContain('out of memory');
    // 服务退出时归还它那一份；任务的租约在任务结束后归还。
    await until(() => scheduler.snapshot().holders.length === 0);
    await control({});
    expect((await speak({ voice: 'en-female' })).state).toBe('completed');
    expect(await recorded('start')).toHaveLength(2);
  });

  it('取消：结束服务进程，归还 holder；正在合成时不卸载', async () => {
    await control({ slowMs: 30_000 });
    const { jobId } = await manager.submitSynthesizeSpeech({ text: '你好', provider: 'local', model: CLONE, voice: 'en-female' }, submitter);
    await until(async () => (await recorded('request')).length === 1);
    expect(await provider.unload(CLONE)).toBe(false);
    const [start] = await recorded('start');
    await manager.cancel(jobId);
    await manager.settled(jobId);
    expect(manager.inspect(jobId).state).toBe('cancelled');
    await until(() => !alive(start!.pid));
    await until(() => scheduler.snapshot().holders.length === 0);
  });

  it('输出是静音：解码校验照常通过（静音也是合法 WAV），由自检判定不通过', async () => {
    await control({ silent: true });
    const job = await speak({ voice: 'en-female' });
    expect(job.state).toBe('completed');
    expect(speechSelfTestVerdict(await artifactOf(job))).toMatchObject({ passed: false, problem: '输出是静音' });
  });
});
