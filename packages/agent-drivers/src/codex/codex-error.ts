import type { AgentErrorCode } from '@baocut/protocol';
import type { CodexErrorInfo, CodexTurnError } from './codex-protocol.ts';

/**
 * Codex 的回合错误 → `AgentErrorCode`（架构设计 §3.11）。先看结构化的 `codexErrorInfo`，它说不清时再按原文的关键词兜底。
 *
 * 结构化字段（对照 0.159.0 schema 与 codex 源码 `protocol/src/error.rs` 的 `to_codex_protocol_error`）：
 * - `unauthorized`（刷新令牌失败）→ 要重新登录。
 * - `usageLimitExceeded`（用量、额度、套餐不含）、`rateLimitExceeded` → 限流或额度用尽。
 * - 带 HTTP 状态的变体：401 → 要重新登录，429 → 限流。
 * - `serverOverloaded`（"Selected model is at capacity. Please try a different model."）→ 模型暂时不可用，换个模型就能继续。
 * - `other`、`badRequest`、`internalServerError`、没带状态的连接错误、或者干脆没有结构化字段：看原文。
 *   上游的「模型不存在」（HTTP 404 `Model not found ...`）与旧 CLI 不认识新模型都落在这里。
 * - 其余（上下文超长、预算、沙箱、内容策略……）不是这几类，给 null，界面只显示原文。
 */
export function classifyCodexError(error: Pick<CodexTurnError, 'message' | 'codexErrorInfo' | 'additionalDetails'>): AgentErrorCode | null {
  const info = error.codexErrorInfo ?? null;
  const structured = classifyInfo(info);
  if (structured !== undefined) return structured;
  return classifyCodexErrorText([error.message, error.additionalDetails ?? ''].join('\n'));
}

/** undefined = 结构化字段说不清，交给原文判断。 */
function classifyInfo(info: CodexErrorInfo | null): AgentErrorCode | null | undefined {
  if (info === null) return undefined;
  if (typeof info === 'string') {
    switch (info) {
      case 'unauthorized':
        return 'AGENT_AUTH_REQUIRED';
      case 'usageLimitExceeded':
      case 'rateLimitExceeded':
        return 'AGENT_RATE_LIMITED';
      case 'serverOverloaded':
        return 'AGENT_MODEL_UNAVAILABLE';
      case 'other':
      case 'badRequest':
      case 'internalServerError':
        return undefined;
      default:
        return null;
    }
  }
  if ('activeTurnNotSteerable' in info) return null;
  const status = Object.values(info)[0]?.httpStatusCode ?? null;
  if (status === 401) return 'AGENT_AUTH_REQUIRED';
  if (status === 429) return 'AGENT_RATE_LIMITED';
  return undefined;
}

/**
 * 原文兜底的词表。账号一类与设计稿 `designs/baocut/app/model-agent-setup.js` 的 `AUTH_NEEDLES` 一致
 * （内核 `agent_setup::auth_failure` 同一张表）：只认明确指向账号的说法，`auth` 词根、denied、forbidden 不收。
 * 模型一类含设计稿的 `MODEL_GATE_NEEDLES`（旧 CLI 不认识配置里的新模型）。
 */
const MODEL_NEEDLES = [
  'requires a newer version of codex',
  'is not supported when using codex',
  'model not found',
  'model_not_found',
  'unknown model',
  'model does not exist',
];
const AUTH_NEEDLES = [
  'oauth',
  'authenticate',
  'authentication',
  'unauthorized',
  'not logged in',
  'not signed in',
  'log in',
  'login',
  'sign in',
  'signed out',
  'session expired',
  'token expired',
  'expired token',
  'invalid token',
  'credential',
  'api key',
  'apikey',
];
const RATE_NEEDLES = ['rate limit', 'rate_limit', 'ratelimit', 'usage limit', 'too many requests', 'quota', 'insufficient_quota'];

/** 只看原文的分类。模型一类先判：「不支持用 ChatGPT 账号使用这个模型」里的 account 不是登录问题。 */
export function classifyCodexErrorText(text: string): AgentErrorCode | null {
  const t = text.toLowerCase();
  if (MODEL_NEEDLES.some((n) => t.includes(n))) return 'AGENT_MODEL_UNAVAILABLE';
  if (AUTH_NEEDLES.some((n) => t.includes(n)) || /\b401\b/.test(t)) return 'AGENT_AUTH_REQUIRED';
  if (RATE_NEEDLES.some((n) => t.includes(n)) || /\b429\b/.test(t)) return 'AGENT_RATE_LIMITED';
  return null;
}
