import { describe, expect, it } from 'vitest';
import type { Segment } from './worker-contract.ts';
import { estimateWords, fixWordTimes, secondsToTicks, splitIntoWordPairs } from './word-timing.ts';

/** 与 Rust 端 `word_timing.rs`、`text_prep.rs` 的测试同样的用例，加上 TS 侧的边界。 */

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('estimateWords', () => {
  it('按字符长度插值，标点贴在前一个词上，最后一个词结束于段尾', () => {
    const words = estimateWords('ab abcd, ab', 'en', 1.0, 2.6);
    expect(words.map((w) => w.text)).toEqual(['ab', 'abcd,', 'ab']);
    expect(close(words[0]!.start, 1.0) && close(words[0]!.end, 1.4)).toBe(true);
    expect(close(words[1]!.start, 1.4) && close(words[1]!.end, 2.2)).toBe(true);
    expect(words[2]).toEqual({ text: 'ab', start: words[1]!.end, end: 2.6 });
  });

  it('汉字逐字成词，句末标点贴在最后一个字上', () => {
    const words = estimateWords('你好。', 'zh', 0, 1);
    expect(words.map((w) => w.text)).toEqual(['你', '好。']);
    expect(words[1]!.end).toBe(1);
  });

  it('退化的输入：空白没有词；只有标点时整段算一个词；倒挂的段收成一点', () => {
    expect(estimateWords('   ', null, 0, 1)).toEqual([]);
    expect(estimateWords('?!', null, 0.5, 0.75)).toEqual([{ text: '?!', start: 0.5, end: 0.75 }]);
    const collapsed = estimateWords('a b', null, 2, 1);
    expect(collapsed.every((w) => w.start === 2 && w.end === 2)).toBe(true);
  });

  it('独立的标点并到前一个词；撇号算字母', () => {
    expect(splitIntoWordPairs("don't — stop", 'en')).toEqual([
      { surface: "don't—", cleaned: "don't" },
      { surface: 'stop', cleaned: 'stop' },
    ]);
  });

  it('中英混排：汉字前的非汉字前缀并入汉字，汉字后的拉丁字母单独成词', () => {
    expect(splitIntoWordPairs('“你好AI', 'zh')).toEqual([
      { surface: '“你', cleaned: '你' },
      { surface: '好', cleaned: '好' },
      { surface: 'AI', cleaned: 'AI' },
    ]);
  });

  it('日文走词典分词（语言给出或按假名判断），尾随标点贴在词上', () => {
    const byLanguage = splitIntoWordPairs('今日は晴れ。', 'ja');
    const byScript = splitIntoWordPairs('今日は晴れ。', null);
    expect(byLanguage).toEqual(byScript);
    expect(byLanguage.length).toBeGreaterThan(1);
    expect(byLanguage.at(-1)!.surface.endsWith('。')).toBe(true);
    expect(byLanguage.map((p) => p.cleaned).join('')).toBe('今日は晴れ');
  });
});

describe('fixWordTimes', () => {
  const segment = (words: Segment['words']): Segment => ({ id: 's', start: 100, end: 200, text: 'x', speakerId: null, words });

  it('越段、倒挂与重叠的词收进段内并保持单调，报告改动过', () => {
    const s = segment([
      { start: 90, end: 120, text: 'a', confidence: null, timingQuality: 'provider' },
      { start: 110, end: 105, text: 'b', confidence: null, timingQuality: 'provider' },
      { start: 150, end: 260, text: 'c', confidence: null, timingQuality: 'provider' },
      { start: 170, end: 180, text: 'd', confidence: null, timingQuality: 'missing' },
    ]);
    expect(fixWordTimes(s)).toBe(true);
    expect(s.words.map((w) => [w.start, w.end])).toEqual([
      [100, 120],
      [120, 120],
      [150, 200],
      [100, 100],
    ]);
    expect(s.words[0]!.timingQuality).toBe('provider');
  });

  it('本来就合法的词不改', () => {
    const s = segment([{ start: 100, end: 150, text: 'a', confidence: null, timingQuality: 'estimated' }]);
    expect(fixWordTimes(s)).toBe(false);
  });
});

describe('secondsToTicks', () => {
  it('四舍五入；负数与非有限值为 0', () => {
    expect(secondsToTicks(1.2345678, 1_000_000)).toBe(1_234_568);
    expect(secondsToTicks(-1, 1000)).toBe(0);
    expect(secondsToTicks(Number.NaN, 1000)).toBe(0);
    expect(secondsToTicks(Number.POSITIVE_INFINITY, 1000)).toBe(0);
  });
});
