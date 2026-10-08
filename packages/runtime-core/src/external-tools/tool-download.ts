import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { refOf, type Localized, type MessageRef } from '@baocut/protocol';
import { RcExternalTools } from '@baocut/protocol/messages/runtime-core';

/**
 * 受管工具的单文件下载（架构设计 §12.9）：写进 `<文件>.part`，核对大小与 sha256 之后才交出。
 *
 * - 续传：`.part` 已有 n 字节时带 `Range: bytes=n-`；206 且 `Content-Range` 从 n 开始就接着写，200 表示来源不支持续传，从头写。
 * - 连不上、5xx、429 与读到一半断开按有界的退避重试；404、401、403 不重试。
 * - 续传出来的文件不符时删掉从头再下一次；从头下的仍不符就是校验失败（坏文件删掉）。
 * - 取消（信号中止）立即停下，`.part` 留着，下次续传。
 */

export type ToolDownloadErrorCode = 'TOOL_DOWNLOAD_NO_SPACE' | 'TOOL_DOWNLOAD_NETWORK' | 'TOOL_DOWNLOAD_INTEGRITY' | 'TOOL_DOWNLOAD_SOURCE';

/** 各错误码的补救说明（按当前语言）。 */
export function toolDownloadRemedy(code: ToolDownloadErrorCode): Localized {
  switch (code) {
    case 'TOOL_DOWNLOAD_NO_SPACE':
      return RcExternalTools.remedyNoSpace();
    case 'TOOL_DOWNLOAD_NETWORK':
      return RcExternalTools.remedyNetwork();
    case 'TOOL_DOWNLOAD_INTEGRITY':
      return RcExternalTools.remedyIntegrity();
    case 'TOOL_DOWNLOAD_SOURCE':
      return RcExternalTools.remedySource();
  }
}

/** 各错误码的补救说明的文字：读取时按当前语言生成。 */
export const TOOL_DOWNLOAD_REMEDIES: Readonly<Record<ToolDownloadErrorCode, string>> = {
  get TOOL_DOWNLOAD_NO_SPACE() {
    return toolDownloadRemedy('TOOL_DOWNLOAD_NO_SPACE').text;
  },
  get TOOL_DOWNLOAD_NETWORK() {
    return toolDownloadRemedy('TOOL_DOWNLOAD_NETWORK').text;
  },
  get TOOL_DOWNLOAD_INTEGRITY() {
    return toolDownloadRemedy('TOOL_DOWNLOAD_INTEGRITY').text;
  },
  get TOOL_DOWNLOAD_SOURCE() {
    return toolDownloadRemedy('TOOL_DOWNLOAD_SOURCE').text;
  },
};

export class ToolDownloadError extends Error {
  readonly code: ToolDownloadErrorCode;
  readonly remedy: string;
  readonly remedyRef: MessageRef;
  readonly messageRef: MessageRef | undefined;
  readonly details: Record<string, unknown>;

  constructor(code: ToolDownloadErrorCode, message: string | Localized, details: Record<string, unknown> = {}) {
    super(String(message));
    this.name = 'ToolDownloadError';
    this.code = code;
    const remedy = toolDownloadRemedy(code);
    this.remedy = remedy.text;
    this.remedyRef = refOf(remedy);
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
    this.details = details;
  }
}

export interface ToolDownloadOptions {
  fetch?: typeof fetch;
  /** 连续失败几次后放弃（默认 3）。 */
  retries?: number;
  backoffMs?: (attempt: number) => number;
  /** 多久没有收到字节算停滞（默认 60 秒）。 */
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

/** 下载 `url` 到 `part`，核对之后保留在 `part`（由调用方改名发布）。`onBytes` 收到目前的字节数。 */
export async function downloadToolFile(
  url: string,
  part: string,
  expected: { size: number | null; sha256: string; fileName: string },
  run: { signal: AbortSignal; onBytes: (received: number) => void },
  options: ToolDownloadOptions = {},
): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const retries = options.retries ?? 3;
  const backoff = options.backoffMs ?? ((attempt: number) => Math.min(8_000, 1_000 * 2 ** (attempt - 1)));
  const stallMs = options.stallMs ?? 60_000;
  const { signal } = run;
  let failures = 0;
  let resumed = false;
  let cleanRetried = false;
  for (;;) {
    signal.throwIfAborted();
    let offset = await sizeOf(part);
    if (expected.size !== null && offset > expected.size) {
      await fs.rm(part, { force: true });
      offset = 0;
    }
    if (offset > 0) resumed = true;
    run.onBytes(offset);
    if (expected.size === null || offset < expected.size) {
      try {
        await fetchInto(fetchImpl, url, part, offset, expected, run, stallMs);
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        if (!(error instanceof Retryable)) throw error;
        failures = (await sizeOf(part)) > offset ? 1 : failures + 1;
        if (failures > retries) {
          throw new ToolDownloadError('TOOL_DOWNLOAD_NETWORK', RcExternalTools.downloadFailed({ file: expected.fileName, reason: error.reason }), {
            file: expected.fileName,
            reason: error.reason,
            ...(error.status !== null ? { status: error.status } : {}),
            attempts: failures,
          });
        }
        await sleep(backoff(failures), signal);
        continue;
      }
    }
    const size = await sizeOf(part);
    if ((expected.size === null || size === expected.size) && (await sha256File(part)) === expected.sha256) return;
    await fs.rm(part, { force: true });
    if (resumed && !cleanRetried) {
      cleanRetried = true;
      resumed = false;
      continue;
    }
    throw new ToolDownloadError('TOOL_DOWNLOAD_INTEGRITY', RcExternalTools.integrityMismatch({ file: expected.fileName }), {
      file: expected.fileName,
      expectedSha256: expected.sha256,
      ...(expected.size !== null ? { expectedSize: expected.size } : {}),
    });
  }
}

async function fetchInto(
  fetchImpl: typeof fetch,
  url: string,
  part: string,
  offset: number,
  expected: { size: number | null; fileName: string },
  run: { signal: AbortSignal; onBytes: (received: number) => void },
  stallMs: number,
): Promise<void> {
  const { signal } = run;
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
      response = await fetchImpl(url, {
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
        signal: attempt.signal,
        redirect: 'follow',
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new Retryable(stalled ? 'stalled' : 'connect');
    }
    const status = response.status;
    let start = 0;
    if (status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') ?? '');
      if (!range || Number(range[1]) !== offset) {
        await response.body?.cancel().catch(() => {});
        await fs.rm(part, { force: true });
        throw new Retryable('range-mismatch', status);
      }
      start = offset;
    } else if (status === 416) {
      await response.body?.cancel().catch(() => {});
      if (expected.size === null || offset === expected.size) return;
      await fs.rm(part, { force: true });
      throw new Retryable('range-not-satisfiable', status);
    } else if (status !== 200) {
      await response.body?.cancel().catch(() => {});
      if (status === 429 || status >= 500) throw new Retryable(`HTTP ${status}`, status);
      throw new ToolDownloadError('TOOL_DOWNLOAD_SOURCE', RcExternalTools.sourceHttpStatus({ file: expected.fileName, status }), {
        file: expected.fileName,
        status,
      });
    }
    const handle = await fs.open(part, start > 0 ? 'a' : 'w');
    let written = start;
    try {
      if (!response.body) throw new Retryable('empty-body', status);
      try {
        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
          arm();
          if (expected.size !== null && written + chunk.byteLength > expected.size) {
            throw new ToolDownloadError('TOOL_DOWNLOAD_INTEGRITY', RcExternalTools.largerThanManifest({ file: expected.fileName }), {
              file: expected.fileName,
              expectedSize: expected.size,
            });
          }
          try {
            await handle.write(chunk);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
              throw new ToolDownloadError('TOOL_DOWNLOAD_NO_SPACE', RcExternalTools.diskFull(), { file: expected.fileName });
            }
            throw error;
          }
          written += chunk.byteLength;
          run.onBytes(written);
        }
      } catch (error) {
        if (error instanceof ToolDownloadError) throw error;
        if (signal.aborted) throw signal.reason;
        throw new Retryable(stalled ? 'stalled' : 'stream-broken', status);
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    // 比清单大：坏文件删掉，不留给续传。
    if (error instanceof ToolDownloadError && error.code === 'TOOL_DOWNLOAD_INTEGRITY') await fs.rm(part, { force: true });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function sizeOf(file: string): Promise<number> {
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? stat.size : 0;
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
