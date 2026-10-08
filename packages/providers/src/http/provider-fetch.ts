import { ProviderFailure } from '@baocut/models';
import type { Localized } from '@baocut/protocol';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

/**
 * 在线 Provider 的 HTTP 请求（架构设计 §6.4）：全局 `fetch`，加上这几条规矩。
 *
 * - **密钥**只放在 `auth` 指定的请求头里，只发往原始请求的源（scheme + host + port）。错误信息、`details` 与抛出的文本
 *   都先去掉密钥（原样出现的、以及形如 `sk-…`、`sk_…`、`AIza…` 的串），再截短。
 * - **响应体**整个读进内存，不超过 64 MB（语音、图片的二进制响应也一样，按字节计）。
 * - **重定向**手动处理（`redirect: 'manual'`），最多 3 次：同源照常带上密钥；跨源的 GET 去掉密钥再跟；跨源的 POST
 *   不跟——那会把素材送到用户没有配置的地址——直接以 `PROVIDER_REJECTED` 失败；跨源的 DELETE 同样不跟。
 * - **重试**：连不上、超时、5xx 退避重试，一共 3 次，仍然不行是 `unavailable-remote`（`PROVIDER_UNAVAILABLE`，
 *   `details.reason` 为 `unreachable`、`timeout` 或 `server-error`）。响应带 `Retry-After` 时按它等（至多 30 秒）而不是按退避。
 *   4xx 不重试：401/403 是 `PROVIDER_AUTH_FAILED`；429 是 `PROVIDER_QUOTA_EXCEEDED`（限速与额度用尽都是 429）——只有带
 *   `Retry-After` 且不超过 30 秒的 429（限速）按它等过之后在同样的 3 次之内重试，没带或更久的（额度用尽）立即失败，
 *   `details.retryAfterSec` 记下供应商给的秒数；其余 4xx 是 `PROVIDER_REJECTED`。适配器可以在 `classify` 里改写
 *   （例如 Google 的 400 `API_KEY_INVALID` 是认证失败，上下文过长是 `INPUT_TOO_LONG`），并给出 `details.reason`。
 *   每次重试之前调用 `onRetry`（计数用）。
 * - **取消**：`signal` 中止时立即中止在途请求（连接随之关闭），抛 `ProviderAborted`。
 */

export class ProviderAborted extends Error {
  constructor() {
    super(PH.aborted().text);
    this.name = 'ProviderAborted';
  }
}

export interface ProviderHttpOptions {
  /** 给人看的 Provider 名字，用在错误信息里。 */
  label: string;
  /** 要从错误信息里去掉的密钥。 */
  secrets: readonly string[];
  /** 第 n 次失败之后等多久再试（毫秒）；默认 500·2^(n-1) 加抖动。测试注入。 */
  backoffMs?: (attempt: number) => number;
  /** 一共试几次（默认 3）。 */
  attempts?: number;
}

export interface ProviderRequest {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  /** 不含密钥的请求头。 */
  headers?: Record<string, string>;
  /** 带密钥的请求头：只发往原始请求的源。 */
  auth?: { header: string; value: string } | null;
  /** 每次尝试都重新构造（重试与重定向都要新的请求体）。 */
  body?: () => BodyInit | Promise<BodyInit>;
  /** 单次尝试的期限。 */
  timeoutMs: number;
  signal: AbortSignal;
  /** 适配器改写 4xx 的分类（可以带上 `details.reason`）；返回 null 用默认分类。 */
  classify?: (status: number, body: string) => RejectionCode | { code: RejectionCode; reason?: string } | null;
  /** 每次退避重试之前调用一次。 */
  onRetry?: () => void;
}

export type RejectionCode = 'PROVIDER_AUTH_FAILED' | 'PROVIDER_QUOTA_EXCEEDED' | 'PROVIDER_REJECTED' | 'INPUT_TOO_LONG';

/** 按 `Retry-After` 至多等这么久（秒）；更久的 429 当作额度用尽，不重试。 */
export const MAX_RETRY_AFTER_SEC = 30;

class AttemptTimeout extends Error {}

export interface ProviderResponse {
  status: number;
  /** 响应体的原始字节（语音等二进制响应用它）。 */
  bytes: Buffer;
  /** `content-type` 响应头；没有时 null。 */
  contentType: string | null;
  /** 响应体按 UTF-8 解成的文本。 */
  readonly text: string;
  json<T = unknown>(): T;
}

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MESSAGE_LIMIT = 300;

export async function providerFetch(options: ProviderHttpOptions, request: ProviderRequest): Promise<ProviderResponse> {
  const attempts = options.attempts ?? 3;
  const backoff = options.backoffMs ?? defaultBackoff;
  let last: { status: number | null; message: string; reason: 'unreachable' | 'timeout' | 'server-error' } = {
    status: null,
    message: '',
    reason: 'unreachable',
  };
  const retry = async (attempt: number, delayMs: number) => {
    if (attempt >= attempts) return;
    request.onRetry?.();
    await sleep(delayMs, request.signal);
  };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (request.signal.aborted) throw new ProviderAborted();
    let response: Response;
    let body: Buffer;
    try {
      response = await send(options, request);
      body = await readBody(response);
    } catch (error) {
      if (error instanceof ProviderAborted || error instanceof ProviderFailure) throw error;
      if (request.signal.aborted) throw new ProviderAborted();
      last = {
        status: null,
        message: redact(errorText(error), options.secrets),
        reason: error instanceof AttemptTimeout ? 'timeout' : 'unreachable',
      };
      await retry(attempt, backoff(attempt));
      continue;
    }
    const status = response.status;
    if (status >= 200 && status < 300) return wrap(status, body, response.headers.get('content-type'), options);
    const text = body.toString('utf8');
    const retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
    if (status >= 500) {
      last = { status, message: providerMessage(text, options.secrets), reason: 'server-error' };
      await retry(attempt, retryAfter !== null ? Math.min(retryAfter, MAX_RETRY_AFTER_SEC) * 1000 : backoff(attempt));
      continue;
    }
    const classified = request.classify?.(status, text) ?? defaultClassify(status);
    const { code, reason } = typeof classified === 'string' ? { code: classified, reason: undefined } : classified;
    // 限速：带了不太久的 Retry-After，等过之后在同样的次数之内再试。
    if (
      code === 'PROVIDER_QUOTA_EXCEEDED' &&
      reason !== 'insufficient-quota' &&
      retryAfter !== null &&
      retryAfter <= MAX_RETRY_AFTER_SEC &&
      attempt < attempts
    ) {
      await retry(attempt, retryAfter * 1000);
      continue;
    }
    const message = providerMessage(text, options.secrets);
    throw new ProviderFailure('rejected', described(PH.rejected({ label: options.label, status }), message), {
      code,
      status,
      ...(reason ? { reason } : {}),
      ...(status === 429 && retryAfter !== null ? { retryAfterSec: retryAfter } : {}),
    });
  }
  const what = last.status === null ? PH.unreachable({ label: options.label }) : PH.httpStatus({ label: options.label, status: last.status });
  throw new ProviderFailure(
    'unavailable-remote',
    described(attempts > 1 ? PH.failedAfterAttempts({ what, attempts }) : what, last.message),
    {
      code: 'PROVIDER_UNAVAILABLE',
      reason: last.reason,
      attempts,
      ...(last.status !== null ? { status: last.status } : {}),
    },
  );
}

/** `Retry-After`：秒数或 HTTP 日期；认不出时 null。 */
export function retryAfterSeconds(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

/** 一次尝试：手动跟重定向。 */
async function send(options: ProviderHttpOptions, request: ProviderRequest): Promise<Response> {
  const origin = new URL(request.url).origin;
  let url = request.url;
  let method = request.method;
  for (let hop = 0; ; hop++) {
    const sameOrigin = new URL(url).origin === origin;
    const headers: Record<string, string> = { ...request.headers };
    if (request.auth && sameOrigin) headers[request.auth.header] = request.auth.value;
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        redirect: 'manual',
        signal,
        ...(method === 'POST' && request.body ? { body: await request.body() } : {}),
      });
    } catch (error) {
      if (request.signal.aborted) throw new ProviderAborted();
      if (timeout.aborted) throw new AttemptTimeout(PH.noResponse({ label: options.label, seconds: Math.round(request.timeoutMs / 1000) }).text);
      throw error;
    }
    if (response.status < 300 || response.status >= 400 || !response.headers.has('location')) return response;
    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw failure(options, PH.tooManyRedirects({ label: options.label }).text);
    let next: URL;
    try {
      next = new URL(response.headers.get('location')!, url);
    } catch {
      throw failure(options, PH.badRedirect({ label: options.label }).text);
    }
    if (next.protocol !== 'https:' && next.protocol !== 'http:') throw failure(options, PH.redirectProtocol({ label: options.label }).text);
    if (method !== 'GET' && next.origin !== origin) {
      throw failure(options, PH.redirectOrigin({ label: options.label }).text);
    }
    // 301/302/303 按惯例改为 GET；307/308 保持方法与请求体。
    if (method === 'POST' && (response.status === 301 || response.status === 302 || response.status === 303)) method = 'GET';
    url = next.toString();
  }
}

/** 一句说明，有原话时接在后面。 */
function described(text: Localized, message: string | null | undefined): string {
  return (message ? PH.withMessage({ text, message }) : text).text;
}

function failure(options: ProviderHttpOptions, message: string): ProviderFailure {
  return new ProviderFailure('rejected', redact(message, options.secrets), { code: 'PROVIDER_REJECTED' });
}

function defaultClassify(status: number): RejectionCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_FAILED';
  if (status === 429) return 'PROVIDER_QUOTA_EXCEEDED';
  return 'PROVIDER_REJECTED';
}

async function readBody(response: Response): Promise<Buffer> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderFailure('protocol', PH.responseTooLarge().text);
  }
  if (!response.body) return Buffer.alloc(0);
  // 边读边数：没有 content-length（分块传输）时也不越过上限。
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new ProviderFailure('protocol', PH.responseTooLarge().text);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function wrap(status: number, bytes: Buffer, contentType: string | null, options: ProviderHttpOptions): ProviderResponse {
  let text: string | null = null;
  return {
    status,
    bytes,
    contentType,
    get text() {
      text ??= bytes.toString('utf8');
      return text;
    },
    json<T>(): T {
      try {
        return JSON.parse(this.text) as T;
      } catch {
        throw new ProviderFailure('protocol', PH.invalidJson({ label: options.label }).text);
      }
    },
  };
}

/** 供应商错误体里给人看的那句话（OpenAI 与 Google 都是 `{ error: { message } }`），去掉密钥并截短。 */
function providerMessage(text: string, secrets: readonly string[]): string {
  let message = text;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const candidate = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (typeof candidate === 'string') message = candidate;
  } catch {
    // 不是 JSON：用原文。
  }
  return redact(message.replace(/\s+/g, ' ').trim(), secrets);
}

/** 去掉密钥：原样出现的，以及常见的密钥形状；再截短到 300 字符。 */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('[REDACTED]');
  out = out.replace(/\bsk[-_][A-Za-z0-9_-]{8,}/g, '[REDACTED]').replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]');
  return out.length > MESSAGE_LIMIT ? `${out.slice(0, MESSAGE_LIMIT)}…` : out;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: unknown } }).cause;
    return typeof cause?.code === 'string' ? PH.errorCode({ message: error.message, code: cause.code }).text : error.message;
  }
  return String(error);
}

function defaultBackoff(attempt: number): number {
  return 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ProviderAborted());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderAborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
