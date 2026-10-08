import type { Money } from './grants.ts';
import type { ModelServiceCapability } from './models.ts';

/**
 * 用量账本（架构设计 §6.10）：在线 Provider 的每次真实调用结束时追加一条到 `<home>/store/usage.jsonl`（0600）。
 * 账本只记事实：用量与供应商报告的金额；按标价的估算在读的时候算（`models.usage`），不写进账本。
 * 本机与节点的计算不记。
 */

/** 一次调用的用量。`cachedTokens` 是 `inputTokens` 的一部分。 */
export interface UsageUnits {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  audioSeconds?: number;
  chars?: number;
  images?: number;
}

/** 调用从哪里来：任务、进程内（流程里的翻译等）、智能体的工具、连通性测试。 */
export type UsageSource = 'job' | 'inline' | 'agent-tool' | 'verify';

/** 金额：供应商在响应里报告的才写 `reported`，否则 `unknown`。 */
export type UsageRecordCost = { kind: 'reported'; amount: string; currency: 'USD' | 'CNY' } | { kind: 'unknown' };

export interface UsageRecord {
  /** ISO 8601。 */
  at: string;
  providerId: string;
  /** 用的哪个账号；智能体 Provider、没有密钥的自定义端点与账号还没保存的验证为 null。 */
  accountId: string | null;
  /** 只有验证密钥（`source: 'verify'`）为 null。 */
  capability: ModelServiceCapability | null;
  /** 只有验证密钥（`source: 'verify'`）为 null。 */
  modelId: string | null;
  source: UsageSource;
  ref?: { jobId?: string; taskId?: string; conversationId?: string };
  units: UsageUnits;
  cost: UsageRecordCost;
  durationMs: number;
  status: 'ok' | 'error';
  /** 失败的原因（不含密钥）。 */
  error?: string;
}

export const USAGE_PERIODS = ['today', '7d', '30d', 'all'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

/**
 * 一行的金额从哪里来（§6.10）：
 * - `reported`：算得出的金额全部是供应商报告的；
 * - `estimated`：全部是按价目表（`model-prices`）估算的；
 * - `mixed`：两者都有；
 * - `unknown`：一个都没有。
 */
export type UsageCostKind = 'reported' | 'estimated' | 'mixed' | 'unknown';

export interface UsageRow {
  key: string;
  label: string;
  providerId?: string;
  calls: number;
  failed: number;
  units: UsageUnits;
  /** 报告与估算的合计，按币种一种一项（不换算）；没有可计的金额时为空。 */
  cost: Money[];
  costKind: UsageCostKind;
}

/**
 * `models.usage` 的结果（架构设计 §6.10）。金额分「服务商报告」「按标价估算」「未知」三种，不合成一个数；不同币种
 * 分别汇总，不换算（`Money[]` 一种币种一项，没有时为空）。
 */
export interface UsageReport {
  /** `all` 时 `from` 是最早一条记录的时间（没有记录时同 `to`）。 */
  period: { from: string; to: string };
  totals: {
    calls: number;
    failed: number;
    units: UsageUnits;
    cost: { estimated: Money[]; reported: Money[]; unknownCalls: number };
  };
  /** 按本机日期（`YYYY-MM-DD`）。 */
  byDay: Array<{ day: string; calls: number; units: UsageUnits; byCapability: Partial<Record<ModelServiceCapability, number>> }>;
  byProvider: UsageRow[];
  byCapability: UsageRow[];
  byModel: UsageRow[];
  byAccount: UsageRow[];
}

export interface UsageRequest {
  period: UsagePeriod;
  providerId?: string;
}
