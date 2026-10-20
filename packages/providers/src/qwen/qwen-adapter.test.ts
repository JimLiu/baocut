import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelServiceStore, validateAsrResult, type AsrResult } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import type { AdapterConfig, ChunkRequest } from '../adapter.ts';
import { CompatibleAdapter } from '../openai-compatible/compatible-adapter.ts';
import { OnlineProviderSource } from '../online-source.ts';
import { startFakeProviderServer, wavFixture, type FakeProviderServer, type FakeReply, type RecordedRequest } from '../testing/fake-provider-server.ts';

const endpoint = 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const dashscopePath = '/api/v1/services/aigc/multimodal-generation/generation';
const key = 'sk-qwen-test-only';
let server: FakeProviderServer | undefined;
let dir: string | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await server?.close();
  server = undefined;
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function request(modelId = 'qwen-audio-3.0-asr-flash', baseUrl = endpoint): Promise<ChunkRequest> {
  dir ??= await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-qwen-'));
  const audio = wavFixture(0.5, 16_000);
  const file = path.join(dir, 'chunk.wav');
  await fs.writeFile(file, audio);
  const config: AdapterConfig = {
    providerId: 'custom:ali', baseUrl, credential: key,
    declared: [{ modelId, capability: 'transcribe', wordTimestamps: 'native', maxInputBytes: 25_000_000 }],
  };
  return {
    config, model: new CompatibleAdapter(() => 'ali').models(config)[0]!, file, byteLength: audio.length,
    format: 'wav', durationSec: 0.5, language: { mode: 'assert', tag: 'zh-Hans' }, hint: 'BaoCut',
    signal: new AbortController().signal, http: { attempts: 1, timeoutMs: 2_000 },
  };
}

const chatReply = {
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello world' } }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
};

// Qwen-Audio HTTP documentation: output.text + output.sentence, millisecond timestamps and fixed words.
const audioReply = {
  output: {
    text: 'hello world.',
    sentence: {
      sentence_id: 1, sentence_end: true, channel_id: 0, begin_time: 100, end_time: 400, text: 'hello world.',
      words: [
        { begin_time: 100, end_time: 200, fixed: true, punctuation: '', text: 'hello' },
        { begin_time: 200, end_time: 400, fixed: true, punctuation: '.', text: ' world' },
      ],
    },
  },
  usage: { duration: 1 },
  request_id: 'fixture-only',
};

/** Reject mixed protocols instead of accepting whichever request the implementation happens to send. */
function contractReply(r: RecordedRequest): FakeReply {
  const body = r.json as Record<string, any> | null;
  if (!body) return { status: 400 };
  if (String(body?.model).startsWith('qwen-audio-')) {
    if (!r.path.endsWith(dashscopePath)) return { status: 404 };
    const messages = body?.input?.messages;
    if (r.method !== 'POST' || r.headers['x-dashscope-sse'] !== 'disable' ||
        !Array.isArray(messages) || messages.at(-1)?.role !== 'user' ||
        messages.at(-1)?.content?.[0]?.type !== 'input_audio' ||
        typeof messages.at(-1)?.content?.[0]?.input_audio?.data !== 'string' ||
        messages.some((m) => m.role === 'system') ||
        body?.parameters?.format !== 'wav' || body.parameters.sample_rate !== '16000' ||
        'messages' in body || 'asr_options' in body || 'stream' in body) {
      return { status: 400, json: { code: 'InvalidParameter', message: 'Expected DashScope audio request' } };
    }
    return { status: 200, json: audioReply };
  }
  if (!r.path.endsWith('/compatible-mode/v1/chat/completions')) return { status: 404 };
  if (!body || !Array.isArray(body.messages) || body.stream !== false || 'input' in body || 'parameters' in body) {
    return { status: 400, json: { error: { message: 'Expected Qwen3 Chat Completions request' } } };
  }
  return { status: 200, json: chatReply };
}

/** Redirect transport only: preserve the real HTTP client, JSON serialization and error handling. */
function loopback() {
  const fetch = globalThis.fetch;
  const urls: string[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    urls.push(String(url));
    return fetch(`${server!.origin}${new URL(String(url)).pathname}`, init);
  });
  return urls;
}

const adapter = () => new CompatibleAdapter(() => 'ali');

describe('Qwen ASR protocol selection', () => {
  it.each(['qwen-audio-3.0-asr-flash', 'qwen-audio-3.1-asr-flash'])('uses DashScope for existing %s declarations', async (id) => {
    server = await startFakeProviderServer(contractReply);
    const urls = loopback();
    const input = await request(id);
    const result = await adapter().transcribeChunk(input);
    expect(urls).toEqual([`${new URL(endpoint).origin}${dashscopePath}`]);
    expect(result).toEqual({
      text: audioReply.output.text, usage: audioReply.usage,
      words: [{ start: 0.1, end: 0.2, text: 'hello' }, { start: 0.2, end: 0.4, text: ' world.' }],
    });
    const sent = server.requests[0]!;
    expect(sent.headers.authorization).toBe(`Bearer ${key}`);
    expect(sent.json).toEqual({
      model: id,
      input: { messages: [
        { role: 'user', content: [{ type: 'input_text', text: 'BaoCut' }] },
        { role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${(await fs.readFile(input.file)).toString('base64')}` } }] },
      ] },
      parameters: { format: 'wav', sample_rate: '16000', language_hints: ['zh'] },
    });
    expect(JSON.stringify(sent.json)).not.toContain(key);
    expect(input.model).toMatchObject({ wordTimestamps: 'native', maxInputBytes: 7_000_000, maxDurationSec: 300 });
  });

  it('retains the Qwen3 system context, language options and Chat Completions response', async () => {
    server = await startFakeProviderServer(contractReply);
    const urls = loopback();
    const input = await request('qwen3-asr-flash');
    expect(await adapter().transcribeChunk(input)).toEqual({ text: 'hello world', usage: chatReply.usage });
    expect(urls).toEqual([`${endpoint}/chat/completions`]);
    expect(server.requests[0]!.json).toMatchObject({
      messages: [{ role: 'system', content: 'BaoCut' }, { role: 'user' }],
      asr_options: { language: 'zh', enable_itn: false }, stream: false,
    });
    expect(input.model.wordTimestamps).toBe('none');
  });

  it.each(['qwen3-asr-flash', 'qwen-audio-3.1-asr-flash', 'qwen3-asr-flash-2025-09-08', 'qwen-audio-3.0-asr-flash-latest'])(
    'does not force preferred language or empty context for %s', async (id) => {
      server = await startFakeProviderServer(contractReply);
      loopback();
      const input = await request(id);
      input.language = { mode: 'prefer', tag: 'en' };
      delete input.hint;
      await adapter().transcribeChunk(input);
      const body = server.requests[0]!.json as Record<string, any>;
      if (id.startsWith('qwen-audio-')) {
        expect(body.input.messages).toHaveLength(1);
        expect(body.parameters).not.toHaveProperty('language_hints');
      } else {
        expect(body.messages).toHaveLength(1);
        expect(body.asr_options).not.toHaveProperty('language');
      }
    },
  );

  it.each([
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', dashscopePath],
    ['https://dashscope-intl.aliyuncs.com/api/v1', dashscopePath],
    [`${endpoint}/`, dashscopePath],
    ['https://workspace.cn-beijing.maas.aliyuncs.com/proxy/compatible-mode/v1', `/proxy${dashscopePath}`],
  ])('preserves the origin and proxy prefix of %s', async (base, expectedPath) => {
    server = await startFakeProviderServer(contractReply);
    const urls = loopback();
    await adapter().transcribeChunk(await request('qwen-audio-3.0-asr-flash', base));
    expect(new URL(urls[0]!).origin).toBe(new URL(base).origin);
    expect(new URL(urls[0]!).pathname).toBe(expectedPath);
  });

  it('caps DashScope context at 400 Unicode characters', async () => {
    server = await startFakeProviderServer(contractReply);
    loopback();
    const input = await request();
    input.hint = '\u{1F600}'.repeat(401);
    await adapter().transcribeChunk(input);
    const body = server.requests[0]!.json as Record<string, any>;
    expect(Array.from(body.input.messages[0].content[0].text)).toHaveLength(400);
  });

  it('keeps stricter user limits and ordinary compatible endpoints unchanged', async () => {
    for (const id of ['qwen3-asr-flash', 'qwen-audio-3.0-asr-flash']) {
      expect(adapter().models({ providerId: 'custom:ali', baseUrl: endpoint, credential: null,
        declared: [{ modelId: id, maxInputBytes: 100_000, maxDurationSec: 5 }] })[0]).toMatchObject({ maxInputBytes: 100_000, maxDurationSec: 5 });
    }
    server = await startFakeProviderServer(() => ({ status: 200, json: { text: 'hello' } }));
    await adapter().transcribeChunk(await request('qwen-audio-3.0-asr-flash', `${server.origin}/v1`));
    expect(server.requests[0]!.path).toBe('/v1/audio/transcriptions');
    expect(server.requests[0]!.file).not.toBeNull();
  });

  it('does not recognize lookalike hosts, arbitrary models or asynchronous filetrans', async () => {
    for (const base of ['https://dashscope.aliyuncs.com.evil.test/v1', 'https://notaliyuncs.com/v1']) {
      expect((await request('qwen3-asr-flash', base)).model.wordTimestamps).toBe('native');
    }
    expect((await request('whisper-1')).model.wordTimestamps).toBe('native');
    const filetrans = await request('qwen-audio-3.0-asr-flash-filetrans');
    expect(filetrans.model).toMatchObject({ available: false, unavailableReason: 'unsupported' });
    await expect(adapter().transcribeChunk(filetrans)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it.each(['qwen3-asr-flash', 'qwen-audio-3.0-asr-flash'])('rejects the other protocol response for %s', async (id) => {
    server = await startFakeProviderServer(() => ({ status: 200, json: id.startsWith('qwen-audio-') ? chatReply : audioReply }));
    loopback();
    await expect(adapter().transcribeChunk(await request(id))).rejects.toMatchObject({ kind: 'protocol' });
  });

  it.each([{}, { choices: [{ message: {} }] }, { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }])(
    'rejects malformed or incomplete Qwen3 responses', async (json) => {
      server = await startFakeProviderServer(() => ({ status: 200, json }));
      loopback();
      await expect(adapter().transcribeChunk(await request('qwen3-asr-flash'))).rejects.toMatchObject({ kind: 'protocol' });
    },
  );

  it('rejects intermediate DashScope sentences and preserves full text when word coverage is partial', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { ...audioReply,
      output: { ...audioReply.output, sentence: { ...audioReply.output.sentence, sentence_end: false } } } }));
    loopback();
    await expect(adapter().transcribeChunk(await request())).rejects.toMatchObject({ kind: 'protocol' });
    server.handler = () => ({ status: 200, json: { ...audioReply, output: { ...audioReply.output, text: 'Earlier sentence. hello world.' } } });
    expect(await adapter().transcribeChunk(await request())).toEqual({ text: 'Earlier sentence. hello world.', usage: audioReply.usage });
    server.handler = () => ({ status: 200, json: { ...audioReply, output: { ...audioReply.output,
      sentence: { ...audioReply.output.sentence, words: audioReply.output.sentence.words.map((w) => ({ ...w, fixed: false })) } } } });
    expect(await adapter().transcribeChunk(await request())).not.toHaveProperty('words');
  });

  it.each(['qwen3-asr-flash', 'qwen-audio-3.0-asr-flash'])('accepts no speech and retains authentication errors for %s', async (id) => {
    server = await startFakeProviderServer(() => ({ status: 200, json: id.startsWith('qwen-audio-')
      ? { output: { text: '' } } : { choices: [{ finish_reason: 'stop', message: { content: '' } }] } }));
    loopback();
    expect(await adapter().transcribeChunk(await request(id))).toEqual({ text: '' });
    server.handler = () => ({ status: 401, json: { error: { message: 'unauthorized' } } });
    await expect(adapter().transcribeChunk(await request(id))).rejects.toMatchObject({ details: { code: 'PROVIDER_AUTH_FAILED', status: 401 } });
  });

  it.each(['qwen-audio-3.0-asr-flash', 'qwen3-asr-flash'])('registers and transcribes long audio with %s', async (id) => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-qwen-source-'));
    const store = await ModelServiceStore.open(
      { modelServicesFile: path.join(dir, 'model-services.json') }, new FileCredentialStore(path.join(dir, 'credentials.json')),
    );
    server = await startFakeProviderServer(contractReply);
    const source = new OnlineProviderSource({ store, baseUrls: { qwen: `${server.origin}/compatible-mode/v1` }, ffmpeg: async () => ({ command: 'ffmpeg', env: process.env }) });
    await source.configure({ providerId: 'qwen', enabled: true });
    await source.addAccount({ providerId: 'qwen', credential: key, region: 'cn' });
    const view = (await source.describe('qwen', 'view'))!;
    expect(view.capabilities.transcribe).toMatchObject({ available: true });
    expect(view.capabilities.transcribe!.models).toContainEqual(expect.objectContaining({ modelId: id, wordTimestamps: id.startsWith('qwen-audio-') ? 'native' : 'none' }));
    expect(view.capabilities.generateText).toBeDefined();
    expect(view.vendor?.planned).not.toContain('transcribe');
    const durationSec = 125;
    const timescale = 48_000;
    const file = path.join(dir, 'long.wav');
    await fs.writeFile(file, wavFixture(durationSec, 16_000));
    const staging = path.join(dir, 'staging');
    await fs.mkdir(staging);
    const attempt = await source.transcriber('qwen')!.transcribe({
      jobId: 'qwen-test', runGeneration: 1, providerId: 'qwen', modelId: id, bundleId: null,
      input: { file, contentHash: 'sha256:test', track: 0 },
      options: { language: { mode: 'prefer', tag: null }, diarize: false, timescale }, staging,
    }, { loading() {}, phase() {}, progress() {}, segment() {}, warning() {}, language() {} }, new AbortController().signal);
    expect(attempt.outcome).toBe('completed');
    const result = JSON.parse(await fs.readFile(path.join(staging, 'result.json'), 'utf8')) as AsrResult;
    expect(validateAsrResult(result, { runGeneration: 1 })).toMatchObject({ ok: true });
    expect(server.requests).toHaveLength(2);
    expect(result.segments.length).toBeGreaterThan(1);
    const timing = id.startsWith('qwen-audio-') ? 'provider' : 'estimated';
    expect(result.segments.flatMap((s) => s.words).every((w) => w.timingQuality === timing)).toBe(true);
    expect(result.duration).toBe(durationSec * timescale);
    expect(result.coverage).toEqual([{ start: 0, end: durationSec * timescale }]);
    if (timing === 'provider') {
      // The silent fixture splits at its midpoint. Preserve each response's short
      // native word times and add the chunk offset, even though coverage is longer.
      expect(result.segments.map((s) => s.words.map((w) => ({ start: w.start, end: w.end })))).toEqual(
        [0, durationSec / 2].map((offset) => audioReply.output.sentence.words.map((w) => ({
          start: Math.round((offset + w.begin_time / 1000) * timescale),
          end: Math.round((offset + w.end_time / 1000) * timescale),
        }))),
      );
    } else {
      expect(result.segments.at(-1)!.end).toBe(durationSec * timescale);
    }
    expect(await fs.readdir(staging)).toEqual(['result.json']);
  });
});

describe('Qwen manually added models', () => {
  const builtin = ['qwen-audio-3.0-asr-flash', 'qwen-audio-3.1-asr-flash', 'qwen3-asr-flash'];

  async function qwenSource(listed: string[] = []) {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-qwen-declared-'));
    const store = await ModelServiceStore.open(
      { modelServicesFile: path.join(dir, 'model-services.json') }, new FileCredentialStore(path.join(dir, 'credentials.json')),
    );
    server = await startFakeProviderServer((r) => r.path.endsWith('/models')
      ? { status: 200, json: { data: listed.map((id) => ({ id })) } } : contractReply(r));
    const source = new OnlineProviderSource({ store, baseUrls: { qwen: `${server.origin}/compatible-mode/v1` }, ffmpeg: async () => ({ command: 'ffmpeg', env: process.env }) });
    await source.configure({ providerId: 'qwen', enabled: true });
    await source.addAccount({ providerId: 'qwen', credential: key, region: 'cn' });
    return source;
  }

  it('lists added text and ASR models after the built-in ones, under the same ASR limits', async () => {
    const source = await qwenSource();
    await source.configure({ providerId: 'qwen', models: [
      { modelId: 'qwen-plus-2026-01-23', capability: 'generateText' },
      { modelId: 'qwen3-asr-flash-2026-02-10', capability: 'transcribe', acceptsHint: false },
      { modelId: 'qwen3-asr-flash-filetrans', capability: 'transcribe' },
    ] });
    const view = (await source.describe('qwen', 'view'))!;
    expect(view.vendor?.declarable).toEqual(['generateText', 'transcribe']);
    const asr = view.capabilities.transcribe!.models;
    expect(asr.map((m) => m.modelId)).toEqual([...builtin, 'qwen3-asr-flash-2026-02-10', 'qwen3-asr-flash-filetrans']);
    expect(asr.filter((m) => m.declared).map((m) => m.modelId)).toEqual(['qwen3-asr-flash-2026-02-10', 'qwen3-asr-flash-filetrans']);
    expect(asr.find((m) => m.default)?.modelId).toBe(builtin[0]);
    expect(asr[3]).toMatchObject({ declared: true, acceptsHint: false, maxInputBytes: 7_000_000, maxDurationSec: 300, wordTimestamps: 'none' });
    expect(asr[4]).toMatchObject({ available: false, unavailableReason: 'unsupported' });
    expect(asr[4]!.detail).toMatch(/filetrans/);
    const text = view.capabilities.generateText!.models;
    expect(text.at(-1)).toMatchObject({ modelId: 'qwen-plus-2026-01-23', declared: true });
    expect(text.filter((m) => m.declared)).toHaveLength(1);

    // The added ASR model goes through the same synchronous protocol as the built-in Qwen3 ASR.
    const durationSec = 2;
    const file = path.join(dir!, 'short.wav');
    await fs.writeFile(file, wavFixture(durationSec, 16_000));
    const staging = path.join(dir!, 'staging');
    await fs.mkdir(staging);
    const attempt = await source.transcriber('qwen')!.transcribe({
      jobId: 'qwen-declared', runGeneration: 1, providerId: 'qwen', modelId: 'qwen3-asr-flash-2026-02-10', bundleId: null,
      input: { file, contentHash: 'sha256:test', track: 0 },
      options: { language: { mode: 'prefer', tag: null }, diarize: false, timescale: 48_000 }, staging,
    }, { loading() {}, phase() {}, progress() {}, segment() {}, warning() {}, language() {} }, new AbortController().signal);
    expect(attempt.outcome).toBe('completed');
    expect(server!.requests.at(-1)).toMatchObject({ path: '/compatible-mode/v1/chat/completions' });
    expect(server!.requests.at(-1)!.json).toMatchObject({ model: 'qwen3-asr-flash-2026-02-10' });
  });

  it('rejects added models that reuse a built-in ID, use a capability Qwen does not accept, or name the provider', async () => {
    const source = await qwenSource();
    for (const models of [
      [{ modelId: 'qwen3-asr-flash', capability: 'transcribe' as const }],
      [{ modelId: 'qwen3.8-max', capability: 'generateText' as const }],
      [{ modelId: 'qwen-image-test', capability: 'generateImage' as const }],
      [{ modelId: 'qwen-tts-test', capability: 'synthesizeSpeech' as const }],
    ]) {
      await expect(source.configure({ providerId: 'qwen', models })).rejects.toMatchObject({ code: 'invalid-request' });
    }
    await expect(source.configure({ providerId: 'qwen', label: 'Mine' })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(source.configure({ providerId: 'moonshot', models: [{ modelId: 'kimi-x', capability: 'generateText' }] }))
      .rejects.toMatchObject({ code: 'invalid-request' });
    expect((await source.describe('qwen', 'view'))!.capabilities.transcribe!.models.some((m) => m.declared)).toBe(false);
  });

  it('keeps added models usable when a refreshed vendor list omits them, unlike built-in ones', async () => {
    const source = await qwenSource(['qwen3-asr-flash']);
    await source.configure({ providerId: 'qwen', models: [{ modelId: 'qwen3-asr-flash-2026-02-10', capability: 'transcribe' }] });
    expect(await source.refresh('qwen')).toMatchObject({ ok: true, models: 1 });
    const asr = (await source.describe('qwen', 'view'))!.capabilities.transcribe!.models;
    expect(asr.find((m) => m.modelId === 'qwen3-asr-flash')!.available).not.toBe(false);
    expect(asr.find((m) => m.modelId === 'qwen-audio-3.0-asr-flash')).toMatchObject({ available: false, unavailableReason: 'unsupported' });
    const added = asr.find((m) => m.modelId === 'qwen3-asr-flash-2026-02-10')!;
    expect(added.available).not.toBe(false);
    expect(added.detail).toBeTruthy();
  });
});
