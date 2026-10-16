import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { OpenMediaError, allowedDownloadHost } from './open-media-sources.ts';

/**
 * 公开素材的 HTTP（`open-media-sources.ts` 的两个来源）：全局 `fetch`，加上这几条规矩。
 *
 * - **User-Agent** 写明是 BaoCut 与项目地址（Wikimedia 要求可识别的 UA，通用 UA 会被拒），不带用户的任何信息；不带 Cookie、不带密钥。
 * - **重试**：连不上、超时、5xx 与 429 退避重试，一共 3 次；429 带 `Retry-After` 时按它等（至多 30 秒）。其余 4xx 不重试。
 * - **下载**只走 https、只认 `allowedDownloadHost` 的主机，重定向手动跟（最多 5 次，每一跳都核对主机），边收边写盘，超过
 *   上限（`Content-Length` 或实收字节）立即中止并删掉半截文件；30 秒没收到字节算停滞。
 */

export const OPEN_MEDIA_USER_AGENT = 'BaoCut (+https://github.com/jimliu/baocut; open media search)';

export interface OpenMediaHttpOptions {
  fetch?: typeof fetch;
  /** 第 n 次失败之后等多久（毫秒）；测试注入。 */
  backoffMs?: (attempt: number) => number;
  /** 多久没收到字节算停滞（毫秒，默认 30 秒）。 */
  stallMs?: number;
}

const ATTEMPTS = 3;
const MAX_RETRY_AFTER_SEC = 30;
const MAX_REDIRECTS = 5;
const JSON_TIMEOUT_MS = 20_000;
const MAX_JSON_BYTES = 16 * 1024 * 1024;

export class OpenMediaHttp {
  readonly #fetch: typeof fetch;
  readonly #backoff: (attempt: number) => number;
  readonly #stallMs: number;

  constructor(options: OpenMediaHttpOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#backoff = options.backoffMs ?? ((attempt) => 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    this.#stallMs = options.stallMs ?? 30_000;
  }

  /** GET 一个 JSON 接口（固定的两个 API 主机）。 */
  async json(url: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.#withRetry(url, signal, JSON_TIMEOUT_MS);
    const text = await readText(response, MAX_JSON_BYTES);
    try {
      return JSON.parse(text);
    } catch {
      throw new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', `${hostOf(url)} did not return JSON`);
    }
  }

  /** 下载一个文件到 `file`，返回字节数。超过 `maxBytes` 时中止并删掉半截文件。 */
  async download(
    url: string,
    file: string,
    maxBytes: number,
    signal?: AbortSignal,
    hostAllowed: (host: string) => boolean = allowedDownloadHost,
  ): Promise<number> {
    let current = url;
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      checkDownloadUrl(current, hostAllowed);
      const attempt = await this.#withRetry(current, signal, 60_000, 'manual');
      if (attempt.status >= 300 && attempt.status < 400) {
        const location = attempt.headers.get('location');
        await attempt.body?.cancel().catch(() => {});
        if (!location) throw new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', `${hostOf(current)} sent a redirect without a Location header`);
        current = new URL(location, current).toString();
        continue;
      }
      response = attempt;
      break;
    }
    if (!response) throw new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', 'Too many redirects');
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw tooLarge(declared, maxBytes);
    }
    if (!response.body) throw new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', 'The response has no body');
    const out = createWriteStream(file, { flags: 'wx' });
    const reader = response.body.getReader();
    let received = 0;
    try {
      for (;;) {
        const chunk = await this.#readWithStall(reader, signal);
        if (chunk.done) break;
        received += chunk.value.byteLength;
        if (received > maxBytes) throw tooLarge(received, maxBytes);
        if (!out.write(chunk.value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      }
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
      return received;
    } catch (error) {
      await reader.cancel().catch(() => {});
      // 等写入流关掉再删：它异步打开文件，先删的话之后才建出来的空文件会留下。
      await new Promise<void>((resolve) => {
        if (out.closed) return resolve();
        out.once('close', () => resolve());
        out.destroy();
      });
      await fs.rm(file, { force: true }).catch(() => {});
      throw error;
    }
  }

  async #readWithStall(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal) {
    let timer: NodeJS.Timeout | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', `Download stalled: no data for ${this.#stallMs / 1000} seconds`)),
        this.#stallMs,
      );
    });
    const aborted = signal
      ? new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true }),
        )
      : null;
    try {
      return await Promise.race([reader.read(), stalled, ...(aborted ? [aborted] : [])]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #withRetry(
    url: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    redirect: RequestRedirect = 'follow',
  ): Promise<Response> {
    let last = '';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      signal?.throwIfAborted();
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        response = await this.#fetch(url, {
          method: 'GET',
          redirect,
          headers: { 'User-Agent': OPEN_MEDIA_USER_AGENT, Accept: '*/*' },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        signal?.throwIfAborted();
        last = error instanceof Error ? error.message : String(error);
        if (attempt < ATTEMPTS) await sleep(this.#backoff(attempt), signal);
        continue;
      }
      if (response.ok || (redirect === 'manual' && response.status >= 300 && response.status < 400)) return response;
      await response.body?.cancel().catch(() => {});
      if (response.status === 429 || response.status >= 500) {
        last = `HTTP ${response.status}`;
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, MAX_RETRY_AFTER_SEC) * 1000 : this.#backoff(attempt);
        if (attempt < ATTEMPTS) await sleep(wait, signal);
        continue;
      }
      throw new OpenMediaError(
        response.status === 404 ? 'OPEN_MEDIA_NOT_FOUND' : 'OPEN_MEDIA_REJECTED',
        `${hostOf(url)} returned HTTP ${response.status}`,
        { status: response.status },
      );
    }
    throw new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', `Cannot reach ${hostOf(url)} (tried ${ATTEMPTS} times): ${last}`, {
      host: hostOf(url),
    });
  }
}

/** 下载地址：https，主机在白名单里。 */
export function checkDownloadUrl(url: string, hostAllowed: (host: string) => boolean = allowedDownloadHost): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OpenMediaError('OPEN_MEDIA_REJECTED', 'Invalid download URL');
  }
  if (parsed.protocol !== 'https:' || !hostAllowed(parsed.hostname)) {
    throw new OpenMediaError(
      'OPEN_MEDIA_REJECTED',
      `Refusing to download from ${parsed.hostname}: only Wikimedia and Internet Archive file hosts are allowed`,
    );
  }
}

function tooLarge(bytes: number, maxBytes: number): OpenMediaError {
  return new OpenMediaError(
    'OPEN_MEDIA_TOO_LARGE',
    `The file is ${Math.ceil(bytes / 1024 / 1024)} MiB, over the ${Math.floor(maxBytes / 1024 / 1024)} MiB limit`,
    { byteLength: bytes, maxBytes },
  );
}

async function readText(response: Response, maxBytes: number): Promise<string> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', 'The API response is too large');
  return buffer.toString('utf8');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the server';
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}
