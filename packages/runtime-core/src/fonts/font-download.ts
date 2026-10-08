import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { refOf, type FontDownloadErrorCode, type Localized, type MessageRef } from '@baocut/protocol';
import { RcFonts } from '@baocut/protocol/messages/runtime-core';

/**
 * 字体的 HTTP 下载（架构设计 §9.1）：CSS 与字体文件都按大小上限读，连不上、5xx、429 与读到一半断开按有界的退避重试，
 * 别的 HTTP 状态不重试；不跟随重定向（文件只从配置的文件主机取）。错误信息与日志里不带地址（地址里有查询参数）。
 * 取消（信号中止）立即停下。
 */

/** 每个错误码的补救（按当前语言）。 */
export function fontDownloadRemedy(code: FontDownloadErrorCode): Localized {
  switch (code) {
    case 'FONT_DOWNLOAD_NETWORK':
      return RcFonts.remedyNetwork();
    case 'FONT_DOWNLOAD_SOURCE':
      return RcFonts.remedySource();
    case 'FONT_DOWNLOAD_INTEGRITY':
      return RcFonts.remedyIntegrity();
    case 'FONT_DOWNLOAD_NO_SPACE':
      return RcFonts.remedyNoSpace();
  }
}

/** 补救文字表（读取时按当前语言取）。 */
export const FONT_DOWNLOAD_REMEDIES: Readonly<Record<FontDownloadErrorCode, string>> = {
  get FONT_DOWNLOAD_NETWORK() {
    return fontDownloadRemedy('FONT_DOWNLOAD_NETWORK').text;
  },
  get FONT_DOWNLOAD_SOURCE() {
    return fontDownloadRemedy('FONT_DOWNLOAD_SOURCE').text;
  },
  get FONT_DOWNLOAD_INTEGRITY() {
    return fontDownloadRemedy('FONT_DOWNLOAD_INTEGRITY').text;
  },
  get FONT_DOWNLOAD_NO_SPACE() {
    return fontDownloadRemedy('FONT_DOWNLOAD_NO_SPACE').text;
  },
};

export class FontDownloadError extends Error {
  readonly code: FontDownloadErrorCode;
  readonly remedy: string;
  readonly remedyRef: MessageRef;
  readonly messageRef?: MessageRef;
  readonly details: Record<string, unknown>;

  constructor(code: FontDownloadErrorCode, message: string | Localized, details: Record<string, unknown> = {}) {
    super(typeof message === 'string' ? message : message.text);
    this.name = 'FontDownloadError';
    this.code = code;
    const remedy = fontDownloadRemedy(code);
    this.remedy = remedy.text;
    this.remedyRef = refOf(remedy);
    if (typeof message !== 'string') this.messageRef = refOf(message);
    this.details = details;
  }
}

export interface FontDownloadOptions {
  fetch?: typeof fetch;
  /** 连续失败几次后放弃（默认 3）。 */
  retries?: number;
  backoffMs?: (attempt: number) => number;
  /** 多久没有收到字节算停滞（默认 30 秒）。 */
  stallMs?: number;
}

class Retryable extends Error {
  readonly reason: string;
  readonly status: number | null;

  constructor(reason: string, status: number | null = null) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}

interface Request {
  url: string;
  headers?: Record<string, string>;
  /** 给人看的名字（错误信息用，不是地址）。 */
  what: string | Localized;
  maxBytes: number;
  signal: AbortSignal;
  onBytes?: (received: number, total: number | null) => void;
}

/** 取一段文字（CSS）。 */
export async function fetchFontText(request: Request, options: FontDownloadOptions = {}): Promise<string> {
  const chunks: Buffer[] = [];
  await withRetries(request, options, async (response, onChunk) => {
    chunks.length = 0;
    await readBody(response, request, onChunk, (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
  });
  return Buffer.concat(chunks).toString('utf8');
}

/** 取一个文件写到 `file`（覆盖），返回字节数与 sha256（十六进制）。 */
export async function fetchFontFile(
  request: Request,
  file: string,
  options: FontDownloadOptions = {},
): Promise<{ size: number; sha256: string }> {
  let result = { size: 0, sha256: '' };
  await withRetries(request, options, async (response, onChunk) => {
    const hash = createHash('sha256');
    let size = 0;
    const handle = await fs.open(file, 'w');
    try {
      await readBody(response, request, onChunk, async (chunk) => {
        try {
          await handle.write(chunk);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
            throw new FontDownloadError('FONT_DOWNLOAD_NO_SPACE', RcFonts.diskFullWriting({ what: request.what }));
          }
          throw error;
        }
        hash.update(chunk);
        size += chunk.byteLength;
      });
    } finally {
      await handle.close();
    }
    result = { size, sha256: hash.digest('hex') };
  });
  return result;
}

async function withRetries(
  request: Request,
  options: FontDownloadOptions,
  consume: (response: Response, onChunk: () => void) => Promise<void>,
): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const retries = options.retries ?? 3;
  const backoff = options.backoffMs ?? ((attempt: number) => Math.min(8_000, 1_000 * 2 ** (attempt - 1)));
  const stallMs = options.stallMs ?? 30_000;
  const { signal } = request;
  for (let failures = 0; ;) {
    signal.throwIfAborted();
    const attempt = new AbortController();
    const onAbort = () => attempt.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        attempt.abort(new Error('stalled'));
      }, stallMs);
    };
    try {
      arm();
      let response: Response;
      try {
        response = await fetchImpl(request.url, { headers: request.headers ?? {}, signal: attempt.signal, redirect: 'manual' });
      } catch {
        if (signal.aborted) throw signal.reason;
        throw new Retryable(stalled ? 'stalled' : 'connect');
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429 || response.status >= 500) throw new Retryable(`HTTP ${response.status}`, response.status);
        throw new FontDownloadError('FONT_DOWNLOAD_SOURCE', RcFonts.sourceHttpStatus({ what: request.what, status: response.status }), {
          status: response.status,
        });
      }
      try {
        await consume(response, arm);
      } catch (error) {
        if (error instanceof FontDownloadError) throw error;
        if (signal.aborted) throw signal.reason;
        throw new Retryable(stalled ? 'stalled' : 'stream-broken', response.status);
      }
      return;
    } catch (error) {
      if (!(error instanceof Retryable)) throw error;
      failures += 1;
      if (failures > retries) {
        throw new FontDownloadError('FONT_DOWNLOAD_NETWORK', RcFonts.downloadFailed({ what: request.what, reason: error.reason }), {
          reason: error.reason,
          ...(error.status !== null ? { status: error.status } : {}),
          attempts: failures,
        });
      }
      await sleep(backoff(failures), signal);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/** 按上限读回应的正文；每收到一块调一次 `onChunk`（停滞重新计时）。 */
async function readBody(
  response: Response,
  request: Request,
  onChunk: () => void,
  sink: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
  const declared = Number(response.headers.get('content-length'));
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (total !== null && total > request.maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new FontDownloadError('FONT_DOWNLOAD_INTEGRITY', RcFonts.overByteLimit({ what: request.what, limit: request.maxBytes }), {
      maxBytes: request.maxBytes,
    });
  }
  if (!response.body) throw new Retryable('empty-body', response.status);
  let received = 0;
  request.onBytes?.(0, total);
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    onChunk();
    received += chunk.byteLength;
    if (received > request.maxBytes) {
      throw new FontDownloadError('FONT_DOWNLOAD_INTEGRITY', RcFonts.overByteLimit({ what: request.what, limit: request.maxBytes }), {
        maxBytes: request.maxBytes,
      });
    }
    await sink(chunk);
    request.onBytes?.(received, total);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
