import { describe, expect, it } from 'vitest';
import { diffPath, textDiff } from './unified-diff.ts';

describe('textDiff', () => {
  const file = diffPath('/w/a.txt', '/w');

  it('两头相同的行只留至多 3 行上下文，行号是旧、新两侧各自的', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
    const after = ['1', '2', '3', '4', '5', 'six', 'six-b', '7', '8', '9', '10'].join('\n');
    expect(textDiff(file, before, after)).toBe(
      ['--- a/a.txt', '+++ b/a.txt', '@@ -3,7 +3,8 @@', ' 3', ' 4', ' 5', '-6', '+six', '+six-b', ' 7', ' 8', ' 9'].join('\n'),
    );
  });

  it('删光与没有变化', () => {
    expect(textDiff(file, 'a\nb\n', '')).toBe(['--- a/a.txt', '+++ b/a.txt', '@@ -1,2 +0,0 @@', '-a', '-b'].join('\n'));
    expect(textDiff(file, 'same\n', 'same\n')).toBeNull();
  });

  it('工作目录之外的文件用原路径', () => {
    expect(diffPath('/elsewhere/b.txt', '/w')).toEqual({ a: '/elsewhere/b.txt', b: '/elsewhere/b.txt' });
  });
});
