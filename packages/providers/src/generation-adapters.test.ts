import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelServiceStore, ProviderFailure, type GenerationRun, type ImageParameters, type SpeechParameters } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import type { AdapterConfig, ImageAdapter, SpeechAdapter } from './adapter.ts';
import { ElevenLabsAdapter } from './elevenlabs/elevenlabs-adapter.ts';
import { GoogleImageAdapter, parseImageInteraction } from './google/google-image.ts';
import { ProviderAborted } from './http/provider-fetch.ts';
import { OnlineGenerator } from './online-generator.ts';
import { OnlineProviderSource } from './online-source.ts';
import { CompatibleImageAdapter, CompatibleSpeechAdapter } from './openai-compatible/compatible-media.ts';
import { OpenAiImageAdapter, OpenAiSpeechAdapter } from './openai/openai-media-adapters.ts';
import {
  fakeElevenLabsHandler,
  fakeGoogleHandler,
  fakeOpenAiHandler,
  mp3Fixture,
  pngFixture,
  startFakeProviderServer,
  wavFixture,
  type FakeProviderServer,
} from './testing/fake-provider-server.ts';

/**
 * 生成类适配器（架构设计 §6.4）对着本机的假供应商：请求形状、响应解析、错误分类与密钥卫生。从不连接真实的云服务；
 * 密钥是这里编的字符串。
 */

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-0123456789abcdef';
const GOOGLE_KEY = 'AIzaTESTONLY-0123456789abcdefghijklmn';
const ELEVENLABS_KEY = 'sk_test_ONLY_FOR_TESTS_0123456789abcdef';
const http = { backoffMs: () => 1, timeoutMs: 5_000 };

let server: FakeProviderServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function config(base: string, credential: string | null, declared: AdapterConfig['declared'] = []): AdapterConfig {
  return { providerId: 'test', baseUrl: base, credential, declared };
}

function speech(overrides: Partial<SpeechParameters> = {}): SpeechParameters {
  return {
    capability: 'synthesizeSpeech',
    text: 'hello',
    voice: 'marin',
    language: null,
    format: 'mp3',
    instructions: null,
    speed: null,
    seed: null,
    ...overrides,
  };
}

function image(overrides: Partial<ImageParameters> = {}): ImageParameters {
  return { capability: 'generateImage', prompt: 'a fox', size: null, aspectRatio: null, count: 1, format: 'png', seed: null, ...overrides };
}

function synthesize(
  adapter: SpeechAdapter,
  cfg: AdapterConfig,
  modelId: string,
  parameters: SpeechParameters,
  signal = new AbortController().signal,
) {
  const model = adapter.models(cfg).find((m) => m.modelId === modelId)!;
  return adapter.synthesize({ config: cfg, model, parameters, signal, http });
}

function generate(adapter: ImageAdapter, cfg: AdapterConfig, modelId: string, parameters: ImageParameters, progress: number[] = []) {
  const model = adapter.models(cfg).find((m) => m.modelId === modelId)!;
  return adapter.generate({
    config: cfg,
    model,
    parameters,
    signal: new AbortController().signal,
    http,
    progress: (n) => progress.push(n),
  });
}

async function failure(promise: Promise<unknown>): Promise<ProviderFailure> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderFailure);
  return error as ProviderFailure;
}

describe('OpenAI 语音', () => {
  it('模型表：默认 gpt-4o-mini-tts / marin；tts-1 只有 9 个音色、不接受 instructions；都不接受 seed', () => {
    const models = new OpenAiSpeechAdapter().models(config('x', null));
    const byId = Object.fromEntries(models.map((m) => [m.modelId, m]));
    expect(models.find((m) => m.default)).toMatchObject({ modelId: 'gpt-4o-mini-tts', defaultVoice: 'marin', acceptsInstructions: true });
    expect(byId['tts-1']!.voices).toHaveLength(9);
    expect(byId['tts-1']!.voices.some((v) => v.voiceId === 'marin')).toBe(false);
    expect(byId['tts-1']).toMatchObject({ acceptsInstructions: false, voiceModes: ['preset'], maxInputChars: 4096 });
    expect(models.every((m) => !m.acceptsSeed && m.formats.join() === 'mp3,wav,flac')).toBe(true);
  });

  it('请求形状：JSON、Bearer、预置音色是字符串、自定义音色是 { id }；响应体就是音频', async () => {
    server = await startFakeProviderServer(fakeOpenAiHandler());
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    const adapter = new OpenAiSpeechAdapter();
    const out = await synthesize(adapter, cfg, 'gpt-4o-mini-tts', speech({ instructions: 'calm', speed: 0.9 }));
    expect(out.bytes.equals(mp3Fixture())).toBe(true);
    const [request] = server.requests;
    expect(request).toMatchObject({ method: 'POST', path: '/v1/audio/speech' });
    expect(request!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(request!.json).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'hello',
      voice: 'marin',
      response_format: 'mp3',
      instructions: 'calm',
      speed: 0.9,
    });

    await synthesize(adapter, cfg, 'gpt-4o-mini-tts', speech({ voice: 'voice_1234', format: 'wav' }));
    expect(server.requests[1]!.json).toMatchObject({ voice: { id: 'voice_1234' }, response_format: 'wav' });
  });

  it('回 JSON 或空体是协议错误；401 是 PROVIDER_AUTH_FAILED，回显的密钥被去掉', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { ok: true } }));
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    expect((await failure(synthesize(new OpenAiSpeechAdapter(), cfg, 'tts-1', speech({ voice: 'alloy' })))).kind).toBe('protocol');
    server.handler = () => ({ status: 200, bytes: Buffer.alloc(0) });
    expect((await failure(synthesize(new OpenAiSpeechAdapter(), cfg, 'tts-1', speech({ voice: 'alloy' })))).kind).toBe('protocol');
    server.handler = () => ({ status: 401, json: { error: { message: `bad key ${OPENAI_KEY}` } } });
    const auth = await failure(synthesize(new OpenAiSpeechAdapter(), cfg, 'tts-1', speech({ voice: 'alloy' })));
    expect(auth.details.code).toBe('PROVIDER_AUTH_FAILED');
    expect(JSON.stringify({ message: auth.message, details: auth.details })).not.toContain(OPENAI_KEY);
  });

  it('取消：中止在途请求，抛 ProviderAborted，连接关闭', async () => {
    server = await startFakeProviderServer(() => 'hang');
    const controller = new AbortController();
    const pending = synthesize(
      new OpenAiSpeechAdapter(),
      config(`${server.origin}/v1`, OPENAI_KEY),
      'tts-1',
      speech({ voice: 'alloy' }),
      controller.signal,
    );
    await server.waitForRequests(1);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ProviderAborted);
    await server.waitForClosedEarly(1);
  });
});

describe('OpenAI 图片', () => {
  it('请求 n、size、output_format，不发 response_format；解 b64_json；报告用量', async () => {
    server = await startFakeProviderServer(fakeOpenAiHandler());
    const progress: number[] = [];
    const out = await generate(
      new OpenAiImageAdapter(),
      config(`${server.origin}/v1`, OPENAI_KEY),
      'gpt-image-2',
      image({ count: 3, size: '1536x864', format: 'png' }),
      progress,
    );
    expect(out.images).toHaveLength(3);
    expect(out.images[0]!.equals(pngFixture(16, 9, 0))).toBe(true);
    expect(out.usage).toMatchObject({ total_tokens: 100 });
    expect(progress).toEqual([3]);
    expect(server.requests[0]!.json).toEqual({ model: 'gpt-image-2', prompt: 'a fox', n: 3, size: '1536x864', output_format: 'png' });
  });

  it('张数不对、没有 b64_json：协议错误', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { data: [{ b64_json: 'AAAA' }] } }));
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    expect((await failure(generate(new OpenAiImageAdapter(), cfg, 'gpt-image-1', image({ count: 2 })))).kind).toBe('protocol');
    server.handler = () => ({ status: 200, json: { data: [{ url: 'https://example.invalid/a.png' }] } });
    expect((await failure(generate(new OpenAiImageAdapter(), cfg, 'gpt-image-1', image()))).kind).toBe('protocol');
  });

  it('模型表：gpt-image-2 是默认，宽高比 16:9 对应 1536x864；参考图与 seed 按声明', () => {
    const models = new OpenAiImageAdapter().models(config('x', null));
    const def = models.find((m) => m.default)!;
    expect(def.modelId).toBe('gpt-image-2');
    expect(def.aspectRatios).toContainEqual({ ratio: '16:9', size: '1536x864' });
    expect(models.every((m) => m.maxCount === 10 && m.maxPromptChars === 32_000 && !m.acceptsSeed)).toBe(true);
  });
});

describe('ElevenLabs 语音', () => {
  it('路径带音色与 output_format，密钥在 xi-api-key；multilingual_v2 不发 language_code，v3 发', async () => {
    server = await startFakeProviderServer(fakeElevenLabsHandler());
    const adapter = new ElevenLabsAdapter();
    const cfg = config(`${server.origin}/v1`, ELEVENLABS_KEY);
    const out = await synthesize(adapter, cfg, 'eleven_multilingual_v2', speech({ voice: 'JB/fq', language: 'zh-Hans', seed: 7 }));
    expect(out.bytes.equals(mp3Fixture())).toBe(true);
    const [first] = server.requests;
    expect(first!.path).toBe('/v1/text-to-speech/JB%2Ffq?output_format=mp3_44100_128');
    expect(first!.headers['xi-api-key']).toBe(ELEVENLABS_KEY);
    expect(first!.headers.authorization).toBeUndefined();
    expect(first!.json).toEqual({ text: 'hello', model_id: 'eleven_multilingual_v2', seed: 7 });

    const wav = await synthesize(adapter, cfg, 'eleven_v3', speech({ voice: 'v1', language: 'zh-Hans', format: 'wav' }));
    expect(wav.bytes.equals(wavFixture())).toBe(true);
    expect(server.requests[1]!.path).toBe('/v1/text-to-speech/v1?output_format=wav_24000');
    expect(server.requests[1]!.json).toMatchObject({ language_code: 'zh' });
  });

  it('模型表：音色属于账号（没有预置音色、没有默认音色）；字符上限按模型；不提供 flac', () => {
    const models = new ElevenLabsAdapter().models(config('x', null));
    expect(models.find((m) => m.default)?.modelId).toBe('eleven_multilingual_v2');
    expect(models.every((m) => m.voices.length === 0 && m.defaultVoice === null && m.voiceModes.join() === 'custom')).toBe(true);
    expect(Object.fromEntries(models.map((m) => [m.modelId, m.maxInputChars]))).toEqual({
      eleven_multilingual_v2: 10_000,
      eleven_v4: 10_000,
      eleven_v3: 5_000,
      eleven_flash_v2_5: 40_000,
    });
    expect(models.every((m) => !m.formats.includes('flac') && m.acceptsSeed)).toBe(true);
  });

  it('额度用尽（错误体 quota_exceeded）是 PROVIDER_QUOTA_EXCEEDED；sk_ 形式的密钥不出现在错误里', async () => {
    server = await startFakeProviderServer(() => ({
      status: 401,
      json: { detail: { status: 'quota_exceeded', message: `quota for ${ELEVENLABS_KEY}` } },
    }));
    const error = await failure(
      synthesize(new ElevenLabsAdapter(), config(`${server.origin}/v1`, ELEVENLABS_KEY), 'eleven_v3', speech({ voice: 'v' })),
    );
    expect(error.details.code).toBe('PROVIDER_QUOTA_EXCEEDED');
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(ELEVENLABS_KEY);
  });

  it('验证密钥：GET /models', async () => {
    server = await startFakeProviderServer(fakeElevenLabsHandler());
    await new ElevenLabsAdapter().validateCredential(config(`${server.origin}/v1`, ELEVENLABS_KEY), new AbortController().signal, http);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
  });
});

describe('Google 图片', () => {
  it('尺寸换成宽高比与分辨率；一张一次请求；取 model_output 的图片，不取 thought 的中间图', async () => {
    server = await startFakeProviderServer(fakeGoogleHandler());
    const progress: number[] = [];
    const out = await generate(
      new GoogleImageAdapter(),
      config(`${server.origin}/v1beta`, GOOGLE_KEY),
      'gemini-3-pro-image',
      image({ size: '2752x1536', count: 2, format: 'jpeg' }),
      progress,
    );
    expect(out.images.map((b) => b.equals(pngFixture()))).toEqual([true, true]);
    expect(progress).toEqual([1, 2]);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]!.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    expect(server.requests[0]!.headers['api-revision']).toBe('2026-05-20');
    expect(server.requests[0]!.json).toEqual({
      model: 'gemini-3-pro-image',
      input: [{ type: 'text', text: 'a fox' }],
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '2K' },
    });
  });

  it('不给尺寸时不发宽高比；2.5 只发宽高比', async () => {
    server = await startFakeProviderServer(fakeGoogleHandler());
    const cfg = config(`${server.origin}/v1beta`, GOOGLE_KEY);
    await generate(new GoogleImageAdapter(), cfg, 'gemini-3.1-flash-image', image());
    expect((server.requests[0]!.json as { response_format: unknown }).response_format).toEqual({ type: 'image', mime_type: 'image/png' });
    await generate(new GoogleImageAdapter(), cfg, 'gemini-2.5-flash-image', image({ size: '1344x768' }));
    expect((server.requests[1]!.json as { response_format: unknown }).response_format).toEqual({
      type: 'image',
      mime_type: 'image/png',
      aspect_ratio: '16:9',
    });
  });

  it('只回文字是被拒绝；媒体类型不符是协议错误；失败的交互是被拒绝', () => {
    const textOnly = { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot draw that.' }] }] };
    expect(() => parseImageInteraction(textOnly, 'png')).toThrow(/I cannot draw that/);
    const wrongType = { steps: [{ type: 'model_output', content: [{ type: 'image', data: 'AAAA', mime_type: 'image/jpeg' }] }] };
    expect(() => parseImageInteraction(wrongType, 'png')).toThrow(ProviderFailure);
    expect(() => parseImageInteraction({ status: 'failed', steps: [] }, 'png')).toThrow(/failed/);
  });

  it('模型表：尺寸各不相同（每个尺寸只对应一种写法），默认 3.1 Flash Image，最多 4 张', () => {
    for (const model of new GoogleImageAdapter().models(config('x', null))) {
      expect(new Set(model.sizes).size).toBe(model.sizes.length);
      expect(model.aspectRatios.every((a) => model.sizes.includes(a.size))).toBe(true);
      expect(model).toMatchObject({ maxCount: 4, defaultSize: null, acceptsSeed: false, formats: ['png', 'jpeg'] });
    }
    const flash = new GoogleImageAdapter().models(config('x', null)).find((m) => m.default)!;
    expect(flash.modelId).toBe('gemini-3.1-flash-image');
    expect(flash.aspectRatios).toHaveLength(14);
    expect(flash.sizes).toHaveLength(56);
  });
});

describe('OpenAI 兼容端点', () => {
  const declared: AdapterConfig['declared'] = [
    { modelId: 'whisper', capability: 'transcribe' },
    { modelId: 'kokoro', capability: 'synthesizeSpeech', voices: ['af_bella', 'am_adam'], maxInputChars: 1000, formats: ['wav', 'mp3'] },
    { modelId: 'sdxl', capability: 'generateImage', sizes: ['512x512'], maxCount: 2 },
  ];

  it('按声明的能力分开列模型，补上保守的默认值', () => {
    const cfg = config('x', null, declared);
    expect(new CompatibleSpeechAdapter(() => '本机').models(cfg)).toEqual([
      expect.objectContaining({
        modelId: 'kokoro',
        default: true,
        declared: true,
        defaultVoice: 'af_bella',
        voiceModes: ['preset', 'custom'],
        maxInputChars: 1000,
        formats: ['wav', 'mp3'],
        defaultFormat: 'wav',
      }),
    ]);
    expect(new CompatibleImageAdapter(() => '本机').models(cfg)).toEqual([
      expect.objectContaining({ modelId: 'sdxl', defaultSize: '512x512', maxCount: 2, maxPromptChars: 4000, formats: ['png'] }),
    ]);
  });

  it('不带密钥时不发 Authorization；图片请求 b64_json，任意音色原样传', async () => {
    server = await startFakeProviderServer(fakeOpenAiHandler());
    const cfg = config(`${server.origin}/v1`, null, declared);
    await synthesize(new CompatibleSpeechAdapter(() => '本机'), cfg, 'kokoro', speech({ voice: 'zf_xiaobei', format: 'wav' }));
    expect(server.requests[0]!.headers.authorization).toBeUndefined();
    expect(server.requests[0]!.json).toMatchObject({ model: 'kokoro', voice: 'zf_xiaobei', response_format: 'wav' });
    await generate(new CompatibleImageAdapter(() => '本机'), cfg, 'sdxl', image({ size: '512x512' }));
    expect(server.requests[1]!.json).toEqual({
      model: 'sdxl',
      prompt: 'a fox',
      n: 1,
      size: '512x512',
      output_format: 'png',
      response_format: 'b64_json',
    });
  });
});

describe('OnlineGenerator', () => {
  it('把输出写进 staging 并给出摘要；没有配置时 unavailable；取消时 cancelled', async () => {
    server = await startFakeProviderServer(fakeOpenAiHandler());
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-gen-'));
    try {
      let current: AdapterConfig | null = config(`${server.origin}/v1`, OPENAI_KEY);
      const generator = new OnlineGenerator({
        providerId: 'openai',
        label: () => 'OpenAI',
        speech: new OpenAiSpeechAdapter(),
        image: new OpenAiImageAdapter(),
        config: async () => current,
        http,
      });
      const phases: string[] = [];
      const sink = { generating: () => phases.push('generating'), progress: (d: number, t: number) => phases.push(`${d}/${t}`) };
      const run = (parameters: GenerationRun['parameters'], modelId: string): GenerationRun => ({
        jobId: 'job_1',
        attempt: 1,
        providerId: 'openai',
        modelId,
        parameters,
        staging,
      });
      const attempt = await generator.generate(run(image({ count: 2 }), 'gpt-image-1'), sink, new AbortController().signal);
      expect(attempt).toMatchObject({ outcome: 'completed', workerVersion: 'baocut-providers/openai-image@1' });
      const outputs = attempt.outcome === 'completed' ? attempt.outputs : [];
      expect(outputs.map((o) => [o.path, o.mediaType])).toEqual([
        ['output-1.png', 'image/png'],
        ['output-2.png', 'image/png'],
      ]);
      expect((await fs.readFile(path.join(staging, 'output-2.png'))).equals(pngFixture(16, 9, 1))).toBe(true);
      expect(phases).toEqual(['generating', '2/2']);

      const wrongModel = await failure(generator.generate(run(speech(), 'gpt-image-1'), sink, new AbortController().signal));
      expect(wrongModel.kind).toBe('unavailable');

      server.handler = () => 'hang';
      const controller = new AbortController();
      const pending = generator.generate(run(speech(), 'gpt-4o-mini-tts'), sink, controller.signal);
      await server.waitForRequests(2);
      controller.abort();
      expect(await pending).toEqual({ outcome: 'cancelled' });

      current = null;
      expect((await failure(generator.generate(run(speech(), 'gpt-4o-mini-tts'), sink, new AbortController().signal))).kind).toBe(
        'unavailable',
      );
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  });
});

describe('OnlineProviderSource 的生成能力', () => {
  it('按 Provider 列能力；自定义端点只列声明的能力；没有那种能力的 generator 是 null；视图不回显密钥', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-src-'));
    try {
      const store = await ModelServiceStore.open(
        { modelServicesFile: path.join(dir, 'model-services.json') },
        new FileCredentialStore(path.join(dir, 'model-credentials.json')),
      );
      const source = new OnlineProviderSource({ store, ffmpeg: async () => ({ command: 'ffmpeg', env: {} }) });
      await source.configure({ providerId: 'elevenlabs', enabled: true, credential: ELEVENLABS_KEY });
      await source.configure({
        providerId: 'custom:studio',
        enabled: true,
        endpoint: 'http://127.0.0.1:9/v1',
        models: [{ modelId: 'kokoro', capability: 'synthesizeSpeech', voices: ['af_bella'] }],
      });
      const views = Object.fromEntries((await source.list('view')).map((v) => [v.providerId, v]));
      expect(Object.keys(views.openai!.capabilities).sort()).toEqual(['generateImage', 'generateText', 'synthesizeSpeech', 'transcribe']);
      expect(Object.keys(views.google!.capabilities).sort()).toEqual(['generateImage', 'generateText', 'transcribe']);
      expect(Object.keys(views.elevenlabs!.capabilities)).toEqual(['synthesizeSpeech']);
      expect(views.elevenlabs!.capabilities.synthesizeSpeech!.available).toBe(true);
      expect(views.openai!.capabilities.synthesizeSpeech).toMatchObject({ available: false, unavailableReason: 'not-configured' });
      expect(Object.keys(views['custom:studio']!.capabilities)).toEqual(['synthesizeSpeech']);
      expect(views['custom:studio']!.capabilities.synthesizeSpeech).toMatchObject({ available: true });
      expect(JSON.stringify(views)).not.toContain(ELEVENLABS_KEY);

      expect(source.generator('google', 'synthesizeSpeech')).toBeNull();
      expect(source.generator('elevenlabs', 'generateImage')).toBeNull();
      expect(source.transcriber('elevenlabs')).toBeNull();
      const eleven = source.generator('elevenlabs', 'synthesizeSpeech');
      expect(eleven).not.toBeNull();
      expect(source.generator('elevenlabs', 'synthesizeSpeech')).toBe(eleven);
      expect(source.generator('custom:studio', 'synthesizeSpeech')).not.toBeNull();
      expect(source.generators()).toHaveLength(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
