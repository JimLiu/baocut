import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { BakeRecord, Rate } from '@baocut/protocol';
import type { InspectedBundle } from './bundle-inspect.ts';
import { frameTicketAt, type CompositionHost } from './composition-host.ts';

/**
 * 烘焙（代码包规范 §7）：按输出帧率逐帧取 PNG，经 ffmpeg 的 `image2pipe` 封进 QuickTime。
 *
 * 带 alpha 时用 `prores_ks` 4444 + `yuva444p10le`（导入端按 `pix_fmt` 以 `yuva` 开头判定有透明），
 * 不透明时用 422 HQ + `yuv422p10le`。第 k 帧的局部时间是 `k × den / num` 秒，票据里是精确的 `MediaTime`。
 */

export interface BakeOptions {
  fps: Rate;
  /** 输出文件（`.mov`）。 */
  outputFile: string;
  /** ffmpeg 可执行文件。 */
  ffmpeg: string;
  alpha: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface BakeResult {
  file: string;
  frames: number;
  fps: Rate;
  durationSeconds: number;
  encoding: BakeRecord['encoding'];
  /** 每帧 PNG 的 sha256。 */
  frameHashes: string[];
  outputProfileHash: string;
  timeMapHash: string;
  parameterValuesHash: string;
}

const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');

/** ffmpeg 旁边的 ffprobe（同目录、同扩展名；只给了命令名时也只换名字）。 */
export function ffprobePathFor(ffmpeg: string): string {
  const base = path.basename(ffmpeg);
  const probe = base.replace(/ffmpeg/i, 'ffprobe');
  if (probe === base) return 'ffprobe';
  return ffmpeg === base ? probe : path.join(path.dirname(ffmpeg), probe);
}

/** 缺省的 ffmpeg：`BAOCUT_FFMPEG`，否则 PATH 里的 `ffmpeg`。 */
export function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env): string {
  return env.BAOCUT_FFMPEG || 'ffmpeg';
}

const STDERR_TAIL = 8 * 1024;

export async function bakeComposition(host: CompositionHost, bundle: InspectedBundle, options: BakeOptions): Promise<BakeResult> {
  const { fps, alpha } = options;
  const { intrinsic } = bundle.manifest;
  const durationSeconds = (intrinsic.durationFrames * intrinsic.fps.den) / intrinsic.fps.num;
  const total = Math.max(1, Math.floor((durationSeconds * fps.num) / fps.den + 1e-9));
  const codec = 'prores_ks';
  const pixelFormat = alpha ? 'yuva444p10le' : 'yuv422p10le';
  const profile = alpha ? '4444' : '3';
  options.signal?.throwIfAborted();

  const session = await host.open(bundle);
  const frameHashes: string[] = [];
  try {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      `${fps.num}/${fps.den}`,
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      codec,
      '-profile:v',
      profile,
      '-pix_fmt',
      pixelFormat,
      '-movflags',
      '+faststart',
      options.outputFile,
    ];
    const child = spawn(options.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.stdin.on('error', () => {});
    const exited = new Promise<{ code: number | null; error?: Error }>((resolve) => {
      child.once('error', (error) => resolve({ code: null, error }));
      child.once('close', (code) => resolve({ code }));
    });
    let exitedEarly = false;
    void exited.then(() => {
      exitedEarly = true;
    });
    const failure = (reason: string) => new Error(`ffmpeg failed (${reason}): ${stderr.trim().slice(-2000)}`);
    const onAbort = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      for (let k = 0; k < total; k++) {
        options.signal?.throwIfAborted();
        if (exitedEarly) {
          const exit = await exited;
          throw failure(exit.error ? exit.error.message : `exit ${String(exit.code)}`);
        }
        const frame = await session.frame(frameTicketAt(bundle, { frameIndex: k, fps }, { requestId: `bake_${k}` }));
        frameHashes.push(frame.receipt.sha256);
        if (!child.stdin.write(frame.png)) {
          await Promise.race([new Promise<void>((resolve) => child.stdin.once('drain', () => resolve())), exited]);
        }
        options.onProgress?.(k + 1, total);
      }
      child.stdin.end();
      const exit = await exited;
      options.signal?.throwIfAborted();
      if (exit.error) throw failure(exit.error.message);
      if (exit.code !== 0) throw failure(`exit ${String(exit.code)}`);
    } catch (error) {
      if (child.exitCode === null) child.kill('SIGKILL');
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    await session.dispose().catch(() => {});
  }

  const { width, height } = intrinsic;
  return {
    file: options.outputFile,
    frames: total,
    fps,
    durationSeconds,
    encoding: { container: 'mov', codec, pixelFormat, alpha, fps, frames: total },
    frameHashes,
    outputProfileHash: sha256Hex(JSON.stringify({ fps, width, height, alpha, codec })),
    timeMapHash: sha256Hex(JSON.stringify({ sourceIn: 0, rate: 1, frames: total })),
    parameterValuesHash: sha256Hex('{}'),
  };
}
