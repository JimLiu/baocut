import { describe, expect, it } from 'vitest';
import { compileFind, findRanges, replaceRanges, stepIndex } from './text-find.ts';

const plain = { matchCase: false, wholeWord: false, regex: false };
const ranges = (text: string, query: string, options = plain) => {
  const { re } = compileFind(query, options);
  return re ? findRanges(text, re, options.wholeWord) : [];
};

describe('查找与替换', () => {
  it('默认不分大小写，特殊字符按字面', () => {
    expect(ranges('Cat cat CAT', 'cat')).toHaveLength(3);
    expect(ranges('Cat cat CAT', 'cat', { ...plain, matchCase: true })).toEqual([{ start: 4, end: 7 }]);
    expect(ranges('a.b axb', 'a.b')).toEqual([{ start: 0, end: 3 }]);
  });

  it('全词按 Unicode 边界；正则写错了报出来', () => {
    expect(ranges('cat category cat', 'cat', { ...plain, wholeWord: true })).toEqual([
      { start: 0, end: 3 },
      { start: 13, end: 16 },
    ]);
    expect(ranges('a1 b22', '\\d+', { ...plain, regex: true })).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 6 },
    ]);
    expect(compileFind('(', { ...plain, regex: true }).error).toBeTruthy();
    expect(compileFind('', plain)).toEqual({});
  });

  it('从后往前替换，换成原样的不算', () => {
    expect(replaceRanges('苏黎和苏黎', ranges('苏黎和苏黎', '苏黎'), '苏黎老师')).toEqual({ text: '苏黎老师和苏黎老师', changed: 2 });
    expect(replaceRanges('ab', [{ start: 0, end: 1 }], 'a').changed).toBe(0);
    expect([stepIndex(2, 3, 1), stepIndex(0, 3, -1), stepIndex(5, 0, 1)]).toEqual([0, 2, 0]);
  });
});
