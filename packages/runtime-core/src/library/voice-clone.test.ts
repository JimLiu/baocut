import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { startFakeProviderServer, wavFixture, type FakeProviderServer, type FakeReply } from '@baocut/providers/testing';
import { RpcError, newId, type Id, type JobRecord, type JobsEvent, type JobsSnapshot, type LibraryEntry } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * 音色克隆（架构设计 §5.9）：`library.createVoiceClone` / `library.removeVoiceClone` 经真实的 Runtime，ElevenLabs 与 Google 指向
 * 本机回环地址上的假供应商。密钥是测试里编的字符串。参考录音的解码校验要 ffprobe（没有时跳过）。
 */

const KEY = 'xi-test-ONLY-FOR-TESTS-voice-clone-0123456789';
const GOOGLE_KEY = 'AIzaTESTONLY-voice-clone-0123456789abcdef';

const ffprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!ffprobe) console.warn('跳过音色克隆的测试：没有 ffprobe');
const mp3Encoder = (() => {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libmp3lame');
  } catch {
    return false;
  }
})();

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

describe.skipIf(!ffprobe)('音色克隆', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let fake: FakeProviderServer;
  let reference: string;
  /** 假供应商对删除的回复（默认成功）。 */
  let deleteReply: () => FakeReply;
  const jobs = new Map<Id, JobRecord>();

  beforeEach(async () => {
    let created = 0;
    deleteReply = () => ({ status: 200, json: { status: 'ok' } });
    fake = await startFakeProviderServer((request) => {
      if (request.method === 'POST' && request.path === '/v1/voices/add') {
        created++;
        return { status: 200, json: { voice_id: `clone-${created}`, requires_verification: false } };
      }
      if (request.method === 'DELETE' && request.path.startsWith('/v1/voices/')) return deleteReply();
      return { status: 404, json: { detail: 'not found' } };
    });
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-voice-clone-'));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      online: { baseUrls: { elevenlabs: `${fake.origin}/v1`, google: `${fake.origin}/v1beta` }, http: { backoffMs: () => 5 } },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    jobs.clear();
    client.subscribeJobs({
      snapshot: (snapshot: JobsSnapshot) => {
        for (const job of snapshot.jobs) jobs.set(job.jobId, job);
      },
      event: (event: JobsEvent) => void (event.type === 'job.updated' && jobs.set(event.job.jobId, event.job)),
    });
    reference = path.join(dir, 'reference.wav');
    await fs.writeFile(reference, wavFixture(1));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fake.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function settled(jobId: Id): Promise<JobRecord> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const job = jobs.get(jobId);
      if (job && (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled')) return job;
      if (Date.now() > deadline) throw new Error(`等任务 ${jobId} 超时`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function voice(declared: boolean): Promise<LibraryEntry> {
    const { entry } = await client.request('library.put', {
      library: 'voices',
      content: {
        name: '我的声音',
        language: 'zh-Hans',
        transcript: '你好',
        origin: 'recorded',
        consent: { declared, statement: declared ? '这是我自己的声音' : null },
      },
      source: { path: reference },
    });
    return entry;
  }

  async function enable(): Promise<void> {
    await client.request('models.configure', { providerId: 'elevenlabs', enabled: true, credential: KEY });
  }

  async function grantAudio(): Promise<Id> {
    const { grant } = await client.request('grants.create', {
      recipient: 'elevenlabs',
      dataKinds: ['audio'],
      purpose: '克隆音色',
      budgetMode: 'per-call-unknown-cost',
    });
    return grant.grantId;
  }

  async function clone(id: Id): Promise<JobRecord> {
    const { jobId } = await client.request('library.createVoiceClone', { id, providerId: 'elevenlabs', commandId: newId('cmd') });
    return settled(jobId);
  }

  it('没有授权声明、没有克隆接口、没有覆盖 audio 的授权时拒绝，不建任务、不发请求', async () => {
    await enable();
    const unconsented = await voice(false);
    const consent = await rejection(client.request('library.createVoiceClone', { id: unconsented.id, providerId: 'elevenlabs' }));
    expect(consent.code).toBe('conflict');
    expect(consent.details).toMatchObject({ code: 'VOICE_CONSENT_REQUIRED' });

    const declared = await voice(true);
    const unsupported = await rejection(client.request('library.createVoiceClone', { id: declared.id, providerId: 'openai' }));
    expect(unsupported.details).toMatchObject({ code: 'VOICE_CLONE_UNSUPPORTED' });

    // 启用 Provider 发放的默认授权不含 audio：克隆要用户另外授权。
    const ungranted = await rejection(client.request('library.createVoiceClone', { id: declared.id, providerId: 'elevenlabs' }));
    expect(ungranted.code).toBe('forbidden');
    expect(ungranted.details).toMatchObject({ code: 'GRANT_REQUIRED' });

    expect([...jobs.values()].filter((job) => job.kind === 'voiceClone')).toEqual([]);
    expect(fake.requests).toEqual([]);
  });

  it('建立：上传参考录音、记下克隆、结算授权；参考录音改了转为 stale；重新克隆替换并删掉旧的；删除', async () => {
    await enable();
    const grantId = await grantAudio();
    const entry = await voice(true);

    const job = await clone(entry.id);
    expect(job).toMatchObject({ kind: 'voiceClone', state: 'completed', providerId: 'elevenlabs', videoId: null });
    expect(job.library?.entries).toEqual([{ library: 'voices', id: entry.id, version: 1, contentHash: entry.contentHash }]);
    const upload = fake.requests[0]!;
    expect(upload.method).toBe('POST');
    expect(upload.headers['xi-api-key']).toBe(KEY);
    expect(upload.fields.name).toEqual(['我的声音']);
    expect(upload.file).toMatchObject({ name: 'reference.wav', type: 'audio/wav', size: wavFixture(1).length });
    // 密钥只在请求头里：任务记录与库条目都没有。
    expect(JSON.stringify(job)).not.toContain(KEY);

    let { entry: after } = await client.request('library.get', { library: 'voices', id: entry.id });
    expect(after.clones?.elevenlabs).toMatchObject({
      voiceId: 'clone-1',
      state: 'valid',
      referenceHash: (entry.content as { reference: { sha256: string } }).reference.sha256,
    });
    const usage = await client.request('grants.usage', { grantId });
    expect(usage.grant.usage.calls).toBe(1);

    // 已经有有效克隆：拒绝。
    const exists = await rejection(client.request('library.createVoiceClone', { id: entry.id, providerId: 'elevenlabs' }));
    expect(exists.details).toMatchObject({ code: 'VOICE_CLONE_EXISTS' });

    // 换参考录音：旧克隆转为 stale。
    const changed = path.join(dir, 'changed.wav');
    await fs.writeFile(changed, wavFixture(1.5));
    await client.request('library.put', {
      library: 'voices',
      id: entry.id,
      content: {
        name: '我的声音',
        language: 'zh-Hans',
        transcript: '你好呀',
        origin: 'recorded',
        consent: { declared: true, statement: '这是我自己的声音' },
      },
      source: { path: changed },
    });
    ({ entry: after } = await client.request('library.get', { library: 'voices', id: entry.id }));
    expect(after.clones?.elevenlabs).toMatchObject({ voiceId: 'clone-1', state: 'stale' });

    // 重新克隆：新的有效，旧的远端删掉。
    const again = await clone(entry.id);
    expect(again.state).toBe('completed');
    expect(again.warnings).toEqual([]);
    ({ entry: after } = await client.request('library.get', { library: 'voices', id: entry.id }));
    expect(after.clones?.elevenlabs).toMatchObject({ voiceId: 'clone-2', state: 'valid' });
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/voices/add',
      'POST /v1/voices/add',
      'DELETE /v1/voices/clone-1',
    ]);

    // 远端删除失败：记录保留，如实报告。
    deleteReply = () => ({ status: 500, json: { detail: 'boom' } });
    const failed = await rejection(client.request('library.removeVoiceClone', { id: entry.id, providerId: 'elevenlabs' }));
    expect(failed.code).toBe('conflict');
    expect(failed.details).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(JSON.stringify(failed.details)).not.toContain(KEY);
    ({ entry: after } = await client.request('library.get', { library: 'voices', id: entry.id }));
    expect(after.clones?.elevenlabs?.voiceId).toBe('clone-2');

    // 远端已经没有：照样清掉记录。
    deleteReply = () => ({ status: 404, json: { detail: { status: 'voice_not_found' } } });
    expect(await client.request('library.removeVoiceClone', { id: entry.id, providerId: 'elevenlabs' })).toEqual({
      removed: true,
      remote: 'not-found',
    });
    ({ entry: after } = await client.request('library.get', { library: 'voices', id: entry.id }));
    expect(after.clones ?? {}).toEqual({});
    const missing = await rejection(client.request('library.removeVoiceClone', { id: entry.id, providerId: 'elevenlabs' }));
    expect(missing.code).toBe('not-found');
  });

  it('删除了的音色留下的克隆：仍然能删，删完连墓碑一起清掉', async () => {
    await enable();
    await grantAudio();
    const entry = await voice(true);
    expect((await clone(entry.id)).state).toBe('completed');
    await client.request('library.remove', { library: 'voices', id: entry.id });
    expect(await client.request('library.removeVoiceClone', { id: entry.id, providerId: 'elevenlabs' })).toEqual({
      removed: true,
      remote: 'deleted',
    });
    expect(fake.requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/voices/clone-1' });
    await runtime.library.store.idle();
    await expect(fs.stat(path.join(runtime.library.store.dir, 'voices', entry.id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('供应商拒绝上传：任务失败，带 Provider 的错误码，不记克隆；授权按失败结算', async () => {
    await enable();
    const grantId = await grantAudio();
    const entry = await voice(true);
    fake.handler = () => ({ status: 401, json: { detail: { status: 'invalid_api_key' } } });
    const job = await clone(entry.id);
    expect(job.state).toBe('failed');
    expect(job.error).toMatchObject({ code: 'PROVIDER_AUTH_FAILED', details: { providerId: 'elevenlabs', status: 401 } });
    expect(JSON.stringify(job)).not.toContain(KEY);
    const { entry: after } = await client.request('library.get', { library: 'voices', id: entry.id });
    expect(after.clones ?? {}).toEqual({});
    const usage = await client.request('grants.usage', { grantId });
    expect(usage.grant.usage.reservedCalls).toBe(0);
  });

  it('Gemini 拒绝克隆：任务失败，原因与 HTTP 状态进 error.details，界面据此说明', async () => {
    await client.request('models.configure', { providerId: 'google', enabled: true, credential: GOOGLE_KEY });
    await client.request('grants.create', { recipient: 'google', dataKinds: ['audio'], purpose: '克隆音色', budgetMode: 'per-call-unknown-cost' });
    const consent = path.join(dir, 'consent.wav');
    await fs.writeFile(consent, wavFixture(1));
    const { entry } = await client.request('library.put', {
      library: 'voices',
      content: {
        name: 'My voice',
        language: 'en-US',
        transcript: 'hello',
        origin: 'recorded',
        consent: { declared: true, statement: 'This is my own voice' },
        consentClip: { language: 'en-US' },
      },
      source: { path: reference },
      consentSource: { path: consent },
    });
    fake.handler = (request) =>
      request.method === 'POST' && request.path === '/v1beta/voices'
        ? {
            status: 400,
            json: {
              error: {
                code: 400,
                message: 'Speaker verification failed: the voice in the consent audio does not match the source audio.',
                status: 'INVALID_ARGUMENT',
              },
            },
          }
        : { status: 404, json: { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } } };
    const { jobId } = await client.request('library.createVoiceClone', { id: entry.id, providerId: 'google', commandId: newId('cmd') });
    const job = await settled(jobId);
    expect(job.state).toBe('failed');
    expect(job.error).toMatchObject({
      code: 'PROVIDER_REJECTED',
      details: { providerId: 'google', status: 400, reason: 'speaker-mismatch' },
    });
    expect(job.error!.message).toContain('Speaker verification failed');
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /v1beta/voices']);
    expect(fake.requests[0]!.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    expect(JSON.stringify(job)).not.toContain(GOOGLE_KEY);
    const { entry: after } = await client.request('library.get', { library: 'voices', id: entry.id });
    expect(after.clones ?? {}).toEqual({});
  });

  it('Gemini 收到的参考录音：45 秒的 MP3（没有 MP3 编码器时 FLAC）经真实 ffmpeg 转成 24 kHz 单声道 WAV，截在 30 秒以内', async () => {
    await client.request('models.configure', { providerId: 'google', enabled: true, credential: GOOGLE_KEY });
    await client.request('grants.create', { recipient: 'google', dataKinds: ['audio'], purpose: '克隆音色', budgetMode: 'per-call-unknown-cost' });
    const consent = path.join(dir, 'consent.wav');
    await fs.writeFile(consent, wavFixture(1));
    const long = path.join(dir, mp3Encoder ? 'long.mp3' : 'long.flac');
    // 每 2 秒一拍：1.5 秒的音、0.5 秒静音。
    const pulse = 'if(lt(mod(t\\,2)\\,1.5)\\,0.5*sin(2*PI*220*t)\\,0)';
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=${pulse}|${pulse}:s=44100:c=stereo:d=45`, '-y', long]);
    const { entry } = await client.request('library.put', {
      library: 'voices',
      content: {
        name: 'My voice',
        language: 'en-US',
        transcript: 'hello',
        origin: 'imported',
        consent: { declared: true, statement: 'This is my own voice' },
        consentClip: { language: 'en-US' },
      },
      source: { path: long },
      consentSource: { path: consent },
    });
    expect((entry as LibraryEntry<'voices'>).content.reference.mediaType).toBe(mp3Encoder ? 'audio/mpeg' : 'audio/flac');
    fake.handler = (request) =>
      request.method === 'POST' && request.path === '/v1beta/voices'
        ? { status: 200, json: { id: 'voice_replicated_1' } }
        : { status: 404, json: { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } } };
    const { jobId } = await client.request('library.createVoiceClone', { id: entry.id, providerId: 'google', commandId: newId('cmd') });
    const job = await settled(jobId);
    expect(job.state).toBe('completed');
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /v1beta/voices']);
    const body = fake.requests[0]!.json as { voice: { replicated: { source_audio: { mime_type: string; data: string } } } };
    const source = body.voice.replicated.source_audio;
    expect(source.mime_type).toBe('audio/wav');
    const wav = Buffer.from(source.data, 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    // 适配器写出的 WAV 只有 `fmt `（16 字节）与 `data` 两块。
    expect({ format: wav.readUInt16LE(20), channels: wav.readUInt16LE(22), sampleRate: wav.readUInt32LE(24), bits: wav.readUInt16LE(34) }).toEqual({
      format: 1,
      channels: 1,
      sampleRate: 24_000,
      bits: 16,
    });
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    const seconds = wav.readUInt32LE(40) / (24_000 * 2);
    expect(seconds).toBeLessThanOrEqual(30);
    expect(seconds).toBeGreaterThan(27);
    const { entry: after } = await client.request('library.get', { library: 'voices', id: entry.id });
    expect(after.clones?.google).toMatchObject({ voiceId: 'voice_replicated_1', state: 'valid' });
  });

  it('localOnly：不请求远端，只清记录', async () => {
    await enable();
    await grantAudio();
    const entry = await voice(true);
    await clone(entry.id);
    const before = fake.requests.length;
    expect(await client.request('library.removeVoiceClone', { id: entry.id, providerId: 'elevenlabs', localOnly: true })).toEqual({
      removed: true,
      remote: 'skipped',
    });
    expect(fake.requests.length).toBe(before);
  });
});
