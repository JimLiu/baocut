import { spawn } from 'node:child_process';
import { ProviderFailure } from '@baocut/models';
import { ffmpegMissingRemedyMessage } from '@baocut/process-host';
import { refOf } from '@baocut/protocol';
import { JobsFfmpeg } from '@baocut/protocol/messages/jobs/ffmpeg.ts';
import { silentLog, type JobsLogger } from './jobs-logger.ts';

/**
 * 参考录音转 WAV（架构设计 §6.1 的本地合成、§6.4「音色克隆的请求」）：本地语音合成把参考录音交给引擎前、音色克隆把参考录音交给公开了
 * 时长范围的适配器前，都用这一个。ffmpeg 把第一条音轨转成单声道 16 位 PCM WAV。不经 shell，只许读本地文件（`file` 协议），
 * 只许白名单里的解复用器；ffmpeg 的输出里有路径，只记日志，不进错误信息。
 *
 * - 返回 true 是转好了；false 是 ffmpeg 读不出（非零退出）、超时或已经取消，由调用方决定怎么办。
 * - ffmpeg 起不来（没装、不可执行）时抛 `tool-unavailable`（任务错误 `MEDIA_TOOL_UNAVAILABLE`，带安装修法）：这是这台机器的
 *   外部工具问题，不是录音读不出来。起进程时别的系统错误（例如打开的文件太多）照原样抛出。
 */

/** 解析好的 ffmpeg：命令与运行环境（登录 shell 的 PATH）。 */
export interface AudioToWavTool {
  command: string;
  env: NodeJS.ProcessEnv;
}

export interface AudioToWavRequest {
  tool: AudioToWavTool;
  /** 输入（绝对路径）。 */
  file: string;
  /** 输出的 WAV（绝对路径），已有时覆盖。 */
  out: string;
  signal: AbortSignal;
  /** 只转开头这么多秒（`-t`）；null 时整段。 */
  maxSec: number | null;
  /** 输出的采样率（`-ar`）；不给时保留原来的。 */
  sampleRate?: number;
  /** 转换的上限；默认 5 分钟。 */
  timeoutMs?: number;
  log?: JobsLogger;
  /** 测试用：换掉 `spawn`。 */
  spawn?: typeof spawn;
}

/** 与 Model Worker、在线 Provider 相同的解复用器白名单。 */
export const AUDIO_DEMUXER_ALLOWLIST = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,aac,mp3,wav,flac,ogg';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** ffmpeg 输出留给日志的尾巴长度。 */
const STDERR_TAIL = 2000;
/** 起进程时算作「没有能用的 ffmpeg」的系统错误：找不到（含路径里有一段不是目录）、没有执行权限。 */
const TOOL_MISSING_ERRNO = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']);

export function audioToWav(request: AudioToWavRequest): Promise<boolean> {
  const { tool, signal, maxSec } = request;
  const log = request.log ?? silentLog;
  const args = [
    '-nostdin',
    '-hide_banner',
    '-protocol_whitelist',
    'file',
    '-v',
    'error',
    '-format_whitelist',
    AUDIO_DEMUXER_ALLOWLIST,
    '-i',
    `file:${request.file}`,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    ...(maxSec !== null ? ['-t', String(maxSec)] : []),
    '-ac',
    '1',
    ...(request.sampleRate !== undefined ? ['-ar', String(request.sampleRate)] : []),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    '-y',
    `file:${request.out}`,
  ];
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve(false);
    const child = (request.spawn ?? spawn)(tool.command, args, { env: tool.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
    });
    const onAbort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => child.kill('SIGKILL'), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let settled = false;
    const settle = () => {
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    // 进程都没起来。找不到、不能执行：这台机器上没有能用的 ffmpeg，按外部工具的问题报告；别的系统错误不是没装 ffmpeg，
    // 照原样抛出，按内部错误处理。已经取消时照旧按取消处理。
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settle();
      if (signal.aborted) return resolve(false);
      if (!TOOL_MISSING_ERRNO.has(error.code ?? '')) return reject(error);
      log.warn('ffmpeg unavailable', { command: tool.command, code: error.code ?? null });
      reject(ffmpegUnavailable(tool.command));
    });
    child.once('exit', (code) => {
      if (settled) return;
      settle();
      if (code !== 0 && !signal.aborted) log.warn('Audio conversion to WAV failed', { stderr: stderr.trim() });
      resolve(code === 0);
    });
  });
}

/**
 * 这台机器上没有能用的 ffmpeg（找不到、不能执行）。按外部工具的问题报告（`MEDIA_TOOL_UNAVAILABLE`，带按平台给的安装修法），
 * 不说成录音读不出来、也不说成安装不完整。修法作为嵌套的目录文字（`ffmpegMissingRemedyMessage`）：存下的说明在别的语言的
 * 界面里整句重新生成，不会剩下生成时那种语言的一段。
 */
export function ffmpegUnavailable(command: string): ProviderFailure {
  const remedy = ffmpegMissingRemedyMessage();
  return new ProviderFailure('tool-unavailable', JobsFfmpeg.notFound({ command, remedy }), {
    tool: 'ffmpeg',
    remedy: remedy.text,
    remedyRef: refOf(remedy),
  });
}
