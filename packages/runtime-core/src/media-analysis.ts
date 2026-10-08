import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RpcError, mediaTimeToSeconds, type AssetRevision, type MediaPeaks, type MediaThumbnail } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import { resolveInside } from './media.ts';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';

/**
 * 素材分析（时间线的波形与胶片条）与 Space 的缩略图：Runtime 调 ffmpeg 算出来，缓存在 Runtime Home 里
 * （素材按内容摘要，Space 里的文件按真实路径、大小与修改时间）。界面不自己解码：素材常有几百 MB，大的有几 GB。
 *
 * 安全，与媒体通道同一个口径：
 * - 输入只能是视频里的素材版本，文件位置来自引擎的素材记录，链接素材按媒体通道的规则放行
 *   （`VideoService.mediaSource`、`VideoService.assetFileAt`），或 Space 目录给出的条目文件（`SpaceCatalog.locateBytes`）；
 *   都再取真实路径确认在来源目录之内；
 * - 只分析音视频与常见图片：素材的媒体类型要在 `DEMUXERS` 里，Space 里的文件的扩展名要在 `FILE_FRAMES` 里，ffmpeg 只许用
 *   对应的解复用器、只许读本地文件，改了扩展名的播放列表、拼接清单之类读不进来，也不会顺着它去读别的文件或网络；
 * - ffmpeg 不经 shell 启动；每个进程有时限与输出上限，同时运行的进程数有上限；
 * - 缓存目录名取内容摘要的十六进制，摘要格式不对就拒绝；日志里不写路径。
 */

/** 每种媒体类型（引擎 `media_type_of` 的封闭集合）可以用的解复用器。不在表里的不分析。 */
const DEMUXERS: Record<string, string> = {
  'video/mp4': 'mov',
  'video/quicktime': 'mov',
  'video/webm': 'matroska',
  'video/x-matroska': 'matroska',
  // `.m4a` 是 MP4 容器，`.aac` 是裸的 ADTS 流。
  'audio/mp4': 'mov,aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
};

/**
 * Space 的缩略图按文件取帧（`fileFrame`）：扩展名 → 解复用器。视频与素材分析同一套，另加 AVI。图片只用读单张图的解复用器，
 * 并且用 `-f` 指定（不让 ffmpeg 按扩展名挑到 `image2`：它会把文件名里的 `%d` 当成序列去读别的文件）；能带透明的输出 PNG。
 * 不在表里的不取：SVG ffmpeg 解不了；HEIC、AVIF 常按分块存放，手头的 ffmpeg 只解出第一块，画面不对，不如不画。
 */
const FILE_FRAMES: Record<string, { demuxers: string; still?: true; alpha?: true }> = {
  mp4: { demuxers: 'mov' },
  m4v: { demuxers: 'mov' },
  mov: { demuxers: 'mov' },
  webm: { demuxers: 'matroska' },
  mkv: { demuxers: 'matroska' },
  avi: { demuxers: 'avi' },
  png: { demuxers: 'png_pipe', still: true, alpha: true },
  jpg: { demuxers: 'jpeg_pipe', still: true },
  jpeg: { demuxers: 'jpeg_pipe', still: true },
  webp: { demuxers: 'webp_pipe', still: true, alpha: true },
  gif: { demuxers: 'gif', still: true, alpha: true },
  bmp: { demuxers: 'bmp_pipe', still: true },
};

/** 峰值的默认密度：每秒 50 格（同旧版的 BCW1）。 */
export const PEAKS_PER_SECOND = 50;
/** 峰值最多这么多格（base64 之后约 700 KB）。素材太长时降低密度。 */
export const MAX_PEAKS = 2 ** 19;
/** 解码成单声道 8 kHz 再取峰值：只为画波形，够用。 */
const PEAKS_SAMPLE_RATE = 8000;
/** 缩略图的宽（像素），高按画面比例。 */
export const THUMBNAIL_WIDTH = 160;
/** 缩略图的时间按这个粒度（毫秒）取整，缓存才用得上。 */
export const THUMBNAIL_STEP_MS = 100;

/** 按文件取帧时高度的上限：很长的图片按比例缩到这么高（宽随之变窄），输出不至于太大。 */
const FRAME_MAX_HEIGHT_RATIO = 3;
/** Space 里的文件的缩略图缓存在媒体缓存下的这个目录（不会与 64 位十六进制的素材目录重名）。 */
const FILE_FRAMES_DIR = 'files';

const PEAKS_FILE = 'peaks-v1.json';
const THUMBNAIL_TIMEOUT_MS = 20_000;
const THUMBNAIL_MAX_BYTES = 1024 * 1024;
/** 给智能体看的整幅帧（`videoFrame`）的上限：长边 1920 的 PNG 也放得下。 */
const FRAME_MAX_BYTES = 16 * 1024 * 1024;
const PEAKS_RETRY_MS = 1000;
/** 分析失败之后这么久之内再问，直接回同一个错误，不再启动 ffmpeg。 */
const FAILURE_TTL_MS = 60_000;

export interface MediaSource {
  /** 来源目录与其中的文件（相对或绝对路径），同媒体通道的句柄。 */
  root: string;
  file: string;
  /** 素材版本的记录：内容摘要、媒体类型与探测出来的流。 */
  record: AssetRevision;
}

/** 素材版本里取帧要用的那几项（Space 的视频封面只有内容索引里的这些，不必读出整条记录）。 */
export interface FrameAsset {
  contentHash: string;
  mediaType: string;
  durationSec: number | null;
}

/** 缩小之后的一帧：编码后的 bytes 与实际的像素尺寸。 */
export interface MediaFrame {
  mimeType: 'image/jpeg' | 'image/png';
  data: Buffer;
  width: number;
  height: number;
}

/** ffmpeg 的输出：缩放滤镜与编码。 */
interface FrameOutput {
  filter: string;
  format: 'jpeg' | 'png';
  /** 编码后的上限（字节），缺省 `THUMBNAIL_MAX_BYTES`。 */
  maxBytes?: number;
}

export interface MediaAnalysisOptions {
  /** 缓存目录：`<home>/cache/media`。 */
  cacheDir: string;
  log: Logger;
  /** ffmpeg 可执行文件与它的环境（PATH 里要能找到它）。 */
  ffmpeg: () => Promise<{ command: string; env: NodeJS.ProcessEnv }>;
  /** 峰值没算完时等这么久再回 `pending`：短素材一次就能拿到结果。 */
  peaksWaitMs?: number;
  /** 同时运行的 ffmpeg：峰值要解码整段声音，缩略图只解一帧。 */
  peakSlots?: number;
  thumbnailSlots?: number;
}

/** 按素材时长选峰值密度：总格数不超过 `MAX_PEAKS`。 */
export function peaksRate(durationSeconds: number | null): number {
  if (!durationSeconds || !(durationSeconds > 0)) return PEAKS_PER_SECOND;
  return Math.max(1, Math.min(PEAKS_PER_SECOND, Math.floor(MAX_PEAKS / durationSeconds)));
}

/** 缩略图实际取帧的时间：按 `THUMBNAIL_STEP` 取整，留在素材时长之内（到了结尾就取不到帧）。返回毫秒。 */
export function thumbnailMillis(at: number, durationSeconds: number | null): number {
  const steps = Math.round((Math.max(0, at) * 1000) / THUMBNAIL_STEP_MS);
  const last =
    durationSeconds && durationSeconds > 0 ? Math.max(0, Math.floor(((durationSeconds - 0.05) * 1000) / THUMBNAIL_STEP_MS)) : Infinity;
  return Math.min(steps, last) * THUMBNAIL_STEP_MS;
}

/** 给智能体看的帧实际取的时间：按毫秒取整，留在素材时长之内（到了结尾就取不到帧）。返回毫秒。 */
export function frameMillis(at: number, durationSeconds: number | null): number {
  const millis = Math.round(Math.max(0, at) * 1000);
  const last = durationSeconds && durationSeconds > 0 ? Math.max(0, Math.floor((durationSeconds - 0.05) * 1000)) : Infinity;
  return Math.min(millis, last);
}

/** 缓存目录名：内容摘要的十六进制。摘要来自视频里的素材记录，格式不对就拒绝，免得拼出别的路径。 */
export function cacheKeyOf(contentHash: string): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(contentHash);
  if (!match) throw new RpcError('invalid-request', RcRuntime.assetHashInvalid());
  return match[1]!;
}

/**
 * 把单声道 f32le 采样流归成峰值：第 `i` 格是源时间 `[i, i+1) / binsPerSecond` 里的最大绝对振幅，0–255 对应 0 到满幅。
 * 采样可以按任意字节切成几块喂进来。
 */
export class PeakReducer {
  readonly #sampleRate: number;
  readonly #binsPerSecond: number;
  readonly #maxBins: number;
  #bins = new Uint8Array(1024);
  #count = 0;
  #samples = 0;
  #carry: Buffer = Buffer.alloc(0);

  constructor(sampleRate: number, binsPerSecond: number, maxBins = MAX_PEAKS * 2) {
    this.#sampleRate = sampleRate;
    this.#binsPerSecond = binsPerSecond;
    this.#maxBins = maxBins;
  }

  push(chunk: Buffer): void {
    const data = this.#carry.length ? Buffer.concat([this.#carry, chunk]) : chunk;
    const whole = data.length - (data.length % 4);
    for (let offset = 0; offset < whole; offset += 4) {
      const bin = Math.floor((this.#samples * this.#binsPerSecond) / this.#sampleRate);
      this.#samples++;
      if (bin >= this.#maxBins) continue;
      const level = Math.round(Math.min(1, Math.abs(data.readFloatLE(offset)) || 0) * 255);
      if (bin >= this.#count) this.#grow(bin + 1);
      if (level > this.#bins[bin]!) this.#bins[bin] = level;
    }
    this.#carry = whole < data.length ? Buffer.from(data.subarray(whole)) : Buffer.alloc(0);
  }

  finish(): Uint8Array {
    return this.#bins.slice(0, this.#count);
  }

  #grow(count: number): void {
    if (count > this.#bins.length) {
      const next = new Uint8Array(Math.max(count, this.#bins.length * 2));
      next.set(this.#bins.subarray(0, this.#count));
      this.#bins = next;
    }
    this.#count = count;
  }
}

/** ffmpeg 以非零状态退出（区别于超时、没装与输出超限）。对外仍是一般的 `internal` 错误。 */
class FfmpegExit extends RpcError {}

/** 同时最多运行几个任务，其余排队。 */
class Slots {
  readonly #limit: number;
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#limit = Math.max(1, limit);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#limit) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#running++;
    try {
      return await task();
    } finally {
      this.#running--;
      this.#waiting.shift()?.();
    }
  }
}

export class MediaAnalysis {
  readonly #options: MediaAnalysisOptions;
  readonly #log: Logger;
  readonly #peakSlots: Slots;
  readonly #thumbnailSlots: Slots;
  readonly #playbackSlots = new Slots(1);
  readonly #playbackJobs = new Map<string, Promise<void>>();
  readonly #peakJobs = new Map<string, Promise<MediaPeaks>>();
  readonly #thumbnailJobs = new Map<string, Promise<Buffer>>();
  readonly #failures = new Map<string, { at: number; error: RpcError }>();
  readonly #children = new Set<ChildProcess>();
  #closed = false;

  constructor(options: MediaAnalysisOptions) {
    this.#options = options;
    this.#log = options.log.child('media-analysis');
    this.#peakSlots = new Slots(options.peakSlots ?? 2);
    this.#thumbnailSlots = new Slots(options.thumbnailSlots ?? 3);
  }

  /** Runtime-owned H.264/AAC playback cache; no project or original file writes. */
  async playback(realPath: string): Promise<{ status: 'pending'; retryAfterMs: number } | { status: 'ready'; root: string; file: string }> {
    if (this.#closed) throw new RpcError('internal', RcRuntime.runtimeStopping());
    const identity = async () => {
      const stat = await fs.stat(realPath, { bigint: true }).catch(() => { throw new RpcError('not-found', RcRuntime.fileNotFound()); });
      return crypto.createHash('sha256').update(JSON.stringify(['webm-h264-aac-v1', realPath, String(stat.size), String(stat.mtimeNs)])).digest('hex');
    };
    const key = await identity();
    const root = path.join(this.#options.cacheDir, 'playback');
    const file = path.join(root, `${key}.mp4`);
    if ((await fs.stat(file).catch(() => null))?.size) return { status: 'ready', root, file };
    this.#recentFailure(file);
    if (!this.#playbackJobs.has(file)) {
      const job = this.#playbackSlots.run(async () => {
        if (await identity() !== key) throw new RpcError('not-found', RcRuntime.fileNotFound());
        await fs.mkdir(root, { recursive: true });
        const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp.mp4`;
        try {
          await this.#ffmpeg({ realPath, demuxers: 'matroska,webm' }, [
            '-y', '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn',
            '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-threads', '2', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary,
          ], { timeoutMs: 2 * 60 * 60 * 1000, onData: () => {} });
          // Decode the first samples of both optional streams before atomic publication.
          await this.#ffmpeg({ realPath: temporary, demuxers: 'mov,mp4,m4a,3gp,3g2,mj2' }, [
            '-map', '0:v:0?', '-map', '0:a:0?', '-t', '0.1', '-f', 'null', '-',
          ], { timeoutMs: 60_000, onData: () => {} });
          if (await identity() !== key) throw new RpcError('not-found', RcRuntime.fileNotFound());
          await fs.rename(temporary, file);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }).catch((error: unknown) => {
        if (error instanceof RpcError) throw error;
        // Filesystem failures must not expose Runtime cache or linked-source paths.
        const reason = (error as NodeJS.ErrnoException)?.code ?? 'Error';
        throw new RpcError('internal', RcRuntime.ffmpegCannotRun({ reason }));
      });
      this.#remember(file, job, this.#playbackJobs);
    }
    return { status: 'pending', retryAfterMs: 250 };
  }

  /** 素材声音的峰值。没有缓存时启动分析，等一小会儿；还没做完就回 `pending`。 */
  async peaks(source: MediaSource): Promise<MediaPeaks> {
    const { record } = source;
    const demuxers = demuxersOf(record);
    const { realPath } = await resolveInside(source.root, source.file);
    if (!record.audio) return { status: 'no-audio' };
    const file = path.join(this.#options.cacheDir, cacheKeyOf(record.contentHash), PEAKS_FILE);
    const cached = await readPeaks(file);
    if (cached) return cached;
    this.#recentFailure(file);

    let job = this.#peakJobs.get(file);
    if (!job) {
      const started = this.#peakSlots.run(() => this.#computePeaks(realPath, demuxers, record, file));
      job = this.#remember(file, started, this.#peakJobs);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.#options.peaksWaitMs ?? 1500);
    });
    try {
      return (await Promise.race([job, waited])) ?? { status: 'pending', retryAfterMs: PEAKS_RETRY_MS };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 视频素材在源时间 `at` 的一帧，缩成小 JPEG。 */
  async thumbnail(source: MediaSource, at: number): Promise<MediaThumbnail> {
    const { record } = source;
    const demuxers = demuxersOf(record);
    const { realPath } = await resolveInside(source.root, source.file);
    if (!record.video) throw new RpcError('invalid-request', RcRuntime.assetHasNoPicture());
    const millis = thumbnailMillis(at, record.duration ? mediaTimeToSeconds(record.duration) : null);
    const file = path.join(this.#options.cacheDir, cacheKeyOf(record.contentHash), `thumb-${millis}.jpg`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return { mimeType: 'image/jpeg', data: cached.toString('base64'), at: millis / 1000 };
    this.#recentFailure(file);
    let job = this.#thumbnailJobs.get(file);
    if (!job) {
      const output: FrameOutput = { filter: `scale=${THUMBNAIL_WIDTH}:-2`, format: 'jpeg' };
      const started = this.#thumbnailSlots.run(() => this.#computeFrame({ realPath, demuxers, seekMs: millis }, output, file));
      job = this.#remember(file, started, this.#thumbnailJobs);
    }
    return { mimeType: 'image/jpeg', data: (await job).toString('base64'), at: millis / 1000 };
  }

  /**
   * 视频素材在源时间 `at` 的一帧，缩到不超过 `width` 宽（Space 的视频封面）。按内容摘要缓存（`thumb-<毫秒>-w<宽>.jpg`，
   * 与胶片条的分开）；缓存里有时不调 `locate`，不必去找文件。找文件与 ffmpeg 一起占缩略图的并发名额。
   */
  async assetFrame(
    asset: FrameAsset,
    at: number,
    width: number,
    locate: () => Promise<{ root: string; file: string }>,
  ): Promise<MediaFrame> {
    const demuxers = DEMUXERS[asset.mediaType];
    if (!demuxers) throw new RpcError('forbidden', RcRuntime.onlyAudioVideoAnalyzable());
    const millis = thumbnailMillis(at, asset.durationSec);
    const file = path.join(this.#options.cacheDir, cacheKeyOf(asset.contentHash), `thumb-${millis}-w${width}.jpg`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return frameOf(cached);
    this.#recentFailure(file);
    let job = this.#thumbnailJobs.get(file);
    if (!job) {
      const started = this.#thumbnailSlots.run(async () => {
        const { root, file: target } = await locate();
        const { realPath } = await resolveInside(root, target);
        return this.#computeFrame({ realPath, demuxers, seekMs: millis }, boxedOutput(width, 'jpeg'), file);
      });
      job = this.#remember(file, started, this.#thumbnailJobs);
    }
    return frameOf(await job);
  }

  /**
   * 视频素材在源时间 `at` 的一帧，供智能体看画面（`videos_frames`）：缩到宽不超过 `box.width`、高不超过 `box.height`（不放大），
   * 编码成 PNG 或 JPEG。时间按毫秒取（不按胶片条的 100 毫秒粒度），留在素材时长之内。按内容摘要缓存（`frame-<毫秒>-<宽>x<高>.<格式>`，
   * 与缩略图的分开）；缓存里有时不调 `locate`。输出上限比缩略图大（整幅 PNG 常超过 1 MB）。
   */
  async videoFrame(
    asset: FrameAsset,
    at: number,
    box: { width: number; height: number; format: 'jpeg' | 'png' },
    locate: () => Promise<{ root: string; file: string }>,
  ): Promise<MediaFrame> {
    const demuxers = DEMUXERS[asset.mediaType];
    if (!demuxers) throw new RpcError('forbidden', RcRuntime.onlyAudioVideoAnalyzable());
    const millis = frameMillis(at, asset.durationSec);
    const ext = box.format === 'png' ? 'png' : 'jpg';
    const file = path.join(this.#options.cacheDir, cacheKeyOf(asset.contentHash), `frame-${millis}-${box.width}x${box.height}.${ext}`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return frameOf(cached);
    this.#recentFailure(file);
    let job = this.#thumbnailJobs.get(file);
    if (!job) {
      const output: FrameOutput = {
        filter: `scale=w='min(${box.width},iw)':h='min(${box.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
        format: box.format,
        maxBytes: FRAME_MAX_BYTES,
      };
      const started = this.#thumbnailSlots.run(async () => {
        const { root, file: target } = await locate();
        const { realPath } = await resolveInside(root, target);
        return this.#computeFrame({ realPath, demuxers, seekMs: millis }, output, file);
      });
      job = this.#remember(file, started, this.#thumbnailJobs);
    }
    return frameOf(await job);
  }

  /**
   * Space 里的一个视频或图片文件的一帧，缩到不超过 `width` 宽（不放大）。视频取 `at` 秒（取不到时，比如视频比它短，
   * 退回第一帧），图片取第一帧。缓存键是真实路径、大小、修改时间、宽与时间：文件被覆盖之后重新取。
   */
  async fileFrame(target: { root: string; file: string }, options: { at: number; width: number }): Promise<MediaFrame> {
    const { realPath } = await resolveInside(target.root, target.file);
    const spec = FILE_FRAMES[path.extname(realPath).slice(1).toLowerCase()];
    if (!spec) throw new RpcError('forbidden', RcRuntime.noFramesForFileType());
    const stat = await fs.stat(realPath);
    const millis = spec.still ? null : thumbnailMillis(options.at, null);
    const format = spec.alpha ? 'png' : 'jpeg';
    const key = crypto
      .createHash('sha256')
      .update(JSON.stringify([realPath, stat.size, stat.mtimeMs, options.width, millis, format]))
      .digest('hex');
    const file = path.join(this.#options.cacheDir, FILE_FRAMES_DIR, `${key}.${format === 'png' ? 'png' : 'jpg'}`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return frameOf(cached);
    this.#recentFailure(file);
    let job = this.#thumbnailJobs.get(file);
    if (!job) {
      const output = boxedOutput(options.width, format);
      const input = { realPath, demuxers: spec.demuxers, ...(spec.still ? { force: true } : {}) };
      const started = this.#thumbnailSlots.run(async () => {
        try {
          return await this.#computeFrame({ ...input, seekMs: millis }, output, file);
        } catch (error) {
          // 视频比要的时间短：退回第一帧。跳过结尾时 ffmpeg 要么什么也不写、要么以编码器打不开退出；超时不再试。
          const pastEnd = error instanceof FfmpegExit || (error instanceof RpcError && error.code === 'not-found');
          if (!millis || !pastEnd) throw error;
          return this.#computeFrame({ ...input, seekMs: 0 }, output, file);
        }
      });
      job = this.#remember(file, started, this.#thumbnailJobs);
    }
    return frameOf(await job);
  }

  /** Runtime 停止：结束还在运行的 ffmpeg。 */
  close(): void {
    this.#closed = true;
    for (const child of this.#children) child.kill('SIGKILL');
    this.#children.clear();
  }

  async #computePeaks(realPath: string, demuxers: string, record: AssetRevision, file: string): Promise<MediaPeaks> {
    const duration = record.duration ? mediaTimeToSeconds(record.duration) : null;
    const binsPerSecond = peaksRate(duration);
    const reducer = new PeakReducer(PEAKS_SAMPLE_RATE, binsPerSecond);
    const started = Date.now();
    await this.#ffmpeg(
      { realPath, demuxers },
      ['-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(PEAKS_SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
      {
        // 解码声音通常比实时快一百倍以上；给足余量，长素材按时长放宽。
        timeoutMs: 120_000 + (duration ?? 0) * 200,
        onData: (chunk) => reducer.push(chunk),
      },
    );
    const bins = reducer.finish();
    const result: MediaPeaks = bins.length
      ? { status: 'ready', binsPerSecond, peaks: Buffer.from(bins).toString('base64') }
      : { status: 'no-audio' };
    await writeAtomic(file, JSON.stringify(result));
    this.#log.info('Computed waveform peaks', { bins: bins.length, binsPerSecond, ms: Date.now() - started });
    return result;
  }

  /** 取一帧，编码成 JPEG 或 PNG，写进缓存。`seekMs` 为 null 时不跳（图片）。 */
  async #computeFrame(
    input: { realPath: string; demuxers: string; force?: boolean; seekMs: number | null },
    output: FrameOutput,
    file: string,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    const before = [
      // `-ss` 放在输入之前：按索引跳到附近的关键帧再解到那一帧，几 GB 的文件也不用从头读。
      ...(input.seekMs !== null ? ['-ss', (input.seekMs / 1000).toFixed(3)] : []),
      ...(input.force ? ['-f', input.demuxers] : []),
    ];
    const codec = output.format === 'png' ? ['-c:v', 'png'] : ['-q:v', '5', '-c:v', 'mjpeg'];
    await this.#ffmpeg(
      { realPath: input.realPath, demuxers: input.demuxers, before },
      ['-map', '0:v:0', '-frames:v', '1', '-vf', output.filter, '-f', 'image2pipe', ...codec, 'pipe:1'],
      {
        timeoutMs: THUMBNAIL_TIMEOUT_MS,
        onData: (chunk) => {
          size += chunk.length;
          if (size > (output.maxBytes ?? THUMBNAIL_MAX_BYTES)) throw new RpcError('internal', RcRuntime.thumbnailTooLarge());
          chunks.push(chunk);
        },
      },
    );
    const bytes = Buffer.concat(chunks);
    if (!imageSize(bytes)) throw new RpcError('not-found', RcRuntime.noFrameAtTime());
    await writeAtomic(file, bytes);
    return bytes;
  }

  /** 运行一次 ffmpeg：不经 shell，只许读本地文件、只许用指定的解复用器。输出交给 `onData`，它抛错就结束进程。 */
  #ffmpeg(
    input: { realPath: string; demuxers: string; before?: string[] },
    output: string[],
    { timeoutMs, onData }: { timeoutMs: number; onData: (chunk: Buffer) => void },
  ): Promise<void> {
    if (this.#closed) return Promise.reject(new RpcError('internal', RcRuntime.runtimeStopping()));
    return this.#options.ffmpeg().then(
      ({ command, env }) =>
        new Promise<void>((resolve, reject) => {
          if (this.#closed) return reject(new RpcError('internal', RcRuntime.runtimeStopping()));
          const args = [
            '-nostdin',
            '-hide_banner',
            '-v',
            'error',
            '-protocol_whitelist',
            'file',
            '-format_whitelist',
            input.demuxers,
            ...(input.before ?? []),
            '-i',
            `file:${input.realPath}`,
            ...output,
          ];
          const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
          this.#children.add(child);
          let failure: RpcError | null = null;
          let stderr = '';
          const fail = (error: RpcError) => {
            failure ??= error;
            child.kill('SIGKILL');
          };
          const timer = setTimeout(() => fail(new RpcError('internal', RcRuntime.ffmpegTimeout())), timeoutMs);
          child.stdout.on('data', (chunk: Buffer) => {
            if (failure) return;
            try {
              onData(chunk);
            } catch (error) {
              fail(error instanceof RpcError ? error : new RpcError('internal', String(error)));
            }
          });
          child.stderr.on('data', (chunk: Buffer) => {
            if (stderr.length < 4096) stderr += chunk.toString('utf8');
          });
          child.on('error', (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            this.#children.delete(child);
            reject(
              error.code === 'ENOENT'
                ? new RpcError('internal', RcRuntime.ffmpegMissing())
                : new RpcError('internal', RcRuntime.ffmpegCannotRun({ reason: error.message })),
            );
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            this.#children.delete(child);
            if (failure) return reject(failure);
            if (code === 0) return resolve();
            // stderr 里有输入文件的路径：日志与错误里都换掉。
            const detail = stderr.split(input.realPath).join('<asset>').trim().split('\n').at(-1) ?? '';
            this.#log.warn('ffmpeg failed', { code, detail });
            reject(new FfmpegExit('internal', RcRuntime.ffmpegCannotRead()));
          });
        }),
    );
  }

  /** 登记一个进行中的任务：做完从表里拿掉，失败记一阵。 */
  #remember<T>(key: string, started: Promise<T>, jobs: Map<string, Promise<T>>): Promise<T> {
    const job = started.finally(() => jobs.delete(key));
    job.catch((error: unknown) => {
      const rpc = error instanceof RpcError ? error : new RpcError('internal', String(error));
      this.#failures.set(key, { at: Date.now(), error: rpc });
    });
    jobs.set(key, job);
    return job;
  }

  #recentFailure(key: string): void {
    const failed = this.#failures.get(key);
    if (!failed) return;
    if (Date.now() - failed.at < FAILURE_TTL_MS) throw failed.error;
    this.#failures.delete(key);
  }
}

/** 缩到不超过 `width` 宽、`width * FRAME_MAX_HEIGHT_RATIO` 高，保持比例，不放大，宽高取偶数。 */
function boxedOutput(width: number, format: FrameOutput['format']): FrameOutput {
  const height = width * FRAME_MAX_HEIGHT_RATIO;
  return {
    filter: `scale=w='min(${width},iw)':h='min(${height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    format,
  };
}

function frameOf(bytes: Buffer): MediaFrame {
  const size = imageSize(bytes);
  if (!size) throw new RpcError('internal', RcRuntime.cachedThumbnailBroken());
  return { mimeType: size.mimeType, data: bytes, ...size.dims };
}

/** PNG 或 JPEG 的像素尺寸（读文件头，不解码）；认不出时 null。 */
export function imageSize(bytes: Buffer): { mimeType: MediaFrame['mimeType']; dims: { width: number; height: number } } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('latin1', 12, 16) === 'IHDR') {
    return { mimeType: 'image/png', dims: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  // 逐段找帧头（SOF0–SOF15，除去 DHT、JPG、DAC）。
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mimeType: 'image/jpeg', dims: { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) } };
    }
    offset += 2 + length;
  }
  return null;
}

function demuxersOf(record: AssetRevision): string {
  const demuxers = DEMUXERS[record.mediaType];
  if (!demuxers) throw new RpcError('forbidden', RcRuntime.onlyAudioVideoAnalyzable());
  return demuxers;
}

async function readPeaks(file: string): Promise<MediaPeaks | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as MediaPeaks;
    if (value.status === 'no-audio') return value;
    if (value.status === 'ready' && Number.isInteger(value.binsPerSecond) && value.binsPerSecond > 0 && typeof value.peaks === 'string')
      return value;
    return null;
  } catch {
    return null;
  }
}

/** 先写临时文件再改名：读的一方要么看到完整的文件，要么看不到。 */
async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}
