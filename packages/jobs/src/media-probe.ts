import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import type { GeneratedOutput } from '@baocut/protocol';
import { JobsMediaProbe as M } from '@baocut/protocol/messages/jobs/media-probe.ts';

/**
 * 生成输出的解码校验（架构设计 §7.3）：发布之前先按文件头认出格式，与 Provider 声明的媒体类型核对，再用 ffprobe
 * 按这种格式（指定解复用器，不猜）把整个文件解一遍。音频要有帧、时长、采样率与声道，图片要有宽高。
 * 不合的输出不发布（`MODEL_OUTPUT_INVALID`）。
 */

export type MediaFacts = GeneratedOutput['media'];

export type MediaProbeResult = { ok: true; media: MediaFacts } | { ok: false; problems: string[] };

/** 校验一个输出文件；`mediaType` 是 Provider 声明的。 */
export type MediaProbe = (file: string, mediaType: string) => Promise<MediaProbeResult>;

/** ffprobe 的命令与环境（Runtime 用 `BAOCUT_FFPROBE` 或 PATH 里的 ffprobe）。 */
export type ProbeToolResolver = () => Promise<{ command: string; env?: NodeJS.ProcessEnv }>;

/** 认得的媒体类型 → ffprobe 的解复用器与种类。 */
const FORMATS: Record<string, { demuxer: string; kind: 'audio' | 'image' }> = {
  'audio/mpeg': { demuxer: 'mp3', kind: 'audio' },
  'audio/wav': { demuxer: 'wav', kind: 'audio' },
  'audio/flac': { demuxer: 'flac', kind: 'audio' },
  'image/png': { demuxer: 'png_pipe', kind: 'image' },
  'image/jpeg': { demuxer: 'jpeg_pipe', kind: 'image' },
  'image/webp': { demuxer: 'webp_pipe', kind: 'image' },
};

const PROBE_TIMEOUT_MS = 60_000;
const SNIFF_BYTES = 16;

/** 按文件头认格式；认不出时 null。 */
export function sniffMediaType(head: Uint8Array): string | null {
  const ascii = (start: number, text: string) => text.split('').every((c, i) => head[start + i] === c.charCodeAt(0));
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    ascii(1, 'PNG') &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (head.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (head.length >= 4 && ascii(0, 'fLaC')) return 'audio/flac';
  if (head.length >= 3 && ascii(0, 'ID3')) return 'audio/mpeg';
  // MPEG 音频帧同步字：11 个 1。
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

export function ffprobeMediaProbe(resolve: ProbeToolResolver): MediaProbe {
  return async (file, mediaType) => {
    const format = FORMATS[mediaType];
    if (!format) return { ok: false, problems: [M.unknownMediaType({ mediaType }).text] };
    const head = await readHead(file);
    if (!head) return { ok: false, problems: [M.unreadable().text] };
    const sniffed = sniffMediaType(head);
    if (sniffed !== mediaType) return { ok: false, problems: [M.headerMismatch({ sniffed: sniffed ?? M.unrecognizedFormat(), mediaType }).text] };

    const tool = await resolve();
    const args = [
      '-v',
      'error',
      '-f',
      format.demuxer,
      '-count_frames',
      '-show_entries',
      'stream=codec_type,codec_name,sample_rate,channels,width,height,nb_read_frames:format=duration',
      '-of',
      'json',
      `file:${file}`,
    ];
    const run = await runProbe(tool.command, args, tool.env);
    if (!run.ok) return { ok: false, problems: [run.problem] };
    let parsed: { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
    try {
      parsed = JSON.parse(run.stdout) as typeof parsed;
    } catch {
      return { ok: false, problems: [M.notJson().text] };
    }
    const stream = (parsed.streams ?? []).find((s) => s.codec_type === (format.kind === 'audio' ? 'audio' : 'video'));
    if (!stream) return { ok: false, problems: [(format.kind === 'audio' ? M.noAudioStream() : M.noImage()).text] };
    const frames = Number(stream.nb_read_frames);
    if (!(frames > 0)) return { ok: false, problems: [M.noFrames().text] };
    if (format.kind === 'audio') {
      const durationSec = Number(parsed.format?.duration);
      const sampleRate = Number(stream.sample_rate);
      const channels = Number(stream.channels);
      const problems: string[] = [];
      if (!(durationSec > 0)) problems.push(M.durationNotPositive().text);
      if (!(sampleRate > 0)) problems.push(M.sampleRateNotPositive().text);
      if (!(channels > 0)) problems.push(M.channelsNotPositive().text);
      return problems.length > 0 ? { ok: false, problems } : { ok: true, media: { kind: 'audio', durationSec, sampleRate, channels } };
    }
    const width = Number(stream.width);
    const height = Number(stream.height);
    if (!(width > 0 && height > 0)) return { ok: false, problems: [M.sizeNotPositive().text] };
    return { ok: true, media: { kind: 'image', width, height } };
  };
}

async function readHead(file: string): Promise<Buffer | null> {
  const handle = await fs.open(file, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function runProbe(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
): Promise<{ ok: true; stdout: string } | { ok: false; problem: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, problem: M.cannotRun({ reason: error.message }).text });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ ok: true, stdout: Buffer.concat(stdout).toString('utf8') });
      // 只留第一行：错误信息里不该有路径之外的东西，路径也不往外报。
      const first = stderr.split('\n').find((line) => line.trim()) ?? '';
      const reason = signal ? M.killedBy({ signal }) : M.exitCode({ code: String(code) });
      const output = first ? first.replaceAll(args.at(-1)!.slice('file:'.length), '<output>').replaceAll('file:<output>', '<output>').slice(0, 200) : '';
      resolve({
        ok: false,
        problem: (output ? M.decodeFailedWith({ reason, output }) : M.decodeFailed({ reason })).text,
      });
    });
  });
}

/** 没有配置 ffprobe 时：一律不通过（不发布没有校验过的输出）。 */
export const unavailableProbe: MediaProbe = async () => ({ ok: false, problems: [M.noProbe().text] });
