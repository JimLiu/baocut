import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '@baocut/protocol';
import type { ModelUnitPrice } from './model-prices.ts';
import { buildUsageReport, periodStart } from './usage-report.ts';

// 本地时间 2026-10-06 12:00（报告按本机日期划分）。
const NOW = new Date(2026, 9, 6, 12, 0, 0);
const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 6 - daysAgo, hour, 0, 0).toISOString();

const PRICES: Record<string, ModelUnitPrice> = {
  'anthropic/claude-sonnet-5-5': { currency: 'USD', inputPerMTok: '2', outputPerMTok: '10', cachedPerMTok: '0.2' },
  'openai/whisper-1': { currency: 'USD', audioPerMinute: '0.006' },
  'qwen/qwen3.8-max': { currency: 'CNY', inputPerMTok: '2.4', outputPerMTok: '9.6' },
};
const price = (providerId: string, modelId: string) => PRICES[`${providerId}/${modelId}`] ?? null;

function rec(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    at: at(0),
    providerId: 'anthropic',
    accountId: 'main',
    capability: 'generateText',
    modelId: 'claude-sonnet-5-5',
    source: 'job',
    units: {},
    cost: { kind: 'unknown' },
    durationMs: 100,
    status: 'ok',
    ...overrides,
  };
}

const RECORDS: UsageRecord[] = [
  // 估算：(1,000,000 − 200,000) × 2 + 200,000 × 0.2 + 100,000 × 10 = 1.6 + 0.04 + 1.0 = 2.64 USD
  rec({ units: { inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 100_000 } }),
  // 报告的金额优先于估算。
  rec({ units: { inputTokens: 10, outputTokens: 10 }, cost: { kind: 'reported', amount: '0.5', currency: 'USD' }, accountId: 'b2' }),
  // 用量不全：未知。
  rec({ units: { inputTokens: 10 }, status: 'error', error: 'PROVIDER_REJECTED: x' }),
  // 转写：90 秒 × 0.006 / 60 = 0.009 USD；两天前。
  rec({ at: at(2), providerId: 'openai', capability: 'transcribe', modelId: 'whisper-1', units: { audioSeconds: 90 } }),
  // 别的币种分开汇总：1,000,000 × 2.4 / 1e6 = 2.4 CNY；十天前。
  rec({ at: at(10), providerId: 'qwen', modelId: 'qwen3.8-max', accountId: 'gone', units: { inputTokens: 1_000_000, outputTokens: 0 } }),
  // 价目表里没有：未知。智能体 Provider 没有账号。
  rec({ at: at(1), providerId: 'agent:codex', accountId: null, capability: 'generateImage', modelId: 'codex-image', units: { images: 1 } }),
  // 验证：不计费用，也不算未知。
  rec({ source: 'verify', capability: null, modelId: null, accountId: null }),
  // 时段之外：40 天前。
  rec({ at: at(40), units: { inputTokens: 1, outputTokens: 1 } }),
];

describe('buildUsageReport', () => {
  it('时段按本机日期：today 从零点起，7d / 30d 含今天，all 从最早一条起', () => {
    expect(periodStart('today', NOW)).toEqual(new Date(2026, 9, 6));
    expect(periodStart('7d', NOW)).toEqual(new Date(2026, 8, 30));
    expect(periodStart('30d', NOW)).toEqual(new Date(2026, 8, 7));
    expect(periodStart('all', NOW)).toBeNull();
    const all = buildUsageReport(RECORDS, { period: 'all', now: NOW, price });
    expect(all.period).toEqual({ from: at(40), to: NOW.toISOString() });
    expect(all.totals.calls).toBe(8);
    expect(buildUsageReport([], { period: 'all', now: NOW }).period).toEqual({ from: NOW.toISOString(), to: NOW.toISOString() });
  });

  it('30 天：合计、三种金额分开、币种不换算、未知计数', () => {
    const report = buildUsageReport(RECORDS, { period: '30d', now: NOW, price });
    expect(report.totals).toEqual({
      calls: 7,
      failed: 1,
      units: { inputTokens: 2_000_020, cachedTokens: 200_000, outputTokens: 100_010, audioSeconds: 90, images: 1 },
      cost: {
        estimated: [
          { amount: '2.40', currency: 'CNY' },
          { amount: '2.649', currency: 'USD' },
        ],
        reported: [{ amount: '0.50', currency: 'USD' }],
        unknownCalls: 2,
      },
    });
    expect(report.byDay).toHaveLength(30);
    expect(report.byDay.at(-1)).toEqual({
      day: '2026-10-06',
      calls: 4,
      units: { inputTokens: 1_000_020, cachedTokens: 200_000, outputTokens: 100_010 },
      byCapability: { generateText: 3 },
    });
  });

  it('分组：服务商、能力、模型、账号；每行的金额来源', () => {
    const report = buildUsageReport(RECORDS, {
      period: '7d',
      now: NOW,
      price,
      providerLabel: (id) => ({ anthropic: 'Anthropic', openai: 'OpenAI' })[id] ?? id,
      accountLabel: (_providerId, accountId) => (accountId === 'main' ? 'sk-…1234' : null),
    });
    const anthropic = report.byProvider.find((r) => r.key === 'anthropic')!;
    expect(anthropic).toMatchObject({
      label: 'Anthropic',
      calls: 4,
      failed: 1,
      cost: [{ amount: '3.14', currency: 'USD' }],
      costKind: 'mixed',
    });
    expect(report.byProvider.find((r) => r.key === 'openai')).toMatchObject({
      costKind: 'estimated',
      cost: [{ amount: '0.009', currency: 'USD' }],
    });
    expect(report.byProvider.find((r) => r.key === 'agent:codex')).toMatchObject({ costKind: 'unknown', cost: [] });
    // 验证没有能力与模型：不进这两个分组。
    expect(report.byCapability.map((r) => [r.key, r.calls])).toEqual([
      ['generateText', 3],
      ['generateImage', 1],
      ['transcribe', 1],
    ]);
    expect(report.byModel.find((r) => r.key === 'anthropic/claude-sonnet-5-5')).toMatchObject({ label: 'claude-sonnet-5-5', calls: 3 });
    const accounts = Object.fromEntries(report.byAccount.map((r) => [r.key, r.label]));
    expect(accounts).toMatchObject({
      'anthropic/main': 'sk-…1234',
      'anthropic/b2': 'b2',
      'agent:codex/': 'agent:codex（无账号）',
    });
  });

  it('只看一家服务商；today 只有今天', () => {
    const report = buildUsageReport(RECORDS, { period: '30d', providerId: 'qwen', now: NOW, price });
    expect(report.totals).toMatchObject({
      calls: 1,
      cost: { estimated: [{ amount: '2.40', currency: 'CNY' }], reported: [], unknownCalls: 0 },
    });
    expect(buildUsageReport(RECORDS, { period: 'today', now: NOW, price }).totals.calls).toBe(4);
  });
});
