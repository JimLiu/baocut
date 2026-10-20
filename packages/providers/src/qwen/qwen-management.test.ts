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
  it.each(['qwen-audio-3.0-asr-flash', 'qwen-audio-3.1-asr-flash', 'qwen3-asr-flash'])(
    'adds and removes %s as a user model without refresh restoring it', async (modelId) => {
      server = await startFakeProviderServer(() => ({ status: 200, json: { data: [{ id: modelId }] } }));
      const { source, store } = await fixture();
      expect((await source.describe('qwen', 'view'))!.capabilities.transcribe!.models).toEqual([]);
      const accounts = structuredClone(store.provider('qwen')!.accounts);
      await source.configure({ providerId: 'qwen', models: [{ modelId, capability: 'transcribe' }] });
      expect((await source.describe('qwen', 'view'))!.capabilities.transcribe!.models)
        .toEqual([expect.objectContaining({ modelId, declared: true })]);
      await store.setDefault('transcribe', { providerId: 'qwen', modelId });
      await source.configure({ providerId: 'qwen', models: [] });
      await source.refresh('qwen');
      expect((await source.describe('qwen', 'view'))!.capabilities.transcribe!.models).toEqual([]);
      expect(store.getDefault('transcribe')).toBeNull();
      expect(store.provider('qwen')!.accounts).toEqual(accounts);
      await source.configure({ providerId: 'qwen', models: [{ modelId, capability: 'transcribe' }] });
      expect((await source.describe('qwen', 'view'))!.capabilities.transcribe!.models)
        .toEqual([expect.objectContaining({ modelId, declared: true })]);
    },
  );

  it('retains text preset declarations while ASR declarations are fully removable', async () => {
    const { source, store } = await fixture();
    // Text can overlap a preset; ASR IDs are always user declarations.
    await store.updateProvider('qwen', { models: [
      { modelId: 'qwen3.8-max', capability: 'generateText' },
      { modelId: 'qwen-audio-3.0-asr-flash', maxDurationSec: 1 },
      { modelId: 'qwen-audio-3.1-asr-flash', capability: 'transcribe' },
      { modelId: 'qwen3-asr-flash', capability: 'transcribe' },
    ] });
    const before = structuredClone(store.provider('qwen'));
    const credentialsBefore = await fs.readFile(path.join(directory!, 'credentials.json'), 'utf8');
    let view = (await source.describe('qwen', 'view'))!;
    expect(view.capabilities.transcribe!.models).toHaveLength(3);
    expect(view.capabilities.transcribe!.models.every((m) => m.declared)).toBe(true);
    expect(view.capabilities.transcribe!.models.find((m) => m.modelId === 'qwen-audio-3.0-asr-flash'))
      .toMatchObject({ maxDurationSec: 1, wordTimestamps: 'native', declared: true });
    expect(view.capabilities.generateText!.models.find((m) => m.modelId === 'qwen3.8-max')?.declared).toBe(true);
    const kept = [...before!.models!, { modelId: 'extra-text', capability: 'generateText' as const }];
    await source.configure({ providerId: 'qwen', models: kept });
    expect(store.provider('qwen')!.models).toEqual(kept);
    // An existing declaration cannot be moved to another preset capability.
    await expect(source.configure({ providerId: 'qwen', models: [
      { modelId: 'qwen3.8-max', capability: 'transcribe' },
    ] })).rejects.toMatchObject({ code: 'invalid-request' });
    await store.setDefault('transcribe', { providerId: 'qwen', modelId: 'qwen3-asr-flash' });
    await store.setDefault('generateText', { providerId: 'qwen', modelId: 'extra-text' });
    await source.configure({ providerId: 'qwen', models: kept.filter((m) => m.modelId !== 'qwen3-asr-flash') });
    view = (await source.describe('qwen', 'view'))!;
    expect(view.capabilities.transcribe!.models).toHaveLength(2);
    expect(view.capabilities.transcribe!.models.some((m) => m.modelId === 'qwen3-asr-flash')).toBe(false);
    expect(view.capabilities.transcribe!.models.find((m) => m.modelId === 'qwen-audio-3.1-asr-flash')?.declared).toBe(true);
    expect(store.getDefault('transcribe')).toBeNull();
    expect(store.getDefault('generateText')).toEqual({ providerId: 'qwen', modelId: 'extra-text' });
    expect(store.provider('qwen')!.accounts).toEqual(before!.accounts);
    expect(await fs.readFile(path.join(directory!, 'credentials.json'), 'utf8')).toBe(credentialsBefore);
    // Removed ASR models can be explicitly added again.
    await source.configure({ providerId: 'qwen', models: kept });
    expect((await source.describe('qwen', 'view'))!.capabilities.transcribe!.models).toHaveLength(3);
  });

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
      { modelId: 'qwen-audio-3.0-asr-flash', capability: 'transcribe' },
    ] });
    await source.refresh('qwen');
    const view = (await source.describe('qwen', 'view'))!;
    const text = view.capabilities.generateText!.models;
    expect(text.every((m) => m.available !== false)).toBe(true);
    expect(text.find((m) => m.declared)?.detail).toBe(PC.modelListUnverified().text);
    const asr = view.capabilities.transcribe!.models;
    expect(asr.find((m) => m.modelId === 'qwen-audio-3.0-asr-flash')).toMatchObject({ declared: true });
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
