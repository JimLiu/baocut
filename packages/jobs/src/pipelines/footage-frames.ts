import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { JobsFfmpeg } from '@baocut/protocol/messages/jobs/ffmpeg.ts';
import type { MediaToolResolver } from './ffmpeg.ts';
import { PipelineStepError } from './pipeline.ts';

/**
 * 素材处理（`assets_process`，架构设计 §7.9）里按帧过外部工具的那几种（超分、插帧、抠像）共用的帧流：
 *
 * - 解码端是一个 ffmpeg 进程，把画面按 PNG 连续写到标准输出（`image2pipe`）。消费者不读，管道就满，ffmpeg 自然停下来：不用把整段
 *   视频解到盘上，staging 里任何时候只有一批帧。
 * - 编码端是另一个 ffmpeg 进程，从标准输入读 PNG（同样靠管道的背压）。声音另开一个输入，从源文件的同一段取。
 */

const STDERR_TAIL = 4000;
const KILL_GRACE_MS = 2000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHUNK_HEADER = 8;
const CHUNK_OVERHEAD = 12;

/** 把一串连着写的 PNG 切成一个个文件：按 chunk 的长度字段往后跳，到 `IEND` 为止。 */
export class PngSplitter {
  #parts: Buffer[] = [];
  #size = 0;
  /** 下一个 chunk 头的位置（从当前这一帧的开头算）。 */
  #next = PNG_SIGNATURE.length;

  push(chunk: Buffer): Buffer[] {
    this.#parts.push(chunk);
    this.#size += chunk.length;
    const frames: Buffer[] = [];
    while (this.#size >= this.#next + CHUNK_HEADER) {
      const head = this.#peek(this.#next, CHUNK_HEADER);
      const end = this.#next + CHUNK_OVERHEAD + head.readUInt32BE(0);
      if (head.toString('latin1', 4, 8) !== 'IEND') {
        this.#next = end;
        continue;
      }
      if (this.#size < end) break;
      frames.push(this.#take(end));
      this.#next = PNG_SIGNATURE.length;
    }
    return frames;
  }

  /** 剩下的字节数：流结束时不为 0 说明最后一帧不完整。 */
  get pending(): number {
    return this.#size;
  }

  #peek(offset: number, length: number): Buffer {
    const out = Buffer.alloc(length);
    let skip = offset;
    let written = 0;
    for (const part of this.#parts) {
      if (skip >= part.length) {
        skip -= part.length;
        continue;
      }
      written += part.copy(out, written, skip, Math.min(part.length, skip + length - written));
      skip = 0;
      if (written === length) break;
    }
    return out;
  }

  #take(end: number): Buffer {
    const all = Buffer.concat(this.#parts, this.#size);
    this.#parts = end < all.length ? [all.subarray(end)] : [];
    this.#size = all.length - end;
    if (all.subarray(0, PNG_SIGNATURE.length).compare(PNG_SIGNATURE) !== 0) throw new Error('not a PNG stream');
    return Buffer.from(all.subarray(0, end));
  }
}

/** 中止时先 SIGTERM，宽限之后 SIGKILL。返回解除监听的函数。 */
function killOnAbort(child: ChildProcessWithoutNullStreams, signal: AbortSignal): () => void {
  let timer: NodeJS.Timeout | null = null;
  const onAbort = () => {
    child.kill('SIGTERM');
    timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
    if (timer) clearTimeout(timer);
  };
}

function failure(code: number | null, stderr: string): PipelineStepError {
  return new PipelineStepError('TRANSCODE_FAILED', JobsFfmpeg.exited({ code }), { exitCode: code, stderr: stderr.trim().slice(-1000) });
}

/**
 * 解码出来的帧，按顺序一张张的 PNG。迭代提前结束（失败、取消）时结束 ffmpeg。
 * 跳过的部分靠 `-ss` 放在输入之前（按索引跳到附近的关键帧再解码，转码时精确到帧）。
 */
export async function* decodeFrames(
  resolve: MediaToolResolver,
  input: { file: string; start: number; duration: number | null; filter: string },
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  signal.throwIfAborted();
  const tool = await resolve();
  const args = [
    ...['-hide_banner', '-v', 'error', '-nostdin'],
    ...(input.start > 0 ? ['-ss', input.start.toFixed(6)] : []),
    ...(input.duration !== null ? ['-t', input.duration.toFixed(6)] : []),
    ...['-i', `file:${input.file}`],
    ...['-map', '0:v:0', '-an', '-sn', '-dn'],
    ...['-vf', input.filter],
    // 中间文件：压得快比压得小要紧（压缩级别 1，1080p 一帧约 30 毫秒）。
    ...['-c:v', 'png', '-compression_level', '1', '-f', 'image2pipe', 'pipe:1'],
  ];
  const child = spawn(tool.command, args, { env: tool.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  const closed = new Promise<number | null>((done, fail) => {
    child.once('error', fail);
    child.once('close', done);
  });
  // 没有人等 `closed` 时（提前退出）不算未处理的拒绝。
  closed.catch(() => {});
  const detach = killOnAbort(child, signal);
  const splitter = new PngSplitter();
  let finished = false;
  try {
    for await (const chunk of child.stdout) {
      for (const frame of splitter.push(chunk as Buffer)) yield frame;
    }
    const code = await closed;
    finished = true;
    signal.throwIfAborted();
    if (code !== 0 || splitter.pending !== 0) throw failure(code, stderr);
  } finally {
    detach();
    if (!finished) {
      child.kill('SIGKILL');
      await closed.catch(() => {});
    }
  }
}

/** 编码端：写 PNG、结束时等它退出。ffmpeg 中途退出时下一次写入或 `finish` 抛错（带 stderr 的结尾）。 */
export class FrameEncoder {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #closed: Promise<number | null>;
  readonly #detach: () => void;
  readonly #signal: AbortSignal;
  #stderr = '';
  #broken = false;
  #exited = false;

  constructor(tool: { command: string; env?: NodeJS.ProcessEnv }, args: string[], signal: AbortSignal) {
    this.#signal = signal;
    this.#child = spawn(tool.command, args, { env: tool.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child.stdout.resume();
    this.#child.stderr.setEncoding('utf8');
    this.#child.stderr.on('data', (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL);
    });
    this.#child.stdin.on('error', () => {
      this.#broken = true;
    });
    this.#closed = new Promise((done, fail) => {
      this.#child.once('error', (error) => {
        this.#exited = true;
        fail(error);
      });
      this.#child.once('close', (code) => {
        this.#exited = true;
        done(code);
      });
    });
    this.#closed.catch(() => {});
    this.#detach = killOnAbort(this.#child, signal);
  }

  /** 进程已经不在时抛错。信号杀掉的进程 `exitCode` 一直是 null，标准输入也不报错，只能靠自己记下的 `close`。 */
  async #throwIfGone(): Promise<void> {
    if (!this.#broken && !this.#exited) return;
    const code = await this.#closed;
    this.#signal.throwIfAborted();
    throw failure(code, this.#stderr);
  }

  async write(frame: Buffer): Promise<void> {
    await this.#throwIfGone();
    if (this.#child.stdin.write(frame)) return;
    await new Promise<void>((done) => {
      const finish = () => {
        this.#child.stdin.off('drain', finish);
        this.#child.off('close', finish);
        done();
      };
      this.#child.stdin.once('drain', finish);
      this.#child.once('close', finish);
      // 上面的 `write` 与这里之间进程可能已经退出：`close` 不会再来。
      if (this.#exited) finish();
    });
    await this.#throwIfGone();
  }

  async finish(): Promise<void> {
    this.#child.stdin.end();
    const code = await this.#closed;
    this.#detach();
    this.#signal.throwIfAborted();
    if (code !== 0) throw failure(code, this.#stderr);
  }

  /** 放弃（失败、取消）：结束进程并等它退出。 */
  async abort(): Promise<void> {
    this.#child.kill('SIGKILL');
    await this.#closed.catch(() => {});
    this.#detach();
  }
}

/** 跑一次 ffmpeg，把标准输出整段收进内存（`rawvideo` 这类很小的输出）。 */
export async function captureOutput(resolve: MediaToolResolver, args: string[], signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const tool = await resolve();
  const child = spawn(tool.command, args, { env: tool.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  const chunks: Buffer[] = [];
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  const detach = killOnAbort(child, signal);
  try {
    const code = await new Promise<number | null>((done, fail) => {
      child.once('error', fail);
      child.once('close', done);
    });
    signal.throwIfAborted();
    if (code !== 0) throw failure(code, stderr);
    return Buffer.concat(chunks);
  } finally {
    detach();
  }
}

/** 帧率的最简分数。认不出（`0/0`、不是分数）或大得离谱（容器的时基，例如 `90000/1`）时 null。 */
export function parseFrameRate(text: string): { num: number; den: number } | null {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const num = Number(match[1]);
  const den = Number(match[2] ?? 1);
  if (num <= 0 || den <= 0 || num / den > 240 || num / den < 1) return null;
  return { num, den };
}

/**
 * 处理时用的帧率：`r_frame_rate` 是容器里最小的时间单位换算的，可变帧率的手机素材常比实际帧数高好几倍（全按它转恒定帧率会重复出很多帧，
 * 超分与插帧的时间都白花），认不出时也不能退回 30 把 60 fps 的素材丢一半帧。所以它比平均帧率高出一半以上、或认不出时用平均帧率；
 * 两个都认不出时才是 30。
 */
export function chooseFrameRate(rate: string, average: string | null): { num: number; den: number } {
  const nominal = parseFrameRate(rate);
  const mean = average === null ? null : parseFrameRate(average);
  if (nominal && mean && nominal.num / nominal.den > (mean.num / mean.den) * 1.5) return mean;
  return nominal ?? mean ?? { num: 30, den: 1 };
}

/**
 * ffmpeg 滤镜参数里的路径：放进单引号，正斜杠，转义冒号；路径里的单引号要过两层（滤镜图一层、选项一层），写成 `\\'\\''`。
 * Windows 的盘符也安全。
 */
export function filterPath(file: string): string {
  return `'${file.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'\\''")}'`;
}
