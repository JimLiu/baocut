import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelServiceStore, validateAsrResult, type AsrResult } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import type { AdapterConfig, ChunkRequest } from '../adapter.ts';
import { CompatibleAdapter } from '../openai-compatible/compatible-adapter.ts';
import { OnlineProviderSource } from '../online-source.ts';
import { startFakeProviderServer, wavFixture, type FakeProviderServer } from '../testing/fake-provider-server.ts';

const endpoint = 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
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
  const audio = wavFixture();
  const file = path.join(dir, 'chunk.wav');
  await fs.writeFile(file, audio);
  const config: AdapterConfig = {
    providerId: 'custom:ali', baseUrl, credential: key,
    // Reproduce old declarations that incorrectly claim native word timestamps.
    declared: [{ modelId, capability: 'transcribe', wordTimestamps: 'native', maxInputBytes: 25_000_000 }],
  };
  return {
    config, model: new CompatibleAdapter(() => 'ali').models(config)[0]!, file, byteLength: audio.length,
    format: 'wav', durationSec: 0.5, language: { mode: 'assert', tag: 'zh-Hans' }, hint: 'BaoCut',
    signal: new AbortController().signal, http: { attempts: 1, timeoutMs: 2_000 },
  };
}

const reply = {
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello world' } }],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
};

/** Only redirect transport to loopback; retain the real HTTP client, JSON encoding and error handling. */
function loopback() {
  const fetch = globalThis.fetch;
  const urls: string[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    urls.push(String(url));
    const target = new URL(String(url));
    return fetch(`${server!.origin}${target.pathname}`, init);
  });
  return urls;
}

describe('Qwen ASR', () => {
  it('existing ali declarations use audio Chat Completions instead of the 404 transcription route', async () => {
    server = await startFakeProviderServer((r) => r.path.endsWith('/chat/completions') ? { status: 200, json: reply } : { status: 404 });
    const urls = loopback();
    const input = await request();
    const result = await new CompatibleAdapter(() => 'ali').transcribeChunk(input);
    expect(urls).toEqual([`${endpoint}/chat/completions`]);
    expect(result).toEqual({ text: 'hello world', usage: reply.usage });
    const sent = server.requests[0]!;
    expect(sent.headers.authorization).toBe(`Bearer ${key}`);
    expect(sent.headers['content-type']).toBe('application/json');
    expect(sent.json).toEqual({
      model: input.model.modelId, stream: false,
      messages: [
        { role: 'system', content: 'BaoCut' },
        { role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${(await fs.readFile(input.file)).toString('base64')}` } }] },
      ],
      asr_options: { language: 'zh', enable_itn: false },
    });
    expect(JSON.stringify(sent.json)).not.toContain(key);
    expect(input.model).toMatchObject({ wordTimestamps: 'none', maxInputBytes: 7_000_000, maxDurationSec: 300 });
    expect(new CompatibleAdapter(() => 'ali').preferredChunkSec(input.model)).toBe(120);
  });

  it.each(['qwen3-asr-flash', 'qwen-audio-3.1-asr-flash', 'qwen3-asr-flash-2025-09-08'])('supports %s without forcing a preferred language or an empty hint', async (id) => {
    server = await startFakeProviderServer(() => ({ status: 200, json: reply }));
    loopback();
    const input = await request(id);
    input.language = { mode: 'prefer', tag: 'en' };
    delete input.hint;
    await new CompatibleAdapter(() => 'ali').transcribeChunk(input);
    expect(server.requests[0]!.json).toMatchObject({ messages: [{ role: 'user' }], asr_options: { enable_itn: false } });
    expect((server.requests[0]!.json as { asr_options: object }).asr_options).not.toHaveProperty('language');
  });

  it('recognizes legacy Alibaba endpoints and keeps stricter user limits', () => {
    const adapter = new CompatibleAdapter(() => 'ali');
    for (const baseUrl of ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1']) {
      const model = adapter.models({
        providerId: 'custom:ali', baseUrl, credential: null,
        declared: [{ modelId: 'qwen3-asr-flash-latest', maxInputBytes: 100_000, maxDurationSec: 5 }],
      })[0]!;
      expect(model).toMatchObject({ wordTimestamps: 'none', maxInputBytes: 100_000, maxDurationSec: 5 });
    }
  });

  it('does not change Whisper-compatible endpoints serving similarly named models', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { text: 'hello' } }));
    const input = await request('qwen-audio-3.0-asr-flash', `${server.origin}/v1`);
    await new CompatibleAdapter(() => 'local').transcribeChunk(input);
    expect(server.requests[0]!.path).toBe('/v1/audio/transcriptions');
    expect(server.requests[0]!.file).not.toBeNull();
    expect(input.model.wordTimestamps).toBe('native');
  });

  it('does not recognize lookalike hosts or rewrite arbitrary model names', async () => {
    for (const base of ['https://dashscope.aliyuncs.com.evil.test/v1', 'https://notaliyuncs.com/v1']) {
      expect((await request('qwen-audio-3.0-asr-flash', base)).model.wordTimestamps).toBe('native');
    }
    expect((await request('whisper-1')).model.wordTimestamps).toBe('native');
    const filetrans = await request('qwen-audio-3.0-asr-flash-filetrans');
    expect(filetrans.model).toMatchObject({ available: false, unavailableReason: 'unsupported' });
    await expect(new CompatibleAdapter(() => 'ali').transcribeChunk(filetrans)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it.each([
    {}, { choices: [{ message: {} }] },
    { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] },
  ])('rejects malformed or incomplete results instead of publishing a partial transcript', async (json) => {
    server = await startFakeProviderServer(() => ({ status: 200, json }));
    loopback();
    await expect(new CompatibleAdapter(() => 'ali').transcribeChunk(await request())).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('accepts empty speech and preserves HTTP authentication errors', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: '' } }] } }));
    loopback();
    const adapter = new CompatibleAdapter(() => 'ali');
    expect(await adapter.transcribeChunk(await request())).toEqual({ text: '' });
    server.handler = () => ({ status: 401, json: { error: { message: 'unauthorized' } } });
    await expect(adapter.transcribeChunk(await request())).rejects.toMatchObject({ details: { code: 'PROVIDER_AUTH_FAILED', status: 401 } });
  });

  it('registers Qwen ASR and transcribes long audio through ffmpeg with estimated timestamps', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-qwen-source-'));
    const store = await ModelServiceStore.open(
      { modelServicesFile: path.join(dir, 'model-services.json') },
      new FileCredentialStore(path.join(dir, 'credentials.json')),
    );
    server = await startFakeProviderServer((r) => r.path.endsWith('/chat/completions') ? { status: 200, json: reply } : { status: 404 });
    const source = new OnlineProviderSource({ store, baseUrls: { qwen: `${server.origin}/compatible-mode/v1` }, ffmpeg: async () => ({ command: 'ffmpeg', env: process.env }) });
    await source.configure({ providerId: 'qwen', enabled: true });
    await source.addAccount({ providerId: 'qwen', credential: key, region: 'cn' });
    const view = (await source.describe('qwen', 'view'))!;
    expect(view.capabilities.transcribe).toMatchObject({ available: true });
    expect(view.capabilities.transcribe!.models).toContainEqual(expect.objectContaining({ modelId: 'qwen-audio-3.0-asr-flash', wordTimestamps: 'none' }));
    expect(view.capabilities.generateText).toBeDefined();
    expect(view.vendor?.planned).not.toContain('transcribe');
    const transcriber = source.transcriber('qwen')!;
    expect(transcriber).not.toBeNull();
    const file = path.join(dir, 'long.wav');
    await fs.writeFile(file, wavFixture(125, 16_000));
    const staging = path.join(dir, 'staging');
    await fs.mkdir(staging);
    const attempt = await transcriber.transcribe({
      jobId: 'qwen-test', runGeneration: 1, providerId: 'qwen', modelId: 'qwen-audio-3.0-asr-flash', bundleId: null,
      input: { file, contentHash: 'sha256:test', track: 0 },
      options: { language: { mode: 'prefer', tag: null }, diarize: false, timescale: 48_000 }, staging,
    }, { loading() {}, phase() {}, progress() {}, segment() {}, warning() {}, language() {} }, new AbortController().signal);
    expect(attempt.outcome).toBe('completed');
    const result = JSON.parse(await fs.readFile(path.join(staging, 'result.json'), 'utf8')) as AsrResult;
    expect(validateAsrResult(result, { runGeneration: 1 })).toMatchObject({ ok: true });
    expect(server.requests).toHaveLength(2);
    expect(server.requests.every((r) => r.path === '/compatible-mode/v1/chat/completions')).toBe(true);
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments.flatMap((s) => s.words).every((w) => w.timingQuality === 'estimated')).toBe(true);
    expect(result.segments.at(-1)!.end).toBeGreaterThan(120 * 48_000);
    expect(await fs.readdir(staging)).toEqual(['result.json']);
  });
});
