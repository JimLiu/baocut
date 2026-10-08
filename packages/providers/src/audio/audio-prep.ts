import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProviderFailure } from '@baocut/models';
import { ProviderAborted } from '../http/provider-fetch.ts';
import { parseSilences, type Silence } from './chunk-plan.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

/**
 * 在线 Provider 的音频准备（架构设计 §6.4）：ffmpeg 把素材的一条音轨解成单声道 16 kHz 的 WAV（staging 里的母带），
 * 在母带上找静音，再按切片计划把每一块编码成供应商接受的格式。素材文件只经 ffmpeg 流式读取，不整读进内存。
 *
 * 安全口径同 Model Worker 的解码（`crates/model-runtime/src/audio.rs`）：不经 shell，只许读本地文件，
 * 只许白名单里的解复用器；ffmpeg 的输出里有路径，错误信息里不带它。
 */

/** 与 Model Worker 相同的解复用器白名单（素材的媒体类型不一定随任务保存，统一用这一份）。 */
export const DEMUXER_ALLOWLIST = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,aac,mp3,wav,flac,ogg';
export const SAMPLE_RATE = 16_000;
/** 母带：16 位单声道，每秒的字节数。 */
export const MASTER_BYTES_PER_SEC = SAMPLE_RATE * 2;

export interface FfmpegTool {
  command: string;
  env: NodeJS.ProcessEnv;
}
export type FfmpegResolver = () => Promise<FfmpegTool>;

/** 切片的编码。`bytesPerSec` 是这种编码每秒最多的字节数（算切片上限用），`overheadBytes` 是容器的固定开销。 */
export type ChunkFormat = 'wav' | 'flac' | 'm4a';
export const CHUNK_FORMATS: Record<
  ChunkFormat,
  { extension: string; mimeType: string; bytesPerSec: number; overheadBytes: number; args: readonly string[] }
> = {
  wav: {
    extension: 'wav',
    mimeType: 'audio/wav',
    bytesPerSec: MASTER_BYTES_PER_SEC,
    overheadBytes: 1024,
    args: ['-c:a', 'pcm_s16le', '-f', 'wav'],
  },
  // FLAC 不会比原始 PCM 大多少；按 PCM 算并留余量。
  flac: {
    extension: 'flac',
    mimeType: 'audio/flac',
    bytesPerSec: MASTER_BYTES_PER_SEC,
    overheadBytes: 8192,
    args: ['-c:a', 'flac', '-f', 'flac'],
  },
  // AAC 64 kbit/s：每秒约 8000 字节，按 9000 算。
  m4a: {
    extension: 'm4a',
    mimeType: 'audio/mp4',
    bytesPerSec: 9000,
    overheadBytes: 64 * 1024,
    args: ['-c:a', 'aac', '-b:a', '64k', '-f', 'mp4', '-movflags', '+faststart'],
  },
};

const STDERR_LIMIT = 1024 * 1024;
const EXTRACT_TIMEOUT_MS = 60 * 60_000;
const SILENCE_TIMEOUT_MS = 30 * 60_000;
const ENCODE_TIMEOUT_MS = 10 * 60_000;
/** 解出来的音频比请求的 range 短这么多秒以上，就报 `range-clamped`（同 Model Worker）。 */
export const RANGE_CLAMP_TOLERANCE_SEC = 0.05;

export interface ExtractRequest {
  ffmpeg: FfmpegResolver;
  /** 素材文件（绝对路径）。 */
  file: string;
  /** 第几条音轨（`0:a:<track>`）。 */
  track: number;
  /** 只解这一段（秒）；`durationSec` 为 null 时到结尾。 */
  range?: { startSec: number; durationSec: number | null };
  /** 母带写在这里。 */
  out: string;
  signal: AbortSignal;
}

/** 解出母带。素材没有这条音轨时返回 `no-audio-track`。 */
export async function extractAudio(request: ExtractRequest): Promise<{ durationSec: number } | 'no-audio-track'> {
  const before: string[] = [];
  if (request.range && request.range.startSec > 0) before.push('-ss', request.range.startSec.toFixed(6));
  if (request.range && request.range.durationSec !== null) before.push('-t', request.range.durationSec.toFixed(6));
  await fs.mkdir(path.dirname(request.out), { recursive: true });
  const args = [
    ...COMMON_ARGS,
    '-v',
    'error',
    '-format_whitelist',
    DEMUXER_ALLOWLIST,
    ...before,
    '-i',
    `file:${request.file}`,
    '-map',
    `0:a:${request.track}`,
    '-vn',
    '-sn',
    '-dn',
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    '-y',
    `file:${request.out}`,
  ];
  const run = await runFfmpeg(request.ffmpeg, args, request.signal, EXTRACT_TIMEOUT_MS);
  if (run.code !== 0) {
    if (run.stderr.includes('matches no streams')) return 'no-audio-track';
    throw new ProviderFailure('input-unreadable', PH.audioUnreadable().text);
  }
  return { durationSec: await wavDurationSec(request.out) };
}

/** 在母带上找静音（`silencedetect`）。只为切片找切点，失败时返回空表（退回硬切）。 */
export async function detectSilences(request: {
  ffmpeg: FfmpegResolver;
  master: string;
  durationSec: number;
  signal: AbortSignal;
  noiseDb?: number;
  minSilenceSec?: number;
}): Promise<Silence[]> {
  const filter = `silencedetect=noise=${request.noiseDb ?? -35}dB:d=${request.minSilenceSec ?? 0.4}`;
  const args = [
    ...COMMON_ARGS,
    '-nostats',
    '-v',
    'info',
    '-format_whitelist',
    'wav',
    '-i',
    `file:${request.master}`,
    '-af',
    filter,
    '-f',
    'null',
    '-',
  ];
  const run = await runFfmpeg(request.ffmpeg, args, request.signal, SILENCE_TIMEOUT_MS);
  if (run.code !== 0) return [];
  return parseSilences(run.stderr, request.durationSec);
}

/** 从母带切出 [start, end) 编码成一块。 */
export async function encodeChunk(request: {
  ffmpeg: FfmpegResolver;
  master: string;
  startSec: number;
  endSec: number;
  format: ChunkFormat;
  out: string;
  signal: AbortSignal;
}): Promise<{ path: string; byteLength: number }> {
  const format = CHUNK_FORMATS[request.format];
  const args = [
    ...COMMON_ARGS,
    '-v',
    'error',
    '-format_whitelist',
    'wav',
    '-ss',
    request.startSec.toFixed(6),
    '-t',
    Math.max(0.001, request.endSec - request.startSec).toFixed(6),
    '-i',
    `file:${request.master}`,
    '-map_metadata',
    '-1',
    ...format.args,
    '-y',
    `file:${request.out}`,
  ];
  const run = await runFfmpeg(request.ffmpeg, args, request.signal, ENCODE_TIMEOUT_MS);
  if (run.code !== 0) throw new ProviderFailure('crashed', PH.chunkEncodeFailed().text);
  const stat = await fs.stat(request.out);
  return { path: request.out, byteLength: stat.size };
}

/** 读 WAV 的 `fmt ` 与 `data` 块算时长（ffmpeg 可能在前面加 `LIST` 块，不能假定头是 44 字节）。 */
export async function wavDurationSec(file: string): Promise<number> {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const head = Buffer.alloc(Math.min(64 * 1024, stat.size));
    await handle.read(head, 0, head.length, 0);
    if (head.length < 12 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
      throw new ProviderFailure('crashed', PH.notWav().text);
    }
    let byteRate = 0;
    let offset = 12;
    while (offset + 8 <= head.length) {
      const id = head.toString('ascii', offset, offset + 4);
      const size = head.readUInt32LE(offset + 4);
      const body = offset + 8;
      if (id === 'fmt ' && body + 12 <= head.length) byteRate = head.readUInt32LE(body + 8);
      if (id === 'data') {
        if (byteRate <= 0) break;
        // 写不了长度的流式 WAV 里 data 的长度是 0 或 0xFFFFFFFF：按文件的实际大小算。
        const bytes = size === 0 || size === 0xffffffff || body + size > stat.size ? stat.size - body : size;
        return bytes / byteRate;
      }
      offset = body + size + (size % 2);
    }
    throw new ProviderFailure('crashed', PH.wavMissingChunks().text);
  } finally {
    await handle.close();
  }
}

const COMMON_ARGS = ['-nostdin', '-hide_banner', '-protocol_whitelist', 'file'] as const;

/** 运行一次 ffmpeg：不经 shell；`signal` 中止时结束进程并抛 `ProviderAborted`。 */
function runFfmpeg(
  resolve: FfmpegResolver,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ code: number | null; stderr: string }> {
  if (signal.aborted) return Promise.reject(new ProviderAborted());
  return resolve().then(
    ({ command, env }) =>
      new Promise((done, reject) => {
        const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = () => {
          child.kill('SIGKILL');
          finish(() => reject(new ProviderAborted()));
        };
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs);
        signal.addEventListener('abort', onAbort, { once: true });
        child.stderr.on('data', (chunk: Buffer) => {
          if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8');
        });
        child.on('error', (error: NodeJS.ErrnoException) =>
          finish(() =>
            reject(
              error.code === 'ENOENT'
                ? new ProviderFailure('unavailable', PH.ffmpegMissing().text)
                : new ProviderFailure('unavailable', PH.ffmpegRunFailed({ error: error.message }).text),
            ),
          ),
        );
        child.on('close', (code) =>
          finish(() => (timedOut ? reject(new ProviderFailure('crashed', PH.ffmpegTimeout().text)) : done({ code, stderr }))),
        );
      }),
  );
}
