import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalSpeechProvider, PipelineStepError, writeFakeAudioCpp, type DubSpeech, type DubVoice, type FakeAudioCpp } from '@baocut/jobs';
import {
  LocalProviderSource,
  MANIFEST_FILE,
  MODEL_ASSETS_ENV,
  ModelCatalog,
  ModelServiceStore,
  ModelServices,
  SPEECH_BUNDLES,
  builtinVoice,
  builtinVoiceFile,
  type BundleDefinition,
} from '@baocut/models';
import { formatRef, type RpcError } from '@baocut/protocol';
import { FileCredentialStore } from '@baocut/runtime-storage';
import { LibraryStore } from '@baocut/runtime-storage/library';
import type { GrantService } from '../grants/grant-service.ts';
import { dubSpeech } from './dub-speech.ts';

/**
 * 配音的逐句合成用本地克隆模型（架构设计 §5.9、§6.1、§7.9）：内置音色是随应用分发的一段录音，音色库的音色直接用条目的参考录音
 * （不要克隆，也不要本人声明）；启动时读出摘要冻结，逐句的调用共用这一份，执行前由本地 Provider 按摘要再核对；录音读不出是
 * `APP_FILE_MISSING`，变了的不换声音。音色库的音色的种子随音色冻结，逐句同一颗。服务是假的 audio.cpp（按同样的 HTTP 接口
 * 回 WAV），ffmpeg 也是假的（原样复制参考录音）；模型包是测试用的，特性借真实模型包的。
 */

const real = (id: string) => SPEECH_BUNDLES.find((b) => b.bundleId === id)!;
const CLONE = 'clone@audio-cpp';
const BUNDLE: BundleDefinition = {
  ...real('qwen3-tts-0.6b-base@audio-cpp-q8'),
  bundleId: CLONE,
  label: CLONE,
  components: { tts: { family: real('qwen3-tts-0.6b-base@audio-cpp-q8').components.tts!.family, repo: 'test/clone', revision: 'r' } },
};
const WEIGHTS = `weights of ${CLONE}`;

/** 假的 ffmpeg：把 `-i file:<输入>` 原样复制到最后一个参数 `file:<输出>`；读不出时失败。 */
const FAKE_FFMPEG = `
const fs = require('node:fs');
const args = process.argv.slice(2);
const strip = (arg) => arg.replace(/^file:/, '');
try { fs.copyFileSync(strip(args[args.indexOf('-i') + 1]), strip(args[args.length - 1])); }
catch (error) { process.stderr.write(String(error)); process.exit(1); }
`;

const sha256 = async (file: string) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

describe.skipIf(process.platform === 'win32')('配音的逐句合成：本地克隆模型的内置音色', () => {
  let dir: string;
  let fake: FakeAudioCpp;
  /** 参考录音转换用的 ffmpeg；默认是上面那个假的，测外部工具缺失时换成找不到的路径。 */
  let ffmpeg: string;
  let provider: LocalSpeechProvider;
  let speech: DubSpeech;
  let library: LibraryStore;
  let savedAssets: string | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-dub-local-'));
    savedAssets = process.env[MODEL_ASSETS_ENV];
    fake = await writeFakeAudioCpp(path.join(dir, 'bin'));
    await fs.writeFile(path.join(dir, 'ffmpeg.cjs'), FAKE_FFMPEG);
    ffmpeg = path.join(dir, 'ffmpeg');
    await fs.writeFile(ffmpeg, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'ffmpeg.cjs')}" "$@"\n`, { mode: 0o755 });

    const models = path.join(dir, 'models');
    const weights = path.join(models, 'test', 'clone', BUNDLE.speech!.engine.file);
    await fs.mkdir(path.dirname(weights), { recursive: true });
    await fs.writeFile(weights, WEIGHTS);
    await fs.writeFile(
      path.join(models, 'test', 'clone', MANIFEST_FILE),
      JSON.stringify({
        format_version: 1,
        repo: 'test/clone',
        revision: 'r',
        files: [{ path: BUNDLE.speech!.engine.file, size: WEIGHTS.length, sha256: crypto.createHash('sha256').update(WEIGHTS).digest('hex') }],
      }),
    );
    const catalog = new ModelCatalog({
      root: models,
      bundles: [BUNDLE],
      manifests: [
        {
          repo: 'test/clone',
          revision: 'r',
          files: [{ path: BUNDLE.speech!.engine.file, size: WEIGHTS.length, sha256: null }],
          estimatedBytes: WEIGHTS.length,
          provenance: 'test',
        },
      ],
      platform: 'linux',
      arch: 'x64',
      engineAvailable: () => true,
    });
    provider = new LocalSpeechProvider({
      catalog,
      engine: () => fake.cli,
      env: async () => process.env,
      ffmpeg: async () => ({ command: ffmpeg, env: process.env }),
      threads: 2,
      idleMs: 60_000,
      cancelGraceMs: 500,
    });
    const store = await ModelServiceStore.open(
      { modelServicesFile: path.join(dir, 'store', 'model-services.json') },
      new FileCredentialStore(path.join(dir, 'store', 'model-credentials.json')),
    );
    const services = new ModelServices({ store, sources: [new LocalProviderSource({ catalog, transcriber: null, speech: provider })] });
    library = await LibraryStore.open({ dir: path.join(dir, 'library'), validateAudio: async () => {} });
    // 本机的 Provider 不经授权：授权服务不该被碰到。
    speech = dubSpeech({ services, grants: {} as GrantService, library });
  });

  afterEach(async () => {
    if (savedAssets === undefined) delete process.env[MODEL_ASSETS_ENV];
    else process.env[MODEL_ASSETS_ENV] = savedAssets;
    await provider.close();
    await library.idle();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const say = (voice: DubVoice, text: string, n: number, seed?: number) =>
    fs.mkdir(path.join(dir, 'staging', String(n)), { recursive: true }).then(() =>
      speech.synthesize({
        voice,
        text,
        language: 'en',
        videoId: 'vid_1',
        jobId: `job_${n}`,
        staging: path.join(dir, 'staging', String(n)),
        signal: new AbortController().signal,
        ...(seed !== undefined ? { seed } : {}),
      }),
    );
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('应当失败');
      },
      (error: unknown) => error,
    );
  /** 内置音色的录音复制到测试自己的模型数据目录，好在中途改它、删它。 */
  const ownAssets = async (voiceId: string) => {
    const assets = path.join(dir, 'assets');
    await fs.mkdir(path.join(assets, 'tts-voices'), { recursive: true });
    const file = path.join(assets, 'tts-voices', `${voiceId}.wav`);
    await fs.copyFile(builtinVoiceFile(builtinVoice(voiceId)!)!, file);
    process.env[MODEL_ASSETS_ENV] = assets;
    return file;
  };

  it('不指定音色：按语言挑内置音色，启动时冻结它的录音；每句都带着这段参考录音与原文', async () => {
    const voice = await speech.prepare({ provider: 'local', model: CLONE, language: 'en' });
    const builtin = builtinVoice(voice.voice)!;
    expect(builtin).toBeTruthy();
    expect(voice).toMatchObject({ providerId: 'local', modelId: CLONE, format: 'wav' });

    const first = await say(voice, 'Hello everyone.', 1);
    const second = await say(voice, 'Today we talk about editing.', 2);
    for (const { file } of [first, second]) expect((await fs.stat(file)).size).toBeGreaterThan(44);

    const digest = await sha256(builtinVoiceFile(builtin)!);
    const requests = await fake.recorded('request');
    expect(requests.map((r) => r.body!.input)).toEqual(['Hello everyone.', 'Today we talk about editing.']);
    for (const request of requests) {
      expect(request).toMatchObject({
        body: { voice_ref: expect.stringMatching(/reference\.wav$/), reference_text: builtin.transcript, options: { language: 'en' } },
        reference: digest,
      });
    }
  });

  it('逐句共用同一份冻结的录音：两句之间录音变了，后一句失败、不换声音；不见了是 APP_FILE_MISSING', async () => {
    const file = await ownAssets('en-female');
    // 流程把启动时的音色冻结进参数（复制过的对象）：第一句冻结录音，之后的句子共用。
    const voice = structuredClone(await speech.prepare({ provider: 'local', model: CLONE, voice: 'en-female', language: 'en' }));
    await say(voice, 'Hello everyone.', 1);

    await fs.writeFile(file, Buffer.concat([await fs.readFile(file), Buffer.from('changed')]));
    const changed = await failure(say(voice, 'Today we talk about editing.', 2));
    expect(changed).toBeInstanceOf(PipelineStepError);
    expect(changed).toMatchObject({ code: 'ASSET_MISSING', details: { file } });

    await fs.rm(file);
    const missing = await failure(say(voice, 'This is the third one.', 3));
    expect(missing).toMatchObject({ code: 'APP_FILE_MISSING', details: expect.objectContaining({ file }) });
    expect((missing as Error).message).toContain('重新安装 BaoCut');
    expect((missing as Error).message).not.toContain(dir);

    expect((await fake.recorded('request')).map((r) => r.body!.input)).toEqual(['Hello everyone.']);
  });

  it('随应用分发的录音读不出：启动即拒绝（APP_FILE_MISSING，句子里没有路径），不起服务', async () => {
    const empty = path.join(dir, 'empty-assets');
    await fs.mkdir(empty);
    process.env[MODEL_ASSETS_ENV] = empty;
    const refused = (await failure(speech.prepare({ provider: 'local', model: CLONE, voice: 'en-female', language: 'en' }))) as RpcError;
    expect(refused).toMatchObject({
      code: 'conflict',
      details: { code: 'APP_FILE_MISSING', asset: 'tts-voices/en-female.wav', file: path.join(empty, 'tts-voices', 'en-female.wav') },
    });
    expect(refused.message).toContain('重新安装 BaoCut');
    expect(refused.message).not.toContain(empty);
    expect(await fake.recorded()).toEqual([]);
  });

  it('没有能用的 ffmpeg：这一句以 MEDIA_TOOL_UNAVAILABLE 失败，存下的说明按读者的语言重新生成', async () => {
    const voice = await speech.prepare({ provider: 'local', model: CLONE, voice: 'en-female', language: 'en' });
    ffmpeg = path.join(dir, 'no-such-tools', 'ffmpeg');
    const failed = await failure(say(voice, 'Hello everyone.', 1));
    expect(failed).toBeInstanceOf(PipelineStepError);
    const error = failed as PipelineStepError;
    expect(error).toMatchObject({ code: 'MEDIA_TOOL_UNAVAILABLE', details: { providerId: 'local', tool: 'ffmpeg' } });
    // 这一步失败存下的说明带着 Provider 的消息引用：换一种语言重新生成时整句都换，不残留生成时那种语言的一段。
    expect(error.messageRef).toBeDefined();
    const english = formatRef(error.messageRef!, error.message, 'en');
    expect(english).toContain("Can't find");
    expect(english).toContain('Install ffmpeg');
    expect(english).not.toContain('安装');
    expect(await fake.recorded('request')).toEqual([]);
  });

  /** 音色库里的一个音色：参考录音借内置音色的，没有本人声明（本地合成不上传，用不着）。 */
  const libraryVoice = async (seeds: { seed?: number; seeds?: Record<string, number> } = {}) => {
    const ref = path.join(dir, `lib-${crypto.randomUUID()}.wav`);
    await fs.copyFile(builtinVoiceFile(builtinVoice('zh-male')!)!, ref);
    const content = { name: '我', language: null, transcript: '你好', origin: 'recorded' as const, consent: { declared: false, statement: null } };
    return (await library.put({ library: 'voices', content: { ...content, ...seeds }, file: { path: ref } })).entry;
  };

  it('音色库的音色：直接用条目的参考录音，不要克隆与本人声明；种子取这个模型记的，冻结进音色，逐句同一颗；句级重配的种子优先', async () => {
    const entry = await libraryVoice({ seed: 99, seeds: { [CLONE]: 123, 'other@cpu': 5 } });
    const voice = structuredClone(await speech.prepare({ provider: 'local', model: CLONE, voice: `library:${entry.id}`, language: 'en' }));
    expect(voice).toMatchObject({ providerId: 'local', modelId: CLONE, voice: `library:${entry.id}`, format: 'wav', seed: 123 });

    await say(voice, 'Hello everyone.', 1);
    await say(voice, 'Today we talk about editing.', 2);
    await say(voice, 'This is the third one.', 3, 7);
    const requests = await fake.recorded('request');
    expect(requests.map((r) => [r.body!.input, r.body!.seed])).toEqual([
      ['Hello everyone.', 123],
      ['Today we talk about editing.', 123],
      ['This is the third one.', 7],
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({ body: { reference_text: '你好' }, reference: entry.content.reference.sha256.replace(/^sha256:/, '') });
    }
  });

  it('音色没有记种子：启动时抽一颗冻结进音色，逐句同一颗；库里删了：启动与合成都是 VOICE_NOT_FOUND', async () => {
    const entry = await libraryVoice();
    const voice = structuredClone(await speech.prepare({ provider: 'local', model: CLONE, voice: `library:${entry.id}`, language: 'en' }));
    expect(Number.isInteger(voice.seed)).toBe(true);
    expect(voice.seed).toBeGreaterThanOrEqual(0);
    expect(voice.seed).toBeLessThan(2 ** 32);
    await say(voice, 'Hello everyone.', 1);
    await say(voice, 'Today we talk about editing.', 2);
    expect((await fake.recorded('request')).map((r) => r.body!.seed)).toEqual([voice.seed, voice.seed]);

    await library.remove('voices', entry.id);
    const gone = await failure(say(voice, 'This is the third one.', 3));
    expect(gone).toBeInstanceOf(PipelineStepError);
    expect(gone).toMatchObject({ code: 'VOICE_NOT_FOUND' });
    expect(await fake.recorded('request')).toHaveLength(2);
    const refused = (await failure(speech.prepare({ provider: 'local', model: CLONE, voice: `library:${entry.id}`, language: 'en' }))) as RpcError;
    expect(refused).toMatchObject({ code: 'not-found', details: { code: 'VOICE_NOT_FOUND', library: 'voices', reason: 'removed' } });
  });
});
