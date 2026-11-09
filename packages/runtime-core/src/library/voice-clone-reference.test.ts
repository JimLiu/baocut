import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobManager, TaskRun, TaskSubmission } from '@baocut/jobs';
import type { Id, JobSubmitter } from '@baocut/protocol';
import { trimWavHead, type VoiceCloner } from '@baocut/providers';
import { LibraryStore } from '@baocut/runtime-storage/library';
import type { GrantService } from '../grants/grant-service.ts';
import { VoiceCloneService } from './voice-clone-service.ts';

/**
 * 交给适配器的参考录音（架构设计 §6.4「音色克隆的请求」）：Provider 公开了参考录音的时长范围（`sourceSeconds`）时，Runtime 先用
 * ffmpeg 把开头 `max + 3` 秒转成 24 kHz 单声道 16 位 WAV，适配器的 `trimWavHead` 再切到 `max` 以内；MP3、FLAC 与 WAV 走同一条路。
 * 没有公开范围的 Provider 拿到原样的录音。ffmpeg 是真的（没有时跳过），任务、授权与 Provider 是假的。
 */

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const hasMp3Encoder = hasFfmpeg && execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libmp3lame');
if (!hasFfmpeg) console.warn('跳过克隆参考录音转换的测试：没有 ffmpeg');

const user: JobSubmitter = { kind: 'connection', id: 'conn_1' };
const RANGE = { min: 10, max: 30 };

/** 每 2 秒一拍：1.5 秒 220 Hz 的音、0.5 秒静音（像一句一句说话，切点该落在静音里）。 */
const PULSES = "if(lt(mod(t\\,2)\\,1.5)\\,0.5*sin(2*PI*220*t)\\,0)";

/** ffmpeg 生成 `seconds` 秒、44.1 kHz 立体声的录音（编码按扩展名）。 */
async function fixture(dir: string, name: string, seconds: number): Promise<Buffer> {
  const out = path.join(dir, name);
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=${PULSES}|${PULSES}:s=44100:c=stereo:d=${seconds}`, '-y', out]);
  return fs.readFile(out);
}

/** WAV 的格式与时长（只认 `fmt ` 与 `data` 两块）。 */
function wavInfo(bytes: Buffer): { sampleRate: number; channels: number; bits: number; format: number; seconds: number } {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bits: number; format: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = { format: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2), sampleRate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt) {
      return { ...fmt, seconds: Math.min(size, bytes.length - body) / (fmt.sampleRate * fmt.channels * (fmt.bits / 8)) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('not a WAV');
}

describe.skipIf(!hasFfmpeg)('克隆的参考录音：转成 WAV 再交给适配器', () => {
  let dir: string;
  let store: LibraryStore;
  let submitted: TaskSubmission[];
  /** 适配器收到的请求，连同它当时读到的录音。 */
  let received: { input: Parameters<VoiceCloner['create']>[0]; bytes: Buffer }[];
  let reserved: number;
  let ffmpeg: string;
  let createFails: boolean;

  const cloner = (sourceSeconds?: { min: number; max: number }): VoiceCloner => ({
    providerId: 'ranged-provider',
    label: 'Ranged Provider',
    version: 'test/1',
    available: () => true,
    requiresConsentClip: false,
    ...(sourceSeconds ? { sourceSeconds } : {}),
    create: async (input) => {
      received.push({ input, bytes: await fs.readFile(input.file) });
      if (createFails) throw new Error('upload failed');
      return { voiceId: `clone-${received.length}` };
    },
    remove: async () => 'deleted',
  });

  const service = (sourceSeconds?: { min: number; max: number }) =>
    new VoiceCloneService({
      store,
      jobs: {
        list: () => [],
        submitTask: async (submission: TaskSubmission) => {
          submitted.push(submission);
          return { jobId: `job-${submitted.length}` as Id };
        },
        artifacts: { put: async () => ({ artifactId: `sha256:${'a'.repeat(64)}` }) },
      } as unknown as JobManager,
      grants: {
        plan: () => ({ status: 'none' }),
        ensureDefault: () => undefined,
        begin: async () => {
          reserved++;
          return () => undefined;
        },
      } as unknown as GrantService,
      cloner: () => cloner(sourceSeconds),
      ffmpeg: async () => ({ command: ffmpeg, env: process.env }),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined, child: () => undefined } as never,
    });

  const run = (): TaskRun => ({
    jobId: 'job-run' as Id,
    staging: path.join(dir, 'staging'),
    signal: new AbortController().signal,
    phase: () => undefined,
    warn: () => undefined,
    command: () => undefined,
  });

  /** 把这段录音存成音色，向这个 Provider 克隆一次（跑完任务）。`sourceSeconds` 为 null 时 Provider 没有公开时长范围。 */
  async function clone(bytes: Buffer, fileName: string, sourceSeconds: { min: number; max: number } | null = RANGE): Promise<void> {
    const { entry } = await store.put({
      library: 'voices',
      content: { name: '我的声音', language: 'en-US', transcript: 'hello', origin: 'imported', consent: { declared: true, statement: 'mine' } },
      file: { bytes, fileName },
    });
    await service(sourceSeconds ?? undefined).create({ id: entry.id, providerId: 'ranged-provider' }, user);
    await submitted.at(-1)!.run(run());
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-voice-clone-reference-'));
    store = await LibraryStore.open({ dir: path.join(dir, 'library'), validateAudio: async () => ({ durationSec: 45 }) });
    submitted = [];
    received = [];
    reserved = 0;
    ffmpeg = 'ffmpeg';
    createFails = false;
  });

  afterEach(async () => {
    await store.idle();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 适配器拿到的是转好的 WAV：24 kHz 单声道 16 位、比上限多转一点；`trimWavHead` 切到上限以内、落在静音里；传完就删掉。 */
  async function expectConverted(baseName: string): Promise<void> {
    expect(received).toHaveLength(1);
    const [{ input, bytes }] = received as [(typeof received)[number]];
    expect(input).toMatchObject({ fileName: `${baseName}.wav`, mediaType: 'audio/wav' });
    const info = wavInfo(bytes);
    expect(info).toMatchObject({ format: 1, sampleRate: 24_000, channels: 1, bits: 16 });
    expect(info.seconds).toBeGreaterThan(RANGE.max);
    expect(info.seconds).toBeLessThanOrEqual(RANGE.max + 3 + 0.05);
    const trimmed = trimWavHead(bytes, RANGE.max);
    expect(trimmed.keptSec).not.toBeNull();
    expect(trimmed.keptSec!).toBeLessThanOrEqual(RANGE.max);
    expect(trimmed.keptSec!).toBeGreaterThan(RANGE.max - 3);
    expect(wavInfo(trimmed.bytes).seconds).toBeLessThanOrEqual(RANGE.max);
    // 每 2 秒里后 0.5 秒是静音：切点落在静音里（MP3 的编码延迟只有几十毫秒）。
    expect(trimmed.keptSec! % 2).toBeGreaterThan(1.45);
    // 转出的临时文件只为这次上传，任务跑完就没有了。
    await expect(fs.stat(input.file)).rejects.toMatchObject({ code: 'ENOENT' });
  }

  it.skipIf(!hasMp3Encoder)('45 秒的 MP3：转成 WAV，适配器能截到 30 秒以内', async () => {
    await clone(await fixture(dir, 'long.mp3', 45), 'ref.mp3');
    await expectConverted('ref');
  });

  it('45 秒的 FLAC：同样转成 WAV', async () => {
    await clone(await fixture(dir, 'long.flac', 45), 'interview.flac');
    await expectConverted('interview');
  });

  it('WAV 也走同一条路：44.1 kHz 立体声转成 24 kHz 单声道', async () => {
    await clone(await fixture(dir, 'long.wav', 45), 'take.wav');
    await expectConverted('take');
  });

  it('比上限短的录音整段转换，不截', async () => {
    await clone(await fixture(dir, 'short.flac', 12), 'short.flac');
    const [{ input, bytes }] = received as [(typeof received)[number]];
    expect(input.mediaType).toBe('audio/wav');
    expect(wavInfo(bytes).seconds).toBeCloseTo(12, 1);
    expect(trimWavHead(bytes, RANGE.max).keptSec).toBeNull();
  });

  it('上传失败时转出的文件同样删掉', async () => {
    createFails = true;
    const error = await clone(await fixture(dir, 'long.flac', 45), 'ref.flac').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'INTERNAL' });
    expect(received).toHaveLength(1);
    await expect(fs.stat(received[0]!.input.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('没有公开时长范围的 Provider 拿到原样的录音', async () => {
    const original = await fixture(dir, 'long.flac', 45);
    await clone(original, 'ref.flac', null);
    const [{ input, bytes }] = received as [(typeof received)[number]];
    expect(input).toMatchObject({ fileName: 'ref.flac', mediaType: 'audio/flac' });
    expect(bytes).toEqual(original);
  });

  it('ffmpeg 找不到：MEDIA_TOOL_UNAVAILABLE（带安装修法），不预留授权、不上传', async () => {
    ffmpeg = path.join(dir, 'no-such-tools', 'ffmpeg');
    const error = await clone(await fixture(dir, 'long.flac', 45), 'ref.flac').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: 'MEDIA_TOOL_UNAVAILABLE',
      details: { tool: 'ffmpeg', providerId: 'ranged-provider', remedy: expect.stringContaining('ffmpeg') },
    });
    expect((error as Error).message).toContain(ffmpeg);
    expect((error as { messageRef?: unknown }).messageRef).toBeDefined();
    expect(reserved).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('ffmpeg 读不出这份录音：原样交出，由 Provider 判断', async () => {
    const broken = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(4096, 7)]);
    await clone(broken, 'broken.mp3');
    const [{ input, bytes }] = received as [(typeof received)[number]];
    expect(input).toMatchObject({ fileName: 'broken.mp3', mediaType: 'audio/mpeg' });
    expect(bytes).toEqual(broken);
    expect(await fs.readdir(path.join(dir, 'staging'))).toEqual([]);
  });
});
