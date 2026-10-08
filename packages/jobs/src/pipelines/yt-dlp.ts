import { spawn, type ChildProcess } from 'node:child_process';
import { killProcessTree, type SpawnProcess } from '@baocut/process-host';
import { LINK_COOKIE_BROWSERS, type LinkCookieBrowser, type Localized } from '@baocut/protocol';
import { JobsYtDlp } from '@baocut/protocol/messages/jobs/yt-dlp.ts';
import type { JobText } from '../job-text.ts';
import { COOKIE_BROWSER_LABELS } from './cookie-browsers.ts';
import { PipelineStepError } from './pipeline.ts';
import { redactUrlsInText } from './link-url.ts';

/**
 * 用 yt-dlp 解析与下载（架构设计 §7.9、§12.9）。
 *
 * - 参数总是一个数组，不经 shell；链接放在 `--` 之后，不会被当成选项。
 * - 每次都带 `--ignore-config`（不读用户的配置文件，那里可以写 `--exec`）、`--no-plugin-dirs`（不加载插件）、
 *   `--no-cache-dir`、`--no-playlist`；输出模板固定在 staging 里，文件名不取自网页。
 * - 进度只取工具自己报告的字节数（`--progress-template`），不知道总数时不报总数。
 * - 中止时向整个进程组发 SIGTERM，宽限之后 SIGKILL（yt-dlp 合并时会起 ffmpeg 子进程），等它退出才返回。
 *   Windows 上没有进程组：用 taskkill /T /F 结束整棵进程树（PyInstaller 打包的 yt-dlp.exe 自己也会派生子进程）。
 */

const KILL_GRACE_MS = 2000;
const STDERR_TAIL = 6000;
const STDOUT_LIMIT = 64 * 1024 * 1024;

/** 进度行的前缀；模板的字段依次是已下载、总数、估计的总数（不知道时是 `NA`）。 */
export const PROGRESS_PREFIX = 'bcut-progress';
const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`;

const COMMON_ARGS = ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-colors'];

export interface YtDlpTool {
  command: string;
  /** 用解释器运行脚本时的固定参数；同样不经 shell。 */
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export const COOKIE_BROWSERS = LINK_COOKIE_BROWSERS;
export type CookieBrowser = LinkCookieBrowser;
function cookieArgs(browser?: CookieBrowser): string[] {
  if (!browser) return [];
  if (!COOKIE_BROWSERS.includes(browser)) throw new Error(`Unsupported cookie browser: ${browser}`);
  return ['--cookies-from-browser', browser];
}

/** 解析链接：只取元数据（单个 JSON），不下载。 */
export function resolveArgs(url: string, browser?: CookieBrowser): string[] {
  return [...COMMON_ARGS, ...cookieArgs(browser), '--dump-single-json', '--skip-download', '--', url];
}

export interface DownloadOptions {
  cookieBrowser?: CookieBrowser;
  /** 输出模板（staging 里的绝对路径，带 `%(ext)s`）。 */
  output: string;
  audioOnly: boolean;
  subtitleLanguages: readonly string[];
  /** 给了时用这个 ffmpeg 合并音视频。 */
  ffmpegLocation?: string | null;
}

/** 下载媒体（与可选的字幕）。 */
export function downloadArgs(url: string, options: DownloadOptions): string[] {
  // Metadata can advertise CDN formats that are no longer downloadable. Let yt-dlp reject them before selecting a stream.
  const args = [...COMMON_ARGS, ...cookieArgs(options.cookieBrowser), '--check-formats', '--newline', '--progress-template', PROGRESS_TEMPLATE, '--no-mtime', '-o', options.output];
  // 默认要 MP4：画面与声音优先挑 MP4 / M4A 的流、合并成 MP4，浏览器与 Electron 直接播放，不用先转换。网站没有时退回
  // 最好的任意格式；合并时 MP4 装不下的编码（VP9 + Opus 一类）放进 WebM，再不行放进 MKV。
  args.push('-f', options.audioOnly ? 'ba[ext=m4a]/ba/b' : 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b');
  if (!options.audioOnly) args.push('--merge-output-format', 'mp4/webm/mkv');
  if (options.ffmpegLocation) args.push('--ffmpeg-location', options.ffmpegLocation);
  if (options.subtitleLanguages.length > 0) args.push('--write-subs', '--sub-langs', options.subtitleLanguages.join(','));
  args.push('--', url);
  return args;
}

/** 一行进度：已下载的字节数与总数（不知道时 null）。不是进度行时 null。 */
export function parseProgressLine(line: string): { downloaded: number; total: number | null } | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== PROGRESS_PREFIX || parts.length < 4) return null;
  const num = (s: string | undefined) => {
    const n = Number(s);
    return s !== undefined && s !== 'NA' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const downloaded = num(parts[1]);
  if (downloaded === null) return null;
  return { downloaded, total: num(parts[2]) ?? num(parts[3]) };
}

/**
 * 逐个流累计的字节进度：yt-dlp 分别下载画面与声音，每个流的计数从 0 开始。前一个流结束时它的字节数计入基数；
 * 总数只在当前流的总数已知时给出（基数加当前流的总数），不预先猜后面还有多少。
 */
export class ProgressTracker {
  #base = 0;
  #current = 0;

  update(sample: { downloaded: number; total: number | null }): { done: number; total: number | null } {
    if (sample.downloaded < this.#current) this.#base += this.#current;
    this.#current = sample.downloaded;
    return {
      done: this.#base + this.#current,
      total: sample.total === null ? null : this.#base + Math.max(sample.total, sample.downloaded),
    };
  }
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 执行一次 yt-dlp。`onLine` 收到逐行的标准输出（下载时；解析时整段收集）。 */
export async function runYtDlp(
  tool: YtDlpTool,
  args: string[],
  options: {
    signal: AbortSignal;
    onLine?: (line: string) => void;
    keepStdout?: boolean;
    /** 测试注入。 */
    platform?: NodeJS.Platform;
    spawn?: SpawnProcess;
  },
): Promise<RunResult> {
  const { signal } = options;
  signal.throwIfAborted();
  const platform = options.platform ?? process.platform;
  const run = options.spawn ?? spawn;
  return await new Promise<RunResult>((resolve, reject) => {
    const child: ChildProcess = run(tool.command, [...(tool.args ?? []), ...args], {
      env: tool.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: platform !== 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let pending = '';
    let stderr = '';
    let killTimer: NodeJS.Timeout | null = null;
    const kill = (sig: NodeJS.Signals) => killProcessTree(child, sig, { platform, spawn: run });
    const onAbort = () => {
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      if (options.keepStdout && stdout.length < STDOUT_LIMIT) stdout += chunk;
      if (!options.onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const line of lines) options.onLine(line);
    });
    child.stderr!.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      signal.removeEventListener('abort', onAbort);
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        reject(new PipelineStepError('TOOL_NOT_INSTALLED', JobsYtDlp.toolNotFound({ code: error.code }), { tool: 'yt-dlp' }));
      } else reject(error);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      if (pending && options.onLine) options.onLine(pending);
      if (signal.aborted) reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      else resolve({ code, stdout, stderr });
    });
  });
}

/**
 * 失败的种类与给人看的补救（命令与协议规范 §11.3），记进错误的 `details.remedy`：按当前语言生成的文字（`details` 没有引用字段）。
 * 不认识的种类 undefined。
 */
export function linkFailureRemedy(code: string): string | undefined {
  const remedies: Record<string, () => Localized> = {
    LINK_UNSUPPORTED: JobsYtDlp.remedyUnsupported,
    LINK_LOGIN_REQUIRED: JobsYtDlp.remedyLoginRequired,
    LINK_COOKIES_UNAVAILABLE: JobsYtDlp.remedyCookiesUnavailable,
    LINK_TOOL_UPDATE_REQUIRED: JobsYtDlp.remedyToolUpdateRequired,
    LINK_UNAVAILABLE: JobsYtDlp.remedyUnavailable,
    LINK_NETWORK_ERROR: JobsYtDlp.remedyNetworkError,
    LINK_DISK_FULL: JobsYtDlp.remedyDiskFull,
    LINK_DOWNLOAD_FAILED: JobsYtDlp.remedyDownloadFailed,
  };
  return remedies[code]?.().text;
}

/** 按 yt-dlp 的报错（标准错误的结尾）判断失败的种类。链接在报错里一律脱敏。 */
export function classifyFailure(stderr: string, exitCode: number | null): PipelineStepError {
  const text = redactUrlsInText(stderr).trim();
  const errorLine =
    text
      .split('\n')
      .filter((l) => l.startsWith('ERROR:'))
      .at(-1) ??
    text.split('\n').at(-1) ??
    '';
  const code = (() => {
    if (/No space left on device|Errno 28|ENOSPC|disk quota/i.test(text)) return 'LINK_DISK_FULL';
    if (/could not (copy|find).*cookie|failed to decrypt|cookie.*database|keyring|safe storage|keychain|(operation not permitted|permission denied).*cookies/i.test(text)) {
      return 'LINK_COOKIES_UNAVAILABLE';
    }
    if (/update.*yt-dlp|yt-dlp.*outdated|signature extraction failed|nsig extraction failed|Unable to extract/i.test(errorLine)) return 'LINK_TOOL_UPDATE_REQUIRED';
    if (/Unsupported URL|is not a valid URL|no suitable extractor/i.test(errorLine)) return 'LINK_UNSUPPORTED';
    // 旧提取器常在读完元数据后遇到 CDN 403；工具已明确报告过期时先更新，不误导用户交出浏览器 Cookie。
    if (
      /Your yt-dlp version .+ is older than \d+ days|yt-dlp.*outdated/i.test(text) &&
      /HTTP Error 403|403: Forbidden/i.test(errorLine) &&
      !/sign in|log ?in|login required|cookies|members[- ]only|private video|confirm your age|age[- ]restricted|not a bot|authentication/i.test(errorLine)
    ) return 'LINK_TOOL_UPDATE_REQUIRED';
    if (
      /HTTP Error 401|sign in|log ?in|login required|cookies|members[- ]only|private video|confirm your age|age[- ]restricted|not a bot|authentication/i.test(
        errorLine,
      )
    ) {
      return 'LINK_LOGIN_REQUIRED';
    }
    // A CDN 403 alone does not establish that authentication is required.
    if (/HTTP Error 403|403: Forbidden/i.test(errorLine)) return 'LINK_DOWNLOAD_FAILED';
    if (
      /not available in your (country|region)|geo|video unavailable|has been removed|Requested format is not available|no video formats/i.test(
        errorLine,
      )
    ) {
      return 'LINK_UNAVAILABLE';
    }
    if (
      /unable to download|HTTP Error 5\d\d|HTTP Error 429|timed? ?out|connection|getaddrinfo|name or service not known|nodename nor servname|temporary failure in name resolution|network is unreachable|SSL|EOF occurred|Unable to connect/i.test(
        errorLine,
      )
    ) {
      return 'LINK_NETWORK_ERROR';
    }
    return 'LINK_DOWNLOAD_FAILED';
  })();
  // 工具的原话照原样；没有时说明退出码。
  const message: JobText = errorLine.replace(/^ERROR:\s*/, '').slice(0, 300) || JobsYtDlp.exited({ code: exitCode });
  return new PipelineStepError(code, message, { exitCode, stderr: text.slice(-1000), remedy: linkFailureRemedy(code) });
}

/** 换下一个浏览器的 Cookie 可能有用的失败：读不到这个浏览器的 Cookie，或网站仍要求登录。别的失败换浏览器也一样。 */
export function worthAnotherCookieBrowser(error: PipelineStepError): boolean {
  return error.code === 'LINK_COOKIES_UNAVAILABLE' || error.code === 'LINK_LOGIN_REQUIRED';
}

/**
 * 逐个试过的浏览器都没成功（每一次都是 `worthAnotherCookieBrowser`）：有一个是网站要求登录时按要登录报（Cookie 读到了，
 * 只是没登录），否则按读不到 Cookie 报；`details.attempts` 是每个浏览器的结果。只试了一个时原样报那一次的失败。
 */
export function cookieAttemptsFailure(attempts: ReadonlyArray<{ browser: CookieBrowser; error: PipelineStepError }>): PipelineStepError {
  const last = attempts.at(-1)!.error;
  if (attempts.length === 1) return last;
  const code = attempts.some((a) => a.error.code === 'LINK_LOGIN_REQUIRED') ? 'LINK_LOGIN_REQUIRED' : 'LINK_COOKIES_UNAVAILABLE';
  const reason = (a: { browser: CookieBrowser; error: PipelineStepError }) =>
    (a.error.code === 'LINK_LOGIN_REQUIRED' ? JobsYtDlp.cookieLoginRequired : JobsYtDlp.cookieUnreadable)({ browser: COOKIE_BROWSER_LABELS[a.browser] }).text;
  const reasons = attempts.map(reason).join(JobsYtDlp.reasonSeparator().text);
  return new PipelineStepError(code, JobsYtDlp.cookieAttemptsFailed({ count: attempts.length, reasons }), {
    ...last.details,
    attempts: attempts.map((a) => ({ browser: a.browser, code: a.error.code, message: a.error.message })),
    remedy: linkFailureRemedy(code),
  });
}

/**
 * 发布用的文件名：去掉控制字符与路径、保留字符（`/ \ : * ? " < > |`），不以点开头，压缩空白，至多 120 个字符；
 * 什么都不剩时用 `download`。空格与单引号保留（参数不经 shell）。
 */
export function sanitizeFileName(title: string | null | undefined): string {
  const cleaned = [...(title ?? '')]
    .map((ch) => (/[\u0000-\u001f\u007f/\\:*?"<>|]/.test(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+/, '')
    .replace(/[.\s]+$/, '');
  const limited = [...cleaned].slice(0, 120).join('').trim();
  return limited || 'download';
}

/** 解析出的元数据里流程用到的部分（都可能缺）。 */
export interface LinkMetadata {
  title: string | null;
  platform: string | null;
  mediaId: string | null;
  uploader: string | null;
  uploadDate: string | null;
  durationSec: number | null;
  webpageUrl: string | null;
  /** 视频简介（去掉首尾空白，最多 20000 个字符）：润色与识别说话人时的背景，没有自带章节时从中解析时间戳大纲。之前的版本没有这个字段。 */
  description: string | null;
  /** 平台给的章节（info JSON 的 `chapters[]`，源时间秒）：按起点排序、同起点去重，最多 400 条；没有时 null。之前的版本没有这个字段。 */
  chapters: LinkChapter[] | null;
}

/** 平台给的一章：作者写的标题与起点（秒），平台给了终点时带 `end`。 */
export interface LinkChapter {
  start: number;
  end?: number;
  title: string;
}

/** 简介最多保留的字符数。 */
const MAX_DESCRIPTION_CHARS = 20_000;
/** 章节最多保留的条数与标题长度（与字幕与翻译核心的 `source_chapters` 相同）。 */
const MAX_CHAPTERS = 400;
const MAX_CHAPTER_TITLE_CHARS = 160;

/** 按字符（码点）截断，不切开代理对。 */
function clipChars(text: string, max: number): string {
  return text.length <= max ? text : [...text].slice(0, max).join('');
}

/** info JSON 的 `chapters[]`：丢掉起点不是有限非负数、标题为空的条目；终点不比起点大时不要。 */
export function parseChapters(raw: unknown): LinkChapter[] | null {
  if (!Array.isArray(raw)) return null;
  const chapters: LinkChapter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { start_time: start, end_time: end, title } = item as Record<string, unknown>;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) continue;
    const text = typeof title === 'string' ? clipChars(title.replace(/\s+/g, ' ').trim(), MAX_CHAPTER_TITLE_CHARS).trim() : '';
    if (!text) continue;
    chapters.push({ start, ...(typeof end === 'number' && Number.isFinite(end) && end > start ? { end } : {}), title: text });
  }
  chapters.sort((a, b) => a.start - b.start);
  const unique = chapters.filter((chapter, index) => index === 0 || chapter.start !== chapters[index - 1]!.start).slice(0, MAX_CHAPTERS);
  return unique.length > 0 ? unique : null;
}

/** 读 `--dump-single-json` 的输出。不是单个视频（播放列表、直播）时 `LINK_UNSUPPORTED`。 */
export function parseMetadata(stdout: string): LinkMetadata {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new PipelineStepError('LINK_DOWNLOAD_FAILED', JobsYtDlp.metadataUnreadable(), { remedy: linkFailureRemedy('LINK_DOWNLOAD_FAILED') });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new PipelineStepError('LINK_DOWNLOAD_FAILED', JobsYtDlp.metadataNotObject(), {
      remedy: linkFailureRemedy('LINK_DOWNLOAD_FAILED'),
    });
  }
  if (data._type === 'playlist' || data._type === 'multi_video') {
    throw new PipelineStepError('LINK_UNSUPPORTED', JobsYtDlp.playlist(), {
      remedy: linkFailureRemedy('LINK_UNSUPPORTED'),
    });
  }
  if (data.is_live === true || data.live_status === 'is_live' || data.live_status === 'is_upcoming') {
    throw new PipelineStepError('LINK_UNSUPPORTED', JobsYtDlp.live(), { remedy: linkFailureRemedy('LINK_UNSUPPORTED') });
  }
  const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const duration = typeof data.duration === 'number' && Number.isFinite(data.duration) && data.duration >= 0 ? data.duration : null;
  return {
    title: str(data.title),
    platform: str(data.extractor_key, 100) ?? str(data.extractor, 100),
    mediaId: str(data.id, 200),
    uploader: str(data.uploader, 200) ?? str(data.channel, 200),
    uploadDate: str(data.upload_date, 20),
    durationSec: duration,
    webpageUrl: str(data.webpage_url, 2000),
    description:
      typeof data.description === 'string' && data.description.trim() ? clipChars(data.description.trim(), MAX_DESCRIPTION_CHARS) : null,
    chapters: parseChapters(data.chapters),
  };
}
