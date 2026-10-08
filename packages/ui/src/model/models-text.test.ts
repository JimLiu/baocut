import { describe, expect, it } from 'vitest';
import { fixtureView, textModel, textView } from './models-test-fixtures.ts';
import {
  CONCURRENCY_MAX,
  EFFORT_CHOICES,
  clampConcurrency,
  concurrencyRequest,
  effortKey,
  effortModelCount,
  effortOfKey,
  effortRequest,
  textModelLine,
  textParameters,
  tokensShort,
} from './models-text.ts';

describe('推理强度', () => {
  it('五档：自动（null）与 Runtime 的四档', () => {
    expect(EFFORT_CHOICES.map((c) => [c.key, c.label])).toEqual([
      ['auto', '自动'],
      ['minimal', '最低'],
      ['low', '低'],
      ['medium', '中'],
      ['high', '高'],
    ]);
    expect(effortKey(null)).toBe('auto');
    expect(effortKey('high')).toBe('high');
    expect(effortOfKey('auto')).toBeNull();
    expect(effortOfKey('medium')).toBe('medium');
    expect(effortOfKey('max')).toBeNull();
  });

  it('请求：自动交 null', () => {
    expect(effortRequest('auto')).toEqual({ capability: 'generateText', effort: null });
    expect(effortRequest('low')).toEqual({ capability: 'generateText', effort: 'low' });
  });

  it('已连接的模型里能调推理强度的有几只', () => {
    expect(effortModelCount(textView())).toEqual({ tunable: 1, total: 2 });
    expect(effortModelCount(fixtureView())).toEqual({ tunable: 0, total: 0 });
  });
});

describe('并发上限', () => {
  it('夹在 1–32，取整；不是数时不提交', () => {
    expect(CONCURRENCY_MAX).toBe(32);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(40)).toBe(32);
    expect(clampConcurrency(6.6)).toBe(7);
    expect(clampConcurrency(Number.NaN)).toBeNull();
    expect(concurrencyRequest(8)).toEqual({ capability: 'generateText', concurrency: 8 });
    expect(concurrencyRequest(Number.NaN)).toBeNull();
  });

  it('视图没给参数时用出厂值', () => {
    expect(textParameters(textView({ effort: 'low', concurrency: 2 }))).toEqual({ effort: 'low', concurrency: 2 });
    expect(textParameters(textView(null))).toEqual({ effort: null, concurrency: 4 });
  });
});

describe('模型一行', () => {
  it('token 数写短', () => {
    expect(tokensShort(128_000)).toBe('128K');
    expect(tokensShort(32_768)).toBe('32K');
    expect(tokensShort(1_048_576)).toBe('1M');
    expect(tokensShort(400_000)).toBe('400K');
    expect(tokensShort(512)).toBe('512');
  });

  it('上下文、单次输出、推理强度', () => {
    expect(textModelLine(textModel('gpt-5-mini', { efforts: ['low', 'medium', 'high'], contextTokens: 400_000, maxOutputTokens: 128_000 }))).toBe(
      '上下文 400K · 单次输出 128K · 推理强度 低 / 中 / 高',
    );
    expect(textModelLine(textModel('x', { contextTokens: 32_768, maxOutputTokens: 4096 }))).toBe('上下文 32K · 单次输出 4K · 不能调推理强度');
    expect(textModelLine(textModel('y', { notes: '自建', contextTokens: 32_768, maxOutputTokens: 4096 }))).toBe('自建 · 上下文 32K · 单次输出 4K · 不能调推理强度');
  });
});
