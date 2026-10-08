import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import http from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  NODE_ERROR,
  NODE_PROTOCOL_HEADER,
  NODE_PROTOCOL_VERSION,
  type NodeHealth,
  type NodeJob,
  type NodeJobEvent,
  type NodeJobRequest,
  type NodePairResponse,
  type RemoteNodeRejectReason,
} from '@baocut/protocol';
import { NodesClient as NC } from '@baocut/protocol/messages/nodes';

/**
 * 节点服务的 HTTP 客户端（节点协议规范 §2–§7），发起端用。只用 `node:http`：上传要带 `Content-Length` 的流式请求体
 * （节点拒收 `Transfer-Encoding`），事件流要能按空闲期限断开。每个请求一条新连接（`agent: false`），不留陈旧的长连接。
 *
 * 令牌只放在 `Authorization` 头里：错误的说明只有节点给出的文字、主机与端口、系统的错误码，从不带请求头。
 */

/** 节点返回的非 2xx（规范 §8）。`message` 是节点的说明。 */
export class NodeResponseError extends Error {
  readonly status: number;
  /** 节点的错误码；响应体不合规时为 `HTTP_<status>`。 */
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NodeResponseError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 连不上、连接中断、超时，或响应不是合法的 JSON。 */
export class NodeConnectionError extends Error {
  /** 系统错误码（`ECONNREFUSED`……）或 `TIMEOUT`、`BAD_RESPONSE`。 */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NodeConnectionError';
    this.code = code;
  }
}

/** 中止（调用方的 `AbortSignal`）。 */
export class NodeRequestAborted extends Error {
  constructor() {
    super('Request aborted');
    this.name = 'NodeRequestAborted';
  }
}

/** 节点的拒绝 → `REMOTE_NODE_REJECTED` 的 `details.reason`（规范 §9、§10）；不是拒绝时 null。 */
export function rejectReason(error: NodeResponseError): RemoteNodeRejectReason | null {
  switch (error.code) {
    case NODE_ERROR.UNAUTHORIZED:
      return 'unpaired';
    case NODE_ERROR.PROTOCOL_VERSION_UNSUPPORTED:
      return 'version';
    case NODE_ERROR.CAPABILITY_DISABLED:
      return 'capability-disabled';
    case NODE_ERROR.MODEL_NOT_READY:
      return 'model-not-ready';
    case NODE_ERROR.QUEUE_FULL:
      return 'queue-full';
    case NODE_ERROR.DISK_LOW:
      return 'disk-low';
    case NODE_ERROR.SOURCE_NOT_ALLOWED:
      return 'source-not-allowed';
    case NODE_ERROR.INPUT_TOO_LARGE:
      return 'input-too-large';
    case NODE_ERROR.PAIRING_CODE_INVALID:
      return 'pairing-code-invalid';
    case NODE_ERROR.PAIRING_LOCKED:
      return 'pairing-locked';
  }
  // 响应体不合规时按状态码认。
  if (error.status === 401) return 'unpaired';
  if (error.status === 426) return 'version';
  return null;
}

/** 这台发起端与节点的协议版本是否兼容（规范 §2：双方各自的最低版本）。 */
export function versionCompatible(health: Pick<NodeHealth, 'nodeProtocolVersion' | 'minNodeProtocolVersion'>): boolean {
  return (
    Number.isInteger(health.nodeProtocolVersion) &&
    Number.isInteger(health.minNodeProtocolVersion) &&
    NODE_PROTOCOL_VERSION >= health.minNodeProtocolVersion &&
    health.nodeProtocolVersion >= NODE_PROTOCOL_VERSION_MIN_ACCEPTED
  );
}

/** 发起端能对话的最低节点协议版本。 */
const NODE_PROTOCOL_VERSION_MIN_ACCEPTED = 1;
/** JSON 响应的上限（健康、任务记录、错误）。 */
const JSON_RESPONSE_LIMIT = 1024 * 1024;

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  token?: string | null;
  json?: unknown;
  headers?: Record<string, string | number>;
  /** 整个请求（含读完 JSON 响应）的期限；`streaming` 时只管到响应头。 */
  timeoutMs?: number;
  /** 响应体是长流（事件流）：期限只管到响应头。 */
  streaming?: boolean;
  /** 连接上没有数据流动的期限（上传、下载）。 */
  idleMs?: number;
  signal?: AbortSignal;
}

export class NodeClient {
  readonly host: string;
  readonly port: number;

  constructor(host: string, port: number) {
    // `[::1]` 这样的写法去掉方括号：`http.request` 要的是裸地址。
    this.host = host.replace(/^\[(.*)\]$/, '$1');
    this.port = port;
  }

  get label(): string {
    return this.host.includes(':') ? `[${this.host}]:${this.port}` : `${this.host}:${this.port}`;
  }

  health(options: { timeoutMs: number; signal?: AbortSignal }): Promise<NodeHealth> {
    return this.#json<NodeHealth>({ method: 'GET', path: '/v1/health', ...options });
  }

  pair(body: { code: string; clientId: string; clientName: string }, options: { timeoutMs: number }): Promise<NodePairResponse> {
    return this.#json<NodePairResponse>({ method: 'POST', path: '/v1/pair', json: body, ...options });
  }

  createJob(token: string, request: NodeJobRequest, options: { timeoutMs: number; signal?: AbortSignal }): Promise<NodeJob> {
    return this.#json<NodeJob>({ method: 'POST', path: '/v1/jobs', token, json: request, ...options });
  }

  getJob(token: string, jobId: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<NodeJob> {
    return this.#json<NodeJob>({ method: 'GET', path: `/v1/jobs/${encodeURIComponent(jobId)}`, token, ...options });
  }

  cancelJob(token: string, jobId: string, options: { timeoutMs: number }): Promise<NodeJob> {
    return this.#json<NodeJob>({ method: 'POST', path: `/v1/jobs/${encodeURIComponent(jobId)}/cancel`, token, ...options });
  }

  async deleteJob(token: string, jobId: string, options: { timeoutMs: number }): Promise<void> {
    await this.#json<void>({ method: 'DELETE', path: `/v1/jobs/${encodeURIComponent(jobId)}`, token, ...options });
  }

  /** 上传媒体：文件流式读出，`Content-Length` 为 `byteLength`，不把文件读进内存。 */
  async upload(
    token: string,
    jobId: string,
    file: string,
    byteLength: number,
    options: { idleMs: number; signal?: AbortSignal },
  ): Promise<void> {
    const response = await this.#send(
      {
        method: 'PUT',
        path: `/v1/jobs/${encodeURIComponent(jobId)}/input`,
        token,
        headers: { 'content-type': 'application/octet-stream', 'content-length': byteLength },
        ...options,
      },
      (request) => {
        const source = createReadStream(file);
        source.on('error', (error) => request.destroy(error));
        request.on('close', () => source.destroy());
        source.pipe(request);
      },
    );
    await this.#finish(response);
  }

  /** 打开事件流（`since` 之后的事件）。返回的响应由调用方逐行读取并负责销毁。 */
  async events(
    token: string,
    jobId: string,
    since: number,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<http.IncomingMessage> {
    const response = await this.#send({
      method: 'GET',
      path: `/v1/jobs/${encodeURIComponent(jobId)}/events${since > 0 ? `?since=${since}` : ''}`,
      token,
      streaming: true,
      ...options,
    });
    if (response.statusCode !== 200) {
      await this.#finish(response);
      throw new NodeConnectionError('BAD_RESPONSE', NC.badEventStream({ label: this.label }).text);
    }
    return response;
  }

  /** 下载结果到 `dest`，同时算 sha256。返回小写十六进制的摘要与长度。 */
  async download(
    token: string,
    jobId: string,
    dest: string,
    options: { idleMs: number; signal?: AbortSignal },
  ): Promise<{ sha256: string; byteLength: number }> {
    const response = await this.#send({ method: 'GET', path: `/v1/jobs/${encodeURIComponent(jobId)}/result`, token, ...options });
    if (response.statusCode !== 200) {
      await this.#finish(response);
      throw new NodeConnectionError('BAD_RESPONSE', NC.badResultResponse({ label: this.label }).text);
    }
    const hash = crypto.createHash('sha256');
    let byteLength = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteLength += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(response, meter, createWriteStream(dest));
    } catch (error) {
      throw this.#connectionError(error);
    }
    return { sha256: hash.digest('hex'), byteLength };
  }

  // ---- 内部 ----

  async #json<T>(options: RequestOptions): Promise<T> {
    const response = await this.#send(options);
    const body = await this.#finish(response);
    if (response.statusCode === 204 || body.length === 0) return undefined as T;
    try {
      return JSON.parse(body.toString('utf8')) as T;
    } catch {
      throw new NodeConnectionError('BAD_RESPONSE', NC.badJson({ label: this.label }).text);
    }
  }

  /** 读完响应体；非 2xx 抛 `NodeResponseError`。 */
  async #finish(response: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of response) {
        size += (chunk as Buffer).length;
        if (size > JSON_RESPONSE_LIMIT) {
          response.destroy();
          throw new NodeConnectionError('BAD_RESPONSE', NC.responseTooLarge({ label: this.label }).text);
        }
        chunks.push(chunk as Buffer);
      }
    } catch (error) {
      throw this.#connectionError(error);
    }
    const body = Buffer.concat(chunks);
    const status = response.statusCode ?? 0;
    if (status >= 200 && status < 300) return body;
    type ErrorBody = { error?: { code?: unknown; message?: unknown; details?: unknown } } | null;
    let parsed: ErrorBody;
    try {
      parsed = JSON.parse(body.toString('utf8')) as ErrorBody;
    } catch {
      parsed = null;
    }
    const error = parsed?.error;
    const code = typeof error?.code === 'string' ? error.code : `HTTP_${status}`;
    const message = typeof error?.message === 'string' ? error.message : NC.nodeReturnedStatus({ status }).text;
    const details =
      error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
        ? (error.details as Record<string, unknown>)
        : undefined;
    throw new NodeResponseError(status, code, message, details);
  }

  /**
   * 发出请求，等到响应头。`write` 给出时由它写请求体（并负责结束），否则写 `json` 或空体。
   * `timeoutMs` 管到响应体读完（调用方读完之前计时器还在）；`idleMs` 管连接上的空闲。
   */
  #send(options: RequestOptions, write?: (request: http.ClientRequest) => void): Promise<http.IncomingMessage> {
    const headers: Record<string, string | number> = { [NODE_PROTOCOL_HEADER]: String(NODE_PROTOCOL_VERSION), ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let payload: Buffer | null = null;
    if (options.json !== undefined) {
      payload = Buffer.from(JSON.stringify(options.json));
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new NodeRequestAborted());
        return;
      }
      let settled = false;
      const request = http.request({ host: this.host, port: this.port, method: options.method, path: options.path, headers, agent: false });
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        options.signal?.removeEventListener('abort', onAbort);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        request.destroy(new NodeRequestAborted());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.timeoutMs) {
        timer = setTimeout(
          () => request.destroy(new NodeConnectionError('TIMEOUT', NC.timedOut({ label: this.label }).text)),
          options.timeoutMs,
        );
      }
      if (options.idleMs) {
        request.setTimeout(options.idleMs, () =>
          request.destroy(new NodeConnectionError('TIMEOUT', NC.idleTimeout({ label: this.label }).text)),
        );
      }
      request.on('error', (error) => fail(this.#connectionError(error)));
      request.on('response', (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        settled = true;
        if (options.streaming && timer) {
          clearTimeout(timer);
          timer = null;
        }
        // 响应体读完或连接关闭时才清掉计时器与中止监听：读响应体的过程同样受它们约束。
        const done = () => cleanup();
        response.on('end', done);
        response.on('close', done);
        response.on('error', () => {});
        // 计时器或中止在读响应体时触发：`request.destroy` 也会销毁响应。
        resolve(response);
      });
      if (write) write(request);
      else request.end(payload ?? undefined);
    });
  }

  #connectionError(error: unknown): Error {
    if (error instanceof NodeRequestAborted || error instanceof NodeConnectionError || error instanceof NodeResponseError) return error;
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return new NodeConnectionError(code ?? 'NETWORK', (code ? NC.connectionFailedCode({ label: this.label, code }) : NC.connectionFailed({ label: this.label })).text);
  }
}

/** 事件流的一行（心跳之外的事件带 `seq`）。 */
export type StreamedNodeEvent = NodeJobEvent;

/**
 * 逐行读 NDJSON 事件流。`idleMs` 内没有任何数据（心跳也算数据）就销毁响应并抛 `NodeConnectionError('TIMEOUT')`。
 * 流正常结束时迭代结束；不合规的行抛 `NodeConnectionError('BAD_RESPONSE')`。
 */
export async function* readEventStream(response: http.IncomingMessage, idleMs: number): AsyncGenerator<StreamedNodeEvent> {
  let idle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const arm = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = true;
      response.destroy();
    }, idleMs);
  };
  arm();
  let buffer = '';
  response.setEncoding('utf8');
  try {
    for await (const chunk of response) {
      arm();
      buffer += chunk as string;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === '') continue;
        let event: StreamedNodeEvent;
        try {
          event = JSON.parse(line) as StreamedNodeEvent;
        } catch {
          throw new NodeConnectionError('BAD_RESPONSE', NC.badStreamLine().text);
        }
        yield event;
      }
    }
  } catch (error) {
    if (timedOut) throw new NodeConnectionError('TIMEOUT', NC.noHeartbeat().text);
    if (error instanceof NodeConnectionError) throw error;
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    throw new NodeConnectionError(code ?? 'NETWORK', (code ? NC.streamInterruptedCode({ code }) : NC.streamInterrupted()).text);
  } finally {
    if (idle) clearTimeout(idle);
    if (!response.destroyed) response.destroy();
  }
  if (timedOut) throw new NodeConnectionError('TIMEOUT', NC.noHeartbeat().text);
}
