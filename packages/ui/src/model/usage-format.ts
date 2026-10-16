import { intlLocale, type Money, type UsageUnits } from '@baocut/protocol';

/**
 * 用量页与 API 提供方详情的用量卡（产品设计 §7.6；设计稿 model-usage.js `fmtMoney` / `fmtCount`）：金额按币种分开写、不换算；
 * 大数按界面语言缩写（1.2K、1.2万）。只算，不带文案。
 */

const SYMBOL: Readonly<Record<string, string>> = { USD: '$', CNY: '¥' };

/** 一种币种的金额：「$1.23」「¥0.40」，不到一分写「<$0.01」；认不出的币种写「EUR 1.23」。 */
export function formatMoneyOne(money: Money): string {
  const symbol = SYMBOL[money.currency] ?? `${money.currency} `;
  const amount = Number(money.amount);
  if (!Number.isFinite(amount)) return `${symbol}${money.amount}`;
  if (amount > 0 && amount < 0.01) return `<${symbol}0.01`;
  return `${symbol}${amount.toFixed(2)}`;
}

/** 几种币种用「 + 」连起来；没有金额时为空串。 */
export function formatMoney(list: readonly Money[] | null | undefined): string {
  return (list ?? []).map(formatMoneyOne).join(' + ');
}

/** 大数缩写（按界面语言：1.2K / 1.2万）；没有时 0。 */
export function formatCount(n: number | null | undefined): string {
  return new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n ?? 0);
}

/** 文本 token：入 + 出。 */
export const tokenTotal = (units: UsageUnits) => (units.inputTokens ?? 0) + (units.outputTokens ?? 0);

/** 份额条的宽度：占全部调用的百分比（0–100），有调用时至少 1.5，细到看不见的也留一点。 */
export function shareWidth(calls: number, total: number): number {
  if (total <= 0 || calls <= 0) return 0;
  return Math.max(1.5, Math.round((calls / total) * 1000) / 10);
}

/** 份额（占全部调用的百分比，四舍五入）。 */
export function sharePercent(calls: number, total: number): number {
  return total > 0 ? Math.round((calls / total) * 100) : 0;
}
