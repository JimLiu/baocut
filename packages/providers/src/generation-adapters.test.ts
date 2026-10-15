import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelServiceStore, ProviderFailure, freezeImageInput, type GenerationRun, type ImageParameters, type SpeechParameters } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import type { AdapterConfig, ImageAdapter, ImageInputBytes, SpeechAdapter } from './adapter.ts';
import { ElevenLabsAdapter } from './elevenlabs/elevenlabs-adapter.ts';
import { GoogleImageAdapter, parseImageInteraction } from './google/google-image.ts';
import { GoogleSpeechAdapter, parseSpeechInteraction } from './google/google-speech.ts';
import { ProviderAborted } from './http/provider-fetch.ts';
import { OnlineGenerator } from './online-generator.ts';
import { OnlineProviderSource } from './online-source.ts';
import { CompatibleImageAdapter, CompatibleSpeechAdapter } from './openai-compatible/compatible-media.ts';
import { OpenAiImageAdapter, OpenAiSpeechAdapter } from './openai/openai-media-adapters.ts';
import { VolcengineSpeechAdapter, parseSpeechStream } from './volcengine/volcengine-speech.ts';
import {
  fakeElevenLabsHandler,
  fakeGoogleHandler,
  fakeOpenAiHandler,
  fakeVolcengineSpeechHandler,
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
const VOLC_KEY = 'volc-test-ONLY-FOR-TESTS-0123456789abcdef';
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

function generate(
  adapter: ImageAdapter,
  cfg: AdapterConfig,
  modelId: string,
  parameters: ImageParameters,
  progress: number[] = [],
  inputs: ImageInputBytes[] = [],
) {
  const model = adapter.models(cfg).find((m) => m.modelId === modelId)!;
  return adapter.generate({
    config: cfg,
    model,
    parameters,
    inputs,
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

  it('带输入图时走 /images/edits：images 是 data URL 的 image_url，顺序不变，其余字段相同', async () => {
    server = await startFakeProviderServer(fakeOpenAiHandler());
    const inputs: ImageInputBytes[] = [
      { bytes: pngFixture(4, 4, 0), mediaType: 'image/png', name: 'a.png' },
      { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mediaType: 'image/jpeg', name: 'b.jpg' },
    ];
    const out = await generate(
      new OpenAiImageAdapter(),
      config(`${server.origin}/v1`, OPENAI_KEY),
      'gpt-image-2',
      image({ count: 2, size: '1024x1024' }),
      [],
      inputs,
    );
    expect(out.images).toHaveLength(2);
    expect(server.requests[0]!.path).toBe('/v1/images/edits');
    expect(server.requests[0]!.json).toEqual({
      model: 'gpt-image-2',
      images: [
        { image_url: `data:image/png;base64,${pngFixture(4, 4, 0).toString('base64')}` },
        { image_url: 'data:image/jpeg;base64,/9j/4A==' },
      ],
      prompt: 'a fox',
      n: 2,
      size: '1024x1024',
      output_format: 'png',
    });
  });

  it('张数不对、没有 b64_json：协议错误', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { data: [{ b64_json: 'AAAA' }] } }));
    const cfg = config(`${server.origin}/v1`, OPENAI_KEY);
    expect((await failure(generate(new OpenAiImageAdapter(), cfg, 'gpt-image-1', image({ count: 2 })))).kind).toBe('protocol');
    server.handler = () => ({ status: 200, json: { data: [{ url: 'https://example.invalid/a.png' }] } });
    expect((await failure(generate(new OpenAiImageAdapter(), cfg, 'gpt-image-1', image()))).kind).toBe('protocol');
  });

  it('模型表：gpt-image-2 是默认，宽高比 16:9 对应 1536x864、另有 2K 一档；参考图与 seed 按声明', () => {
    const models = new OpenAiImageAdapter().models(config('x', null));
    const def = models.find((m) => m.default)!;
    expect(def.modelId).toBe('gpt-image-2');
    expect(def.aspectRatios).toContainEqual({
      ratio: '16:9',
      size: '1536x864',
      tiers: [
        { tier: '1K', size: '1536x864' },
        { tier: '2K', size: '2560x1440' },
      ],
    });
    // 每一档的尺寸都在 sizes 里，按尺寸提交能过提交时的检查。
    for (const a of def.aspectRatios) for (const t of a.tiers ?? []) expect(def.sizes).toContain(t.size);
    expect(def.aspectRatios.find((a) => a.ratio === '1:1')!.tiers).toBeUndefined();
    expect(models.every((m) => m.maxCount === 10 && m.maxPromptChars === 32_000 && !m.acceptsSeed)).toBe(true);
    expect(def.referenceImages).toEqual({ max: 16, edit: true, maxBytesEach: 50_000_000, maxBytesTotal: null });
    expect(models.every((m) => m.img2img === null)).toBe(true);
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

describe('Google 语音', () => {
  it('Interactions：文本逐字念，风格放进 speech_metadata.style，音色在 speech_config；取 model_output 的 WAV', async () => {
    server = await startFakeProviderServer(fakeGoogleHandler());
    const cfg = config(`${server.origin}/v1beta`, GOOGLE_KEY);
    const out = await synthesize(
      new GoogleSpeechAdapter(),
      cfg,
      'gemini-3.8-flash-tts',
      speech({ voice: 'Puck', format: 'wav', instructions: ' warm and slow ', language: 'zh-Hans' }),
    );
    expect(out.bytes.equals(wavFixture())).toBe(true);
    expect(out.usage).toEqual({ total_input_tokens: 8, total_output_tokens: 75 });
    const [request] = server.requests;
    expect(request).toMatchObject({ method: 'POST', path: '/v1beta/interactions' });
    expect(request!.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    expect(request!.headers['api-revision']).toBeTruthy();
    expect(request!.json).toEqual({
      model: 'gemini-3.8-flash-tts',
      input: [
        {
          type: 'user_input',
          content: [{ type: 'text', text: 'hello', annotations: [{ type: 'speech_metadata', style: 'warm and slow' }] }],
        },
      ],
      response_format: { type: 'audio', mime_type: 'audio/wav' },
      generation_config: { speech_config: [{ voice: 'Puck' }] },
      store: false,
    });

    // 没有风格说明时不带 annotations。
    await synthesize(new GoogleSpeechAdapter(), cfg, 'gemini-3.8-flash-lite-tts', speech({ voice: 'voice_abc123', format: 'wav' }));
    const second = server.requests[1]!.json as { input: Array<{ content: Array<Record<string, unknown>> }> };
    expect(second.input[0]!.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('模型表：30 个预置音色、默认 Kore；只出 WAV；接受风格说明，不接受语速与 seed', () => {
    const models = new GoogleSpeechAdapter().models(config('x', null));
    expect(models.map((m) => m.modelId)).toEqual(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']);
    expect(models.find((m) => m.default)?.modelId).toBe('gemini-3.8-flash-tts');
    for (const m of models) {
      expect(m.voices).toHaveLength(30);
      expect(m.defaultVoice).toBe('Kore');
      expect(m.voiceModes).toEqual(['preset', 'custom']);
      expect(m.formats).toEqual(['wav']);
      expect(m).toMatchObject({ acceptsInstructions: true, speedRange: null, acceptsSeed: false, languages: 'any' });
    }
  });

  it('要 mp3 是 PROVIDER_REJECTED，不发请求；返回的不是 WAV、没有音频或交互失败都报错', async () => {
    server = await startFakeProviderServer(fakeGoogleHandler());
    const mp3 = await failure(synthesize(new GoogleSpeechAdapter(), config(`${server.origin}/v1beta`, GOOGLE_KEY), 'gemini-3.8-flash-tts', speech({ voice: 'Kore' })));
    expect(mp3.details.code).toBe('PROVIDER_REJECTED');
    expect(server.requests).toHaveLength(0);

    const pcm = { steps: [{ type: 'model_output', content: [{ type: 'audio', data: Buffer.from('raw-pcm').toString('base64'), mime_type: 'audio/l16' }] }] };
    expect(() => parseSpeechInteraction(pcm)).toThrow(/audio\/l16/);
    expect(() => parseSpeechInteraction({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'no' }] }] })).toThrow(ProviderFailure);
    expect(() => parseSpeechInteraction({ status: 'failed', steps: [] })).toThrow(ProviderFailure);
  });
});

describe('豆包语音', () => {
  it('X-Api-Key 与资源 ID；mp3 把分片拼起来，结束包的用量原样带回；语速换算成 speech_rate，风格放进 additions', async () => {
    server = await startFakeProviderServer(fakeVolcengineSpeechHandler(VOLC_KEY));
    const cfg = config(`${server.origin}/api/v3`, VOLC_KEY);
    const out = await synthesize(
      new VolcengineSpeechAdapter(),
      cfg,
      'seed-tts-2.0',
      speech({ voice: 'zh_female_vv_uranus_bigtts', speed: 1.5, instructions: '语气欢快些', language: 'ja' }),
    );
    expect(out.bytes.equals(mp3Fixture())).toBe(true);
    expect(out.usage).toEqual({ text_words: 5 });
    const [request] = server.requests;
    expect(request).toMatchObject({ method: 'POST', path: '/api/v3/tts/unidirectional' });
    expect(request!.headers['x-api-key']).toBe(VOLC_KEY);
    expect(request!.headers.authorization).toBeUndefined();
    expect(request!.headers['x-api-resource-id']).toBe('seed-tts-2.0');
    expect(request!.headers['x-api-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const params = (request!.json as { req_params: Record<string, unknown> }).req_params;
    expect(params).toMatchObject({
      text: 'hello',
      speaker: 'zh_female_vv_uranus_bigtts',
      audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: 50 },
    });
    expect(JSON.parse(params.additions as string)).toEqual({ enable_auto_language_recognition: true, context_texts: ['语气欢快些'] });
  });

  it('WAV：取 24 kHz PCM 自己补头；中英文不开自动识别、没有说明时不带 additions', async () => {
    server = await startFakeProviderServer(fakeVolcengineSpeechHandler(VOLC_KEY));
    const out = await synthesize(
      new VolcengineSpeechAdapter(),
      config(`${server.origin}/api/v3`, VOLC_KEY),
      'seed-tts-2.0',
      speech({ voice: 'en_male_tim_uranus_bigtts', format: 'wav', language: 'en-US' }),
    );
    expect(out.bytes.equals(wavFixture())).toBe(true);
    const params = (server.requests[0]!.json as { req_params: Record<string, unknown> }).req_params;
    expect(params.audio_params).toEqual({ format: 'pcm', sample_rate: 24000 });
    expect(params.additions).toBeUndefined();
  });

  it('密钥不对是 PROVIDER_AUTH_FAILED，密钥不出现在错误里；流里的错误码按分类抛出', async () => {
    server = await startFakeProviderServer(fakeVolcengineSpeechHandler('another-key'));
    const auth = await failure(
      synthesize(new VolcengineSpeechAdapter(), config(`${server.origin}/api/v3`, VOLC_KEY), 'seed-tts-2.0', speech({ voice: 'x' })),
    );
    expect(auth.details.code).toBe('PROVIDER_AUTH_FAILED');
    expect(JSON.stringify({ message: auth.message, details: auth.details })).not.toContain(VOLC_KEY);

    const stream = (...packets: unknown[]) => packets.map((p) => JSON.stringify(p)).join('');
    const tooLong = (() => {
      try {
        parseSpeechStream(stream({ code: 40402003, message: 'text too long' }));
      } catch (error) {
        return error as ProviderFailure;
      }
      return null;
    })();
    expect(tooLong?.details.code).toBe('INPUT_TOO_LONG');
    expect(() => parseSpeechStream(stream({ code: 45000000, message: 'quota exceeded for types: concurrency' }))).toThrow(ProviderFailure);
    expect(() => parseSpeechStream('{"code":0,"data":"AA"')).toThrow(ProviderFailure);
    // 字符串里的花括号不影响切分；没有 code 的包跳过。
    const ok = parseSpeechStream(stream({ code: 0, data: Buffer.from('a').toString('base64'), message: '{}' }, { sentence: { text: '}' } }, { code: 20000000, message: 'ok' }));
    expect(Buffer.concat(ok.chunks).toString()).toBe('a');
  });

  it('验证密钥：空文本的合成请求，服务端拒绝空文本算通过、401 算失败；列模型只验证不给模型', async () => {
    server = await startFakeProviderServer(fakeVolcengineSpeechHandler(VOLC_KEY));
    const adapter = new VolcengineSpeechAdapter();
    await adapter.validateCredential(config(`${server.origin}/api/v3`, VOLC_KEY), new AbortController().signal, http);
    expect((server.requests[0]!.json as { req_params: { text: string } }).req_params.text).toBe('');
    expect(await adapter.listModels(config(`${server.origin}/api/v3`, VOLC_KEY), new AbortController().signal, http)).toEqual({});
    const bad = await failure(adapter.validateCredential(config(`${server.origin}/api/v3`, 'wrong'), new AbortController().signal, http));
    expect(bad.details.code).toBe('PROVIDER_AUTH_FAILED');
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

  it('参考图接在提示词后面内联成 image 块；每次请求都带上', async () => {
    server = await startFakeProviderServer(fakeGoogleHandler());
    const ref = { bytes: pngFixture(4, 4, 0), mediaType: 'image/png' as const, name: 'a.png' };
    await generate(new GoogleImageAdapter(), config(`${server.origin}/v1beta`, GOOGLE_KEY), 'gemini-3.1-flash-image', image({ count: 2 }), [], [ref]);
    expect(server.requests).toHaveLength(2);
    for (const request of server.requests) {
      expect((request.json as { input: unknown }).input).toEqual([
        { type: 'text', text: 'a fox' },
        { type: 'image', mime_type: 'image/png', data: pngFixture(4, 4, 0).toString('base64') },
      ]);
    }
    const models = new GoogleImageAdapter().models(config('x', null));
    expect(models.find((m) => m.modelId === 'gemini-3.1-flash-image')!.referenceImages).toMatchObject({ max: 14, edit: false });
    expect(models.every((m) => m.img2img === null)).toBe(true);
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

  it('尺寸档：3.x 每个宽高比列 1K/2K/4K 里模型有的几档（512 不进界面），每档的尺寸都在 sizes 里；2.5 不分档', () => {
    const models = new GoogleImageAdapter().models(config('x', null));
    const byId = (id: string) => models.find((m) => m.modelId === id)!;
    const tiersOf = (id: string, ratio: string) => byId(id).aspectRatios.find((a) => a.ratio === ratio)!.tiers;
    expect(tiersOf('gemini-3.1-flash-image', '16:9')).toEqual([
      { tier: '1K', size: '1376x768' },
      { tier: '2K', size: '2752x1536' },
      { tier: '4K', size: '5504x3072' },
    ]);
    expect(tiersOf('gemini-3-pro-image', '1:1')!.map((t) => t.tier)).toEqual(['1K', '2K', '4K']);
    expect(tiersOf('gemini-3.1-flash-lite-image', '1:1')).toEqual([{ tier: '1K', size: '1024x1024' }]);
    expect(tiersOf('gemini-2.5-flash-image', '1:1')).toBeUndefined();
    for (const model of models) {
      for (const a of model.aspectRatios) {
        if (a.tiers) expect(a.tiers.map((t) => t.size)).toContain(a.size);
        for (const t of a.tiers ?? []) expect(model.sizes).toContain(t.size);
      }
    }
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

      // 输入图按冻结的摘要核对后才发出：文件改过就是 input-unreadable，不发请求。
      server.handler = fakeOpenAiHandler();
      const refFile = path.join(staging, 'ref.png');
      await fs.writeFile(refFile, pngFixture(4, 4, 0));
      const frozen = await freezeImageInput({ source: 'file', path: refFile });
      const withRef = image({ images: [frozen], imageMode: 'ref' });
      const before = server.requests.length;
      expect(await generator.generate(run(withRef, 'gpt-image-1'), sink, new AbortController().signal)).toMatchObject({ outcome: 'completed' });
      expect(server.requests[before]!.path).toBe('/v1/images/edits');
      await fs.writeFile(refFile, pngFixture(4, 4, 1));
      const changed = await failure(generator.generate(run(withRef, 'gpt-image-1'), sink, new AbortController().signal));
      expect(changed).toMatchObject({ kind: 'input-unreadable', details: { reason: 'changed', name: 'ref.png' } });
      expect(server.requests).toHaveLength(before + 1);

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
      expect(Object.keys(views.google!.capabilities).sort()).toEqual(['generateImage', 'generateText', 'synthesizeSpeech', 'transcribe']);
      expect(Object.keys(views['volcengine-speech']!.capabilities)).toEqual(['synthesizeSpeech']);
      expect(Object.keys(views.volcengine!.capabilities)).toEqual(['generateText']);
      // 目录标 P1 的能力只在 `vendor.planned` 里，不报告为能力（AT-34）。
      for (const view of Object.values(views)) {
        for (const planned of view.vendor?.planned ?? []) expect(view.capabilities[planned], `${view.providerId} ${planned}`).toBeUndefined();
      }
      expect(views.volcengine!.vendor?.planned).toEqual(['generateImage']);
      expect(views.siliconflow!.vendor).toMatchObject({ kind: 'relay', planned: ['synthesizeSpeech', 'transcribe'] });
      expect(views.openai!.vendor?.planned).toBeUndefined();
      expect(views.openai!.vendor?.baseUrl).toBe('https://api.openai.com/v1');
      expect(views.moonshot!.vendor?.regionBaseUrls).toEqual({ global: 'https://api.moonshot.ai/v1', cn: 'https://api.moonshot.cn/v1' });
      expect(Object.keys(views.elevenlabs!.capabilities)).toEqual(['synthesizeSpeech']);
      expect(views.elevenlabs!.capabilities.synthesizeSpeech!.available).toBe(true);
      // 能克隆的 Provider 在合成能力上带 voiceClone；ElevenLabs 不要求授权声明录音，没有克隆接口的不带。
      expect(views.elevenlabs!.capabilities.synthesizeSpeech!.voiceClone).toEqual({ requiresConsentClip: false });
      expect(views.openai!.capabilities.synthesizeSpeech!.voiceClone).toBeUndefined();
      expect(source.voiceCloner('elevenlabs')!.requiresConsentClip).toBe(false);
      expect(source.voiceCloner('google')).toBeNull();
      expect(views.openai!.capabilities.synthesizeSpeech).toMatchObject({ available: false, unavailableReason: 'not-configured' });
      expect(Object.keys(views['custom:studio']!.capabilities)).toEqual(['synthesizeSpeech']);
      expect(views['custom:studio']!.capabilities.synthesizeSpeech).toMatchObject({ available: true });
      expect(JSON.stringify(views)).not.toContain(ELEVENLABS_KEY);

      expect(source.generator('google', 'synthesizeSpeech')).not.toBeNull();
      expect(source.generator('elevenlabs', 'generateImage')).toBeNull();
      expect(source.transcriber('elevenlabs')).toBeNull();
      const eleven = source.generator('elevenlabs', 'synthesizeSpeech');
      expect(eleven).not.toBeNull();
      expect(source.generator('elevenlabs', 'synthesizeSpeech')).toBe(eleven);
      expect(source.generator('custom:studio', 'synthesizeSpeech')).not.toBeNull();
      expect(source.generators()).toHaveLength(3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
