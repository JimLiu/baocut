import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import type { BakeRecord, CompositionBakeInfo, CompositionBakeMode, Rate } from '@baocut/protocol';
import type { InspectedBundle } from './bundle-inspect.ts';
import { frameTicketAt, type CompositionHost } from './composition-host.ts';

/**
 * 烘焙（代码包规范 §7）：把代码画面按输出帧率逐帧画成 QuickTime（ProRes）。两种渲染器：
 *
 * - **指令**（`drawop-cpu`，§7.2）：页面里录下主画布的 Canvas 2D 调用（`canvas-recorder.ts`），写成录制文件；取几帧样本用 Chromium
 *   照常截 PNG；Render Worker 的 `canvas-bake` 把录制转成 DrawOp、多线程光栅、对拍样本，再直接编码（macOS 有 VideoToolbox 时硬件编码）。
 * - **像素**（`browser-pixels`，§7.1）：逐帧截 PNG，经 ffmpeg 的 `image2pipe` 编码。
 *
 * `auto`（缺省）先走指令，录制里有不支持的东西、样本对不上或没有 Worker 时整段回退到像素，原因记进 `bake.fallback`。
 * 带 alpha 时编成 4444（`yuva444p10le`，导入端按 `pix_fmt` 以 `yuva` 开头判定有透明），不透明时 422 HQ（`yuv422p10le`）。
 * 第 k 帧的局部时间是 `k × den / num` 秒。
 */

export interface BakeOptions {
  fps: Rate;
  /** 输出文件（`.mov`）。 */
  outputFile: string;
  /** ffmpeg 可执行文件。 */
  ffmpeg: string;
  alpha: boolean;
  /** 渲染器的选择，缺省 `auto`。 */
  mode?: CompositionBakeMode;
  /** Render Worker（`export-worker`）；没有时 `auto` 回退像素、`ops` 失败。 */
  worker?: string | null;
  /** 指令路线的工作目录（录制、样本、Worker 输入）；缺省是输出文件所在的目录。 */
  workDir?: string;
  /** 对拍的样本帧数（均匀取，含首尾），缺省 5。 */
  samples?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** 阶段与回退的诊断（英文）。 */
  log?: (line: string) => void;
}

export interface BakeResult {
  file: string;
  frames: number;
  fps: Rate;
  durationSeconds: number;
  encoding: BakeRecord['encoding'];
  /** 每帧的 sha256：像素路线是 PNG 的，指令路线是直通 RGBA 的。 */
  frameHashes: string[];
  outputProfileHash: string;
  timeMapHash: string;
  parameterValuesHash: string;
  /** 实际用的渲染器、用时与回退原因（回执的 `bake`）。 */
  bake: CompositionBakeInfo;
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
/** 一次宿主调用录的帧数。 */
const RECORD_BATCH = 30;
const DEFAULT_SAMPLES = 5;

/** 指令路线走不通、要整段回退到像素的原因。 */
class OpsFallback extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'OpsFallback';
    this.reason = reason;
  }
}

interface Plan {
  fps: Rate;
  alpha: boolean;
  total: number;
  durationSeconds: number;
}

function planOf(bundle: InspectedBundle, options: BakeOptions): Plan {
  const { intrinsic } = bundle.manifest;
  const durationSeconds = (intrinsic.durationFrames * intrinsic.fps.den) / intrinsic.fps.num;
  const total = Math.max(1, Math.floor((durationSeconds * options.fps.num) / options.fps.den + 1e-9));
  return { fps: options.fps, alpha: options.alpha, total, durationSeconds };
}

function hashes(bundle: InspectedBundle, plan: Plan, codec: string) {
  const { width, height } = bundle.manifest.intrinsic;
  const { fps, alpha, total } = plan;
  return {
    outputProfileHash: sha256Hex(JSON.stringify({ fps, width, height, alpha, codec })),
    timeMapHash: sha256Hex(JSON.stringify({ sourceIn: 0, rate: 1, frames: total })),
    parameterValuesHash: sha256Hex('{}'),
  };
}

export async function bakeComposition(host: CompositionHost, bundle: InspectedBundle, options: BakeOptions): Promise<BakeResult> {
  const mode = options.mode ?? 'auto';
  const plan = planOf(bundle, options);
  const started = performance.now();
  options.signal?.throwIfAborted();
  let fallback: string | null = null;
  if (mode !== 'pixels') {
    try {
      return await bakeOps(host, bundle, options, plan, started);
    } catch (error) {
      if (!(error instanceof OpsFallback)) throw error;
      if (mode === 'ops') throw new Error(`The instruction bake cannot render this bundle: ${error.reason}`);
      fallback = error.reason;
      options.log?.(`composition bake falls back to browser pixels: ${error.reason}`);
      await fs.promises.rm(options.outputFile, { force: true });
    }
  }
  const result = await bakePixels(host, bundle, options, plan);
  const seconds = (performance.now() - started) / 1000;
  return {
    ...result,
    bake: {
      renderer: 'browser-pixels',
      fps: plan.total / seconds,
      seconds,
      ...(fallback ? { fallback: { reason: fallback } } : {}),
    },
  };
}

/** 均匀取 `count` 个样本帧（含首尾，去重）。 */
export function sampleFrames(total: number, count: number): number[] {
  if (total <= 1 || count <= 1) return [0];
  const n = Math.min(count, total);
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (total - 1)) / (n - 1))))];
}

interface WorkerEvent {
  event: string;
  [key: string]: unknown;
}

async function bakeOps(
  host: CompositionHost,
  bundle: InspectedBundle,
  options: BakeOptions,
  plan: Plan,
  started: number,
): Promise<BakeResult> {
  const { manifest } = bundle;
  const contract = manifest.runtime.engine === 'browser' ? manifest.runtime.contract : manifest.runtime.engine;
  if (contract !== 'baocut/1') throw new OpsFallback(`only baocut/1 canvases are recorded, not ${contract}`);
  if (!options.worker) throw new OpsFallback('the Render Worker (export-worker) is not available');
  const { fps, total, alpha } = plan;
  const work = await fs.promises.mkdtemp(path.join(options.workDir ?? path.dirname(options.outputFile), 'canvas-bake-'));
  try {
    // 1. 录制：一批批 seek、记下主画布的调用，写成 NDJSON（格式见代码包规范 §7.2）。
    const recording = path.join(work, 'recording.ndjson');
    const samplesDir = path.join(work, 'samples');
    await fs.promises.mkdir(samplesDir);
    const sampled = sampleFrames(total, options.samples ?? DEFAULT_SAMPLES);
    const recordStarted = performance.now();
    let recordSeconds = 0;
    const session = await host.open(bundle, { record: true });
    try {
      const out = await fs.promises.open(recording, 'w');
      try {
        const line = (value: unknown) => out.write(`${JSON.stringify(value)}\n`);
        const { width, height } = manifest.intrinsic;
        await line({ type: 'header', width, height, fps, frames: total, alpha });
        let background = false;
        for (let k = 0; k < total; k += RECORD_BATCH) {
          options.signal?.throwIfAborted();
          const indices = Array.from({ length: Math.min(RECORD_BATCH, total - k) }, (_, i) => k + i);
          const batch = await session.record(
            indices.map((i) => (i * fps.den) / fps.num),
            fps,
          );
          if (batch.unsupported) throw new OpsFallback(`recording: ${batch.unsupported}`);
          if (!background) {
            if (!batch.background) throw new OpsFallback('recording: page background unknown');
            await line({ type: 'page', background: batch.background });
            background = true;
          }
          for (const resource of batch.resources) await line(resource);
          for (const [i, frame] of batch.frames.entries()) await line({ type: 'frame', index: indices[i], ...frame });
        }
      } finally {
        await out.close();
      }
      recordSeconds = (performance.now() - recordStarted) / 1000;
      // 2. 样本：同一个会话里照常截 PNG（录制脚本只旁听，画面与像素路线相同）。
      for (const k of sampled) {
        options.signal?.throwIfAborted();
        const frame = await session.frame(frameTicketAt(bundle, { frameIndex: k, fps }, { requestId: `bake_sample_${k}` }));
        await fs.promises.writeFile(path.join(samplesDir, `${k}.png`), frame.png);
      }
    } finally {
      await session.dispose().catch(() => {});
    }
    const samplesSeconds = (performance.now() - recordStarted) / 1000 - recordSeconds;

    // 3. Worker：对拍、检查、光栅、编码。
    const input = path.join(work, 'canvas-bake.json');
    await fs.promises.writeFile(
      input,
      JSON.stringify({
        root: bundle.root,
        recording,
        output: options.outputFile,
        ffmpeg: options.ffmpeg,
        verify: { samples: sampled.map((frame) => ({ frame, png: path.join(samplesDir, `${frame}.png`) })) },
      }),
    );
    const done = await runCanvasBake(options.worker, input, options, total);
    const encoding = done.encoding as { codec: string; pixelFormat: string };
    const seconds = (performance.now() - started) / 1000;
    const stages = done.stages as Record<string, Record<string, number>> | undefined;
    const renderSeconds = typeof done.seconds === 'number' ? done.seconds : seconds;
    const bake: CompositionBakeInfo = {
      renderer: 'drawop-cpu',
      fps: total / seconds,
      seconds,
      stages: {
        record: { seconds: recordSeconds, fps: total / Math.max(recordSeconds, 1e-9) },
        samples: { seconds: samplesSeconds, frames: sampled.length },
        verify: { seconds: stages?.verify?.seconds ?? 0 },
        raster: {
          fps: stages?.raster?.fpsCapacity ?? 0,
          threads: stages?.raster?.threads ?? 0,
        },
        render: { seconds: renderSeconds, fps: typeof done.renderFps === 'number' ? done.renderFps : 0 },
        encode: { codec: encoding.codec, blockedShare: stages?.encode?.blockedShare ?? 0 },
      },
    };
    options.log?.(`composition bake (drawop-cpu): ${JSON.stringify(bake)}`);
    return {
      file: options.outputFile,
      frames: total,
      fps,
      durationSeconds: plan.durationSeconds,
      encoding: { container: 'mov', codec: encoding.codec, pixelFormat: encoding.pixelFormat, alpha, fps, frames: total },
      frameHashes: done.frameHashes as string[],
      ...hashes(bundle, plan, encoding.codec),
      bake,
    };
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 跑 `export-worker canvas-bake`：stdout 的 JSON 行转成进度，`done` 是结果；stdin 保持打开（关掉就是取消）。
 * Worker 的任何失败（`CANVAS_OPS_UNSUPPORTED` / `MISMATCH` / `INVALID`，也包括不认识 `canvas-bake` 的旧 Worker、编码失败、崩溃）
 * 都是 `OpsFallback`：像素路线不依赖 Worker，`auto` 照样能出片。
 */
function runCanvasBake(worker: string, input: string, options: BakeOptions, total: number): Promise<WorkerEvent> {
  return new Promise((resolve, reject) => {
    const child = spawn(worker, ['canvas-bake', input], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.stdin.on('error', () => {});
    let done: WorkerEvent | null = null;
    let failure: Error | null = null;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (text) => {
      let event: WorkerEvent;
      try {
        event = JSON.parse(text) as WorkerEvent;
      } catch {
        return;
      }
      if (event.event === 'progress' && typeof event.frame === 'number') options.onProgress?.(event.frame, total);
      else if (event.event === 'verify') options.log?.(`composition bake verify: ${text}`);
      else if (event.event === 'done') done = event;
      else if (event.event === 'error') {
        failure = new OpsFallback(`${String(event.code)}: ${String(event.message)}`);
      }
    });
    const onAbort = () => {
      child.stdin.write('cancel\n');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new OpsFallback(`cannot start the Render Worker: ${error.message}`));
    });
    child.once('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      lines.close();
      if (options.signal?.aborted) return reject(options.signal.reason);
      if (failure) return reject(failure);
      if (code === 0 && done) return resolve(done);
      reject(new OpsFallback(`export-worker canvas-bake exited with ${String(code)}: ${stderr.trim().slice(-2000)}`));
    });
  });
}

async function bakePixels(
  host: CompositionHost,
  bundle: InspectedBundle,
  options: BakeOptions,
  plan: Plan,
): Promise<Omit<BakeResult, 'bake'>> {
  const { fps, alpha, total } = plan;
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
    const child = spawn(options.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
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

  return {
    file: options.outputFile,
    frames: total,
    fps,
    durationSeconds: plan.durationSeconds,
    encoding: { container: 'mov', codec, pixelFormat, alpha, fps, frames: total },
    frameHashes,
    ...hashes(bundle, plan, codec),
  };
}
