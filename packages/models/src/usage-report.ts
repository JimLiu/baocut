import {
  microsToMoney,
  moneyToMicros,
  type Money,
  type ModelServiceCapability,
  type UsageCostKind,
  type UsagePeriod,
  type UsageRecord,
  type UsageReport,
  type UsageRow,
  type UsageUnits,
} from '@baocut/protocol';
import { ModelsUsageReport as M } from '@baocut/protocol/messages/models/usage-report.ts';
import { CAPABILITY_LABELS } from './model-selection.ts';
import { modelPrice, type ModelUnitPrice } from './model-prices.ts';

/**
 * `models.usage` 的汇总（架构设计 §6.10），纯函数：读出的账本记录 → `UsageReport`。
 *
 * - 时段按 Runtime 所在机器的本地日期：`today` 从今天零点起，`7d` / `30d` 是含今天在内的最近 7 / 30 天，`all` 不限
 *   （`from` 是最早一条记录的时间，没有记录时同 `to`）。
 * - 金额：一条记录有供应商报告的金额就用它；否则价目表（`model-prices.ts`）有这个模型的单价、所需的用量也齐全时估算；
 *   否则是未知，计入 `unknownCalls`。验证密钥（`source: 'verify'`）不计费用，也不算未知。不同币种分别汇总，不换算。
 * - 金额用百万分之一的整数（bigint）累加，最后才转回十进制字符串。
 */

export interface UsageReportOptions {
  period: UsagePeriod;
  providerId?: string;
  now?: Date;
  /** 价目表（测试替换）；默认 `model-prices.ts`。 */
  price?: (providerId: string, modelId: string) => ModelUnitPrice | null;
  /** Provider 的显示名；不给时用 `providerId`。 */
  providerLabel?: (providerId: string) => string;
  /** 账号的显示名（名字，没有时掩码）；账号已经删掉时 null，按 `accountId` 列出。 */
  accountLabel?: (providerId: string, accountId: string) => string | null;
}

type Micros = Map<string, bigint>;

interface Acc {
  key: string;
  label: string;
  providerId?: string;
  calls: number;
  failed: number;
  units: UsageUnits;
  reported: Micros;
  estimated: Micros;
}

const UNIT_KEYS = ['inputTokens', 'outputTokens', 'cachedTokens', 'audioSeconds', 'chars', 'images'] as const;

export function buildUsageReport(records: readonly UsageRecord[], options: UsageReportOptions): UsageReport {
  const now = options.now ?? new Date();
  const price = options.price ?? modelPrice;
  const providerLabel = options.providerLabel ?? ((id: string) => id);
  const from = periodStart(options.period, now);
  const selected = records.filter((r) => {
    const at = Date.parse(r.at);
    return (from === null || at >= from.getTime()) && at <= now.getTime() && (!options.providerId || r.providerId === options.providerId);
  });

  const totals = newAcc('total', '');
  let unknownCalls = 0;
  const byProvider = new Map<string, Acc>();
  const byCapability = new Map<string, Acc>();
  const byModel = new Map<string, Acc>();
  const byAccount = new Map<string, Acc>();
  const byDay = new Map<string, { day: string; calls: number; units: UsageUnits; byCapability: Partial<Record<ModelServiceCapability, number>> }>();
  if (from !== null) for (let d = new Date(from); d.getTime() <= now.getTime(); d = nextDay(d)) byDay.set(localDay(d), emptyDay(localDay(d)));

  for (const record of selected) {
    const cost = costOf(record, price);
    if (cost === 'unknown') unknownCalls++;
    const targets = [totals, rowOf(byProvider, record.providerId, () => ({ label: providerLabel(record.providerId) }))];
    if (record.capability) targets.push(rowOf(byCapability, record.capability, () => ({ label: CAPABILITY_LABELS[record.capability!] })));
    if (record.modelId) {
      targets.push(
        rowOf(byModel, `${record.providerId}/${record.modelId}`, () => ({ label: record.modelId!, providerId: record.providerId })),
      );
    }
    const accountKey = `${record.providerId}/${record.accountId ?? ''}`;
    targets.push(
      rowOf(byAccount, accountKey, () => ({
        label:
          record.accountId === null
            ? M.noAccount({ provider: providerLabel(record.providerId) }).text
            : (options.accountLabel?.(record.providerId, record.accountId) ?? record.accountId),
        providerId: record.providerId,
      })),
    );
    for (const acc of targets) add(acc, record, cost);

    const dayKey = localDay(new Date(record.at));
    const day = byDay.get(dayKey) ?? emptyDay(dayKey);
    byDay.set(dayKey, day);
    day.calls++;
    addUnits(day.units, record.units);
    if (record.capability) day.byCapability[record.capability] = (day.byCapability[record.capability] ?? 0) + 1;
  }

  const earliest = selected.reduce<number | null>((min, r) => {
    const at = Date.parse(r.at);
    return min === null || at < min ? at : min;
  }, null);
  return {
    period: { from: (from ?? (earliest === null ? now : new Date(earliest))).toISOString(), to: now.toISOString() },
    totals: {
      calls: totals.calls,
      failed: totals.failed,
      units: totals.units,
      cost: { estimated: moneyList(totals.estimated), reported: moneyList(totals.reported), unknownCalls },
    },
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProvider: rows(byProvider),
    byCapability: rows(byCapability),
    byModel: rows(byModel),
    byAccount: rows(byAccount),
  };
}

/** 时段的起点（本地零点）；`all` 为 null。 */
export function periodStart(period: UsagePeriod, now: Date): Date | null {
  if (period === 'all') return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = period === 'today' ? 0 : period === '7d' ? 6 : 29;
  start.setDate(start.getDate() - back);
  return start;
}

type RecordCost = { kind: 'reported' | 'estimated'; currency: string; micros: bigint } | 'unknown' | 'none';

/** 一条记录的金额：报告的、估算的、未知，或不计（验证）。 */
export function costOf(record: UsageRecord, price: (providerId: string, modelId: string) => ModelUnitPrice | null): RecordCost {
  if (record.cost.kind === 'reported') {
    return { kind: 'reported', currency: record.cost.currency, micros: moneyToMicros(record.cost.amount) };
  }
  if (record.source === 'verify') return 'none';
  if (!record.capability || !record.modelId) return 'unknown';
  const unit = price(record.providerId, record.modelId);
  if (!unit) return 'unknown';
  const micros = estimateMicros(record.capability, record.units, unit);
  return micros === null ? 'unknown' : { kind: 'estimated', currency: unit.currency, micros };
}

/** 按单价估算（百万分之一）；所需的用量或单价缺一样就是 null。 */
function estimateMicros(capability: ModelServiceCapability, units: UsageUnits, unit: ModelUnitPrice): bigint | null {
  const p = (value: string | undefined) => (value === undefined ? null : moneyToMicros(value));
  switch (capability) {
    case 'generateText': {
      const input = p(unit.inputPerMTok);
      const output = p(unit.outputPerMTok);
      if (input === null || output === null || units.inputTokens === undefined || units.outputTokens === undefined) return null;
      const cached = Math.min(units.cachedTokens ?? 0, units.inputTokens);
      const cachedPrice = p(unit.cachedPerMTok) ?? input;
      const total =
        BigInt(Math.round(units.inputTokens - cached)) * input +
        BigInt(Math.round(cached)) * cachedPrice +
        BigInt(Math.round(units.outputTokens)) * output;
      return divRound(total, 1_000_000n);
    }
    case 'transcribe': {
      const perMinute = p(unit.audioPerMinute);
      if (perMinute === null || units.audioSeconds === undefined) return null;
      // 按毫秒算，避免浮点的秒数。
      return divRound(BigInt(Math.round(units.audioSeconds * 1000)) * perMinute, 60_000n);
    }
    case 'synthesizeSpeech': {
      const per1k = p(unit.per1kChars);
      if (per1k === null || units.chars === undefined) return null;
      return divRound(BigInt(Math.round(units.chars)) * per1k, 1000n);
    }
    case 'generateImage': {
      const perImage = p(unit.perImage);
      if (perImage === null || units.images === undefined) return null;
      return BigInt(Math.round(units.images)) * perImage;
    }
    default:
      return null;
  }
}

function divRound(value: bigint, by: bigint): bigint {
  return (value + by / 2n) / by;
}

function newAcc(key: string, label: string, providerId?: string): Acc {
  return { key, label, ...(providerId ? { providerId } : {}), calls: 0, failed: 0, units: {}, reported: new Map(), estimated: new Map() };
}

function rowOf(map: Map<string, Acc>, key: string, init: () => { label: string; providerId?: string }): Acc {
  let acc = map.get(key);
  if (!acc) {
    const { label, providerId } = init();
    acc = newAcc(key, label, providerId);
    map.set(key, acc);
  }
  return acc;
}

function add(acc: Acc, record: UsageRecord, cost: RecordCost): void {
  acc.calls++;
  if (record.status === 'error') acc.failed++;
  addUnits(acc.units, record.units);
  if (typeof cost === 'object') {
    const bucket = cost.kind === 'reported' ? acc.reported : acc.estimated;
    bucket.set(cost.currency, (bucket.get(cost.currency) ?? 0n) + cost.micros);
  }
}

function addUnits(into: UsageUnits, units: UsageUnits): void {
  for (const key of UNIT_KEYS) {
    const n = units[key];
    if (n !== undefined) into[key] = roundUnit((into[key] ?? 0) + n);
  }
}

/** 秒数相加的浮点误差收在毫秒。 */
function roundUnit(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function moneyList(micros: Micros): Money[] {
  return [...micros]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => ({ amount: microsToMoney(value), currency }));
}

function rows(map: Map<string, Acc>): UsageRow[] {
  return [...map.values()]
    .map((acc) => {
      const merged: Micros = new Map(acc.reported);
      for (const [currency, value] of acc.estimated) merged.set(currency, (merged.get(currency) ?? 0n) + value);
      const costKind: UsageCostKind =
        acc.reported.size > 0 && acc.estimated.size > 0
          ? 'mixed'
          : acc.reported.size > 0
            ? 'reported'
            : acc.estimated.size > 0
              ? 'estimated'
              : 'unknown';
      return {
        key: acc.key,
        label: acc.label,
        ...(acc.providerId ? { providerId: acc.providerId } : {}),
        calls: acc.calls,
        failed: acc.failed,
        units: acc.units,
        cost: moneyList(merged),
        costKind,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key));
}

function emptyDay(day: string): UsageReport['byDay'][number] {
  return { day, calls: 0, units: {}, byCapability: {} };
}

function nextDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
}

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

