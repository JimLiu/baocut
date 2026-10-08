import { RpcError, refOf, type JobError, type Localized, type MessageRef } from '@baocut/protocol';
import { RcModelApi } from '@baocut/protocol/messages/runtime-core';

/**
 * 模型接口服务的错误（架构设计 §4.8）：OpenAI 的错误体 `{ error: { message, type, code } }` 与 HTTP 状态。`code` 是
 * BaoCut 的封闭错误码（命令与协议规范 §11.3 的模型接口服务一节），`type` 按状态取 OpenAI 的写法。
 * 只带错误码与一句说明：不带 `details`（里面可能有原因串与路径，§12.8）。说明是发出时当前语言的文字；错误体没有引用字段，
 * 引用只留在 `messageRef` 上。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  readonly messageRef: MessageRef | undefined;

  constructor(status: number, code: string, message: string | Localized, headers: Record<string, string> = {}) {
    super(String(message));
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }

  get type(): string {
    return errorType(this.status);
  }

  body(): { error: { message: string; type: string; code: string; param: null } } {
    return { error: { message: this.message, type: this.type, code: this.code, param: null } };
  }
}

export function errorType(status: number): string {
  switch (status) {
    case 401:
      return 'authentication_error';
    case 403:
      return 'permission_error';
    case 404:
      return 'not_found_error';
    case 429:
      return 'rate_limit_error';
    case 503:
      return 'service_unavailable_error';
    default:
      return status >= 500 ? 'server_error' : 'invalid_request_error';
  }
}

/** 提交时的 `RpcError`（选择、参数检查）→ HTTP。 */
export function fromRpcError(error: RpcError): ApiError {
  const details = (error.details ?? {}) as { code?: unknown };
  const code = typeof details.code === 'string' ? details.code : null;
  switch (error.code) {
    case 'invalid-request':
      return new ApiError(400, 'INVALID_REQUEST', error.message);
    case 'not-found':
      return new ApiError(404, 'MODEL_NOT_FOUND', error.message);
    case 'busy':
      return new ApiError(503, 'RUNTIME_BUSY', error.message);
    // 数据外发的授权（§12.5）：没有授权、授权已撤销是 403；预算用完、金额无法核算是 409。
    case 'forbidden':
      if (code === 'GRANT_REQUIRED' || code === 'GRANT_REVOKED') return new ApiError(403, code, error.message);
      return new ApiError(403, 'FORBIDDEN', error.message);
    case 'conflict':
      if (code === 'CAPABILITY_NOT_CONFIGURED' || code === 'MODEL_UNAVAILABLE') return new ApiError(503, code, error.message);
      return new ApiError(409, code ?? 'CONFLICT', error.message);
    default:
      return new ApiError(500, 'INTERNAL', RcModelApi.internalError());
  }
}

/** 任务失败（Job 的错误码）→ HTTP。限流时把供应商给的 `Retry-After` 转给调用方。 */
export function fromJobError(error: JobError | null): ApiError {
  if (!error) return new ApiError(500, 'INTERNAL', RcModelApi.jobNotCompleted());
  const details = (error.details ?? {}) as { retryAfterSec?: unknown };
  switch (error.code) {
    case 'PROVIDER_QUOTA_EXCEEDED': {
      const retry = typeof details.retryAfterSec === 'number' && details.retryAfterSec >= 0 ? Math.ceil(details.retryAfterSec) : null;
      return new ApiError(429, error.code, error.message, retry !== null ? { 'Retry-After': String(retry) } : {});
    }
    case 'PROVIDER_REJECTED':
    case 'INPUT_TOO_LONG':
    case 'ASSET_MISSING':
      return new ApiError(400, error.code, error.message);
    case 'MODEL_OUTPUT_INVALID':
    case 'PROVIDER_AUTH_FAILED':
    case 'PROVIDER_UNAVAILABLE':
    case 'REMOTE_NODE_REJECTED':
    case 'REMOTE_NODE_LOST':
      return new ApiError(502, error.code, error.message);
    case 'JOB_INTERRUPTED':
      return new ApiError(503, error.code, error.message);
    // 开始之前授权被撤销、自动重试时预算不够（§12.5、§7.8）。
    case 'GRANT_REVOKED':
    case 'GRANT_REQUIRED':
      return new ApiError(403, error.code, error.message);
    case 'BUDGET_EXCEEDED':
    case 'BUDGET_UNVERIFIABLE':
    case 'TASK_BUDGET_EXCEEDED':
    case 'TASK_BUDGET_UNVERIFIABLE':
      return new ApiError(409, error.code, error.message);
    default:
      return new ApiError(500, /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : 'INTERNAL', error.message);
  }
}
