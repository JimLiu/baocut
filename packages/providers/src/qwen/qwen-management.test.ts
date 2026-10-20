import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProvidersConfig as PC } from '@baocut/protocol/messages/providers';
import { ModelServiceStore } from '@baocut/models';
import { FileCredentialStore } from '@baocut/runtime-storage';
import { OnlineProviderSource } from '../online-source.ts';
import { startFakeProviderServer, type FakeProviderServer } from '../testing/fake-provider-server.ts';

let directory: string | undefined;
let server: FakeProviderServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});
async function fixture() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-qwen-management-'));
  const store = await ModelServiceStore.open({ modelServicesFile: path.join(directory, 'models.json') }, new FileCredentialStore(path.join(directory, 'credentials.json')));
  const source = new OnlineProviderSource({ store, ffmpeg: async () => ({ command: 'ffmpeg', env: {} }), baseUrls: { qwen: server ? `${server.origin}/v1` : 'https://example.invalid/v1' } });
  await source.configure({ providerId: 'qwen', enabled: true });
  await source.addAccount({ providerId: 'qwen', credential: 'sk-fixture-not-a-real-key' });
  return { source, store };
}

describe('Qwen additional models', () => {
  it('merges declared text/ASR models while retaining presets and protecting their IDs', async () => {
    const { source } = await fixture();
    await source.configure({ providerId: 'qwen', models: [
      { modelId: 'deepseek-v4.1-flash-1017', capability: 'generateText' },
      { modelId: 'qwen3-asr-flash-latest', capability: 'transcribe' },
    ] });
    const view = (await source.describe('qwen', 'view'))!;
    expect(view.capabilities.generateText!.models).toHaveLength(4);
    expect(view.capabilities.generateText!.models.find((m) => m.modelId === 'deepseek-v4.1-flash-1017')).toMatchObject({ declared: true });
    expect(view.capabilities.transcribe!.models.find((m) => m.modelId === 'qwen3-asr-flash-latest')).toMatchObject({ declared: true, wordTimestamps: 'none' });
    await expect(source.configure({ providerId: 'qwen', models: [{ modelId: 'qwen3.8-max', capability: 'generateText' }] })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(source.configure({ providerId: 'qwen', models: [{ modelId: 'tts', capability: 'synthesizeSpeech' }] })).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('treats missing Qwen and declared IDs as advisory, but keeps filetrans unsupported', async () => {
    server = await startFakeProviderServer(() => ({ status: 200, json: { data: [{ id: 'other' }] } }));
    const { source } = await fixture();
    await source.configure({ providerId: 'qwen', models: [
      { modelId: 'deepseek-v4.1-flash-1017', capability: 'generateText' },
      { modelId: 'qwen-audio-3.0-asr-flash-filetrans', capability: 'transcribe' },
    ] });
    await source.refresh('qwen');
    const view = (await source.describe('qwen', 'view'))!;
    const text = view.capabilities.generateText!.models;
    expect(text.every((m) => m.available !== false)).toBe(true);
    expect(text.find((m) => m.declared)?.detail).toBe(PC.modelListUnverified().text);
    const asr = view.capabilities.transcribe!.models;
    expect(asr.find((m) => m.modelId === 'qwen-audio-3.0-asr-flash')?.available).not.toBe(false);
    expect(asr.find((m) => m.modelId.includes('filetrans'))).toMatchObject({ available: false, unavailableReason: 'unsupported' });
    expect(asr.find((m) => m.modelId.includes('filetrans'))?.detail).toBe(PC.asyncTranscriptionUnsupported().text);
  });

  it('removes only user declarations and clears their defaults without touching accounts or ali', async () => {
    const { source, store } = await fixture();
    await source.configure({ providerId: 'qwen', models: [{ modelId: 'extra-text', capability: 'generateText' }] });
    await store.setDefault('generateText', { providerId: 'qwen', modelId: 'extra-text' });
    await store.setDefault('transcribe', { providerId: 'custom:ali', modelId: 'keep-asr' });
    await source.configure({ providerId: 'custom:ali', endpoint: 'https://example.invalid/v1', models: [{ modelId: 'keep-asr' }] });
    const before = structuredClone(store.provider('custom:ali'));
    const credentialsBefore = await fs.readFile(path.join(directory!, 'credentials.json'), 'utf8');
    const accounts = (await source.describe('qwen', 'view'))!.config!.accounts;
    await source.configure({ providerId: 'qwen', models: [] });
    expect(store.getDefault('generateText')).toBeNull();
    expect(store.getDefault('transcribe')).toEqual({ providerId: 'custom:ali', modelId: 'keep-asr' });
    expect(store.provider('custom:ali')).toEqual(before);
    expect(await fs.readFile(path.join(directory!, 'credentials.json'), 'utf8')).toBe(credentialsBefore);
    expect((await source.describe('qwen', 'view'))!.config!.accounts).toEqual(accounts);
    expect((await source.describe('qwen', 'view'))!.capabilities.generateText!.models).toHaveLength(3);
    expect(source.textProvider('qwen')).not.toBeNull();
  });
});
