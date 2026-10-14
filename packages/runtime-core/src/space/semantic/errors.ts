import { RpcError, SEMANTIC_REASONS, type RpcErrorCode, type SemanticChannel, type SemanticReason } from '@baocut/protocol';
import { EmbeddingError } from '@baocut/models';
import { RcSemantic } from '@baocut/protocol/messages/runtime-core';

/**
 * 语义检索的标准错误（EmbeddingGemma 2 检索集成方案 v0.1 §11.5）：`RpcError`，原因码放在 `details.reason`（稳定的英文标识），
 * 文字走消息目录。调用方（界面、智能体、CLI）按原因码分支，不解析文字。
 */

const CODES: Record<SemanticReason, RpcErrorCode> = {
  MODEL_NOT_INSTALLED: 'unsupported',
  MODEL_UNAVAILABLE: 'internal',
  PROFILE_INCOMPATIBLE: 'unsupported',
  INPUT_TOO_LONG: 'invalid-request',
  SOURCE_MISSING: 'not-found',
  INDEX_NOT_READY: 'unsupported',
  INDEX_PARTIAL: 'unsupported',
  STALE_REVISION: 'conflict',
  CURSOR_STALE: 'conflict',
  SEARCH_CANCELLED: 'busy',
  RESOURCE_EXHAUSTED: 'busy',
  APPEARANCE_UNAVAILABLE: 'unsupported',
  CHANNEL_UNAVAILABLE: 'unsupported',
};

export function semanticMessage(reason: SemanticReason, params: { max?: number } = {}) {
  switch (reason) {
    case 'MODEL_NOT_INSTALLED':
      return RcSemantic.modelNotInstalled();
    case 'MODEL_UNAVAILABLE':
      return RcSemantic.modelUnavailable();
    case 'PROFILE_INCOMPATIBLE':
      return RcSemantic.profileIncompatible();
    case 'INPUT_TOO_LONG':
      return RcSemantic.inputTooLong({ max: params.max ?? 0 });
    case 'SOURCE_MISSING':
      return RcSemantic.sourceMissing();
    case 'INDEX_NOT_READY':
      return RcSemantic.indexNotReady();
    case 'INDEX_PARTIAL':
      return RcSemantic.indexPartial();
    case 'STALE_REVISION':
      return RcSemantic.staleRevision();
    case 'CURSOR_STALE':
      return RcSemantic.cursorStale();
    case 'SEARCH_CANCELLED':
      return RcSemantic.searchCancelled();
    case 'RESOURCE_EXHAUSTED':
      return RcSemantic.resourceExhausted();
    case 'APPEARANCE_UNAVAILABLE':
      return RcSemantic.appearanceUnavailable();
    case 'CHANNEL_UNAVAILABLE':
      return RcSemantic.channelUnavailable();
  }
}

/** `channel`：只在某一路通道不可用时给（例如只装了文字模型包时请求画面：`MODEL_NOT_INSTALLED` + `channel: 'visual'`）。 */
export function semanticError(reason: SemanticReason, params: { max?: number; channel?: SemanticChannel } = {}): RpcError {
  return new RpcError(CODES[reason], semanticMessage(reason, params), {
    reason,
    ...(params.max !== undefined ? { max: params.max } : {}),
    ...(params.channel ? { channel: params.channel } : {}),
  });
}

/** Provider 抛的错误换成原因码；不认识的算模型不可用。 */
export function reasonOf(error: unknown): SemanticReason {
  if (error instanceof EmbeddingError && (SEMANTIC_REASONS as readonly string[]).includes(error.reason)) return error.reason as SemanticReason;
  if (error instanceof RpcError) {
    const reason = (error.details as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === 'string' && (SEMANTIC_REASONS as readonly string[]).includes(reason)) return reason as SemanticReason;
  }
  if (error instanceof Error && error.name === 'AbortError') return 'SEARCH_CANCELLED';
  return 'MODEL_UNAVAILABLE';
}
