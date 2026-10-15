import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { formatCount, formatMoney, formatMoneyOne, sharePercent, shareWidth, tokenTotal } from './usage-format.ts';

// 测试默认是中文界面。
afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('用量的格式', () => {
  it('金额按币种写符号，不到一分写 <$0.01，几种币种用 + 连起来', () => {
    expect(formatMoneyOne({ amount: '1.234', currency: 'USD' })).toBe('$1.23');
    expect(formatMoneyOne({ amount: '0.004', currency: 'USD' })).toBe('<$0.01');
    expect(formatMoneyOne({ amount: '0', currency: 'CNY' })).toBe('¥0.00');
    expect(formatMoneyOne({ amount: '2', currency: 'EUR' })).toBe('EUR 2.00');
    expect(formatMoney([{ amount: '1.5', currency: 'USD' }, { amount: '3', currency: 'CNY' }])).toBe('$1.50 + ¥3.00');
    expect(formatMoney([])).toBe('');
    expect(formatMoney(null)).toBe('');
  });

  it('大数按界面语言缩写', () => {
    expect(formatCount(12_345)).toBe('1.2万');
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234)).toBe('1.2K');
    expect(formatCount(undefined)).toBe('0');
  });

  it('token 合计与份额', () => {
    expect(tokenTotal({ inputTokens: 10, outputTokens: 5 })).toBe(15);
    expect(tokenTotal({})).toBe(0);
    expect(shareWidth(5, 10)).toBe(50);
    expect(shareWidth(5, 0)).toBe(0);
    expect(sharePercent(1, 3)).toBe(33);
  });
});
