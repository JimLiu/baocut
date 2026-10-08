import { spawn } from 'node:child_process';
import { ffmpegMissingRemedy } from '@baocut/process-host';
import { JobsFfmpeg } from '@baocut/protocol/messages/jobs/ffmpeg.ts';
import type { ProbeToolResolver } from '../media-probe.ts';
import { PipelineStepError } from './pipeline.ts';

/**
 * 文件转码用的 ffmpeg 与 ffprobe（PATH 里的，或 `BAOCUT_FFMPEG` / `BAOCUT_FFPROBE`，与媒体分析相同）。
 * 中止时先 SIGTERM，宽限之后 SIGKILL，等进程真正退出再报告，不让它在后台继续写文件。
 */

export type MediaToolResolver = ProbeToolResolver;

/** ffprobe 读出的一个文件的事实。 */
export interface ProbedMedia {
  durationSec: number;
  formatName: string;
  video: { codec: string; width: number; height: number; pixFmt: string; frameRate: string } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
}

const KILL_GRACE_MS = 2000;
const STDERR_TAIL = 4000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 执行一个工具；`onStdout` 收到逐块的标准输出。中止时杀掉进程并等它退出，然后抛 `AbortError`。 */
async function runTool(
  tool: { command: string; env?: NodeJS.ProcessEnv },
  args: string[],
  options: { signal?: AbortSignal; onStdout?: (chunk: string) => void; keepStdout?: boolean } = {},
): Promise<RunResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(tool.command, args, { env: tool.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killTimer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (options.keepStdout !== false) stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener('abort', onAbort);
      if (error.code === 'ENOENT') {
        const remedy = ffmpegMissingRemedy({ ffprobe: true });
        reject(new PipelineStepError('MEDIA_TOOL_UNAVAILABLE', JobsFfmpeg.notFound({ command: tool.command, remedy }), { remedy }));
      } else reject(error);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      if (signal?.aborted) reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      else resolve({ code, stdout, stderr });
    });
  });
}

/** ffmpeg 的版本（`ffmpeg -version` 的第一行里的版本号）。找不到时抛 `MEDIA_TOOL_UNAVAILABLE`。 */
export async function ffmpegVersion(resolve: MediaToolResolver): Promise<string> {
  const run = await runTool(await resolve(), ['-hide_banner', '-version']);
  const match = /ffmpeg version (\S+)/.exec(run.stdout);
  if (run.code !== 0 || !match) throw new PipelineStepError('MEDIA_TOOL_UNAVAILABLE', JobsFfmpeg.ffmpegBroken());
  return match[1]!;
}

/** 用 ffprobe 读一个文件。读不出来时抛 `INPUT_UNREADABLE`。 */
export async function probeMedia(resolve: MediaToolResolver, file: string, signal?: AbortSignal): Promise<ProbedMedia> {
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration,format_name:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels',
    '-of',
    'json',
    `file:${file}`,
  ];
  const run = await runTool(await resolve(), args, signal ? { signal } : {});
  let data: { format?: { duration?: string; format_name?: string }; streams?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(run.stdout) as typeof data;
  } catch {
    data = {};
  }
  if (run.code !== 0 || !data.format) {
    throw new PipelineStepError('INPUT_UNREADABLE', JobsFfmpeg.probeFailed({ file }), { file, stderr: run.stderr.trim().slice(-500) });
  }
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(data.format.duration);
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    formatName: String(data.format.format_name ?? ''),
    video: v
      ? {
          codec: String(v.codec_name ?? ''),
          width: Number(v.width ?? 0),
          height: Number(v.height ?? 0),
          pixFmt: String(v.pix_fmt ?? ''),
          frameRate: String(v.r_frame_rate ?? ''),
        }
      : null,
    audio: a ? { codec: String(a.codec_name ?? ''), sampleRate: Number(a.sample_rate ?? 0), channels: Number(a.channels ?? 0) } : null,
  };
}

/**
 * 执行一次 ffmpeg（参数里已经有 `-progress pipe:1 -nostats`）：按 `out_time_us` 报告写到第几秒。
 * 非零退出时抛 `TRANSCODE_FAILED`，带 stderr 的结尾。
 */
export async function runFfmpeg(
  resolve: MediaToolResolver,
  args: string[],
  options: { signal: AbortSignal; onTime?: (seconds: number) => void },
): Promise<void> {
  let pending = '';
  const run = await runTool(await resolve(), args, {
    signal: options.signal,
    keepStdout: false,
    onStdout: (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const match = /^out_time_us=(\d+)/.exec(line.trim());
        if (match) options.onTime?.(Number(match[1]) / 1e6);
      }
    },
  });
  if (run.code !== 0) {
    throw new PipelineStepError('TRANSCODE_FAILED', JobsFfmpeg.exited({ code: run.code }), {
      exitCode: run.code,
      stderr: run.stderr.trim().slice(-1000),
    });
  }
}
