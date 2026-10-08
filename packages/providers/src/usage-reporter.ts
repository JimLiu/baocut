import { ProviderFailure } from '@baocut/models';
import type {
  ModelServiceCapability,
  ProviderAccountStatus,
  UsageRecord,
  UsageRecordCost,
  UsageSource,
  UsageUnits,
} from '@baocut/protocol';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

/**
 * 一次在线调用结束时的报告（架构设计 §6.8、§6.10）：执行者在调用结束处（成功或失败）交给来源，来源写一条用量记录，并按结果
 * 更新用的那个账号的状态。只报告真的向供应商发出了请求的调用：没启用、没密钥而没发出的，与取消的，都不报告。
 */
export interface CallReport {
  capability: ModelServiceCapability;
  modelId: string;
  source: UsageSource;
  ref?: UsageRecord['ref'];
  /** 用的哪个账号（执行时取密钥时定下的）；没有账号时 null。 */
  accountId: string | null;
  /** `Date.now()`，调用开始时。 */
  startedAt: number;
  units: UsageUnits;
  /** 供应商报告的金额；没有时不给（记为 `unknown`）。 */
  cost?: UsageRecordCost;
  /** 失败的原因；成功时不给。 */
  error?: unknown;
}

export type CallReporter = (report: CallReport) => void;

/**
 * 调用结果对应的账号状态（§6.8）：成功是 `ok`；认证失败是 `invalid-key`；额度用尽是 `quota-exhausted`；别的 429 是
 * `rate-limited`（`until` 由 `Retry-After` 推出）。其余的失败与密钥无关，返回 null：只更新最近使用时间，不改状态。
 */
export function accountStatusOf(error: unknown, at: string): ProviderAccountStatus | null {
  if (error === undefined) return { state: 'ok', at };
  if (!(error instanceof ProviderFailure)) return null;
  const code = error.details.code;
  const detail = error.message.slice(0, 200);
  if (code === 'PROVIDER_AUTH_FAILED') return { state: 'invalid-key', at, detail };
  if (code === 'PROVIDER_QUOTA_EXCEEDED') {
    if (error.details.reason === 'insufficient-quota') return { state: 'quota-exhausted', at, detail };
    const retryAfter = error.details.retryAfterSec;
    const until = typeof retryAfter === 'number' && retryAfter > 0 ? new Date(Date.parse(at) + retryAfter * 1000).toISOString() : null;
    return { state: 'rate-limited', at, ...(until ? { until } : {}), detail };
  }
  return null;
}

/** 写进账本的失败原因：错误码与一句说明（`ProviderFailure` 的文本已经去掉了密钥）。 */
export function usageErrorOf(error: unknown): string {
  if (error instanceof ProviderFailure) {
    const code = typeof error.details.code === 'string' ? error.details.code : error.kind;
    return `${code}: ${error.message}`.slice(0, 300);
  }
  return `PROVIDER_UNAVAILABLE: ${PH.requestIncomplete().text}`;
}
