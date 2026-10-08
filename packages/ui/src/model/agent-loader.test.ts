import { describe, expect, it } from 'vitest';
import { FALLBACK, ICONS, KINDS, THINKING, forKind } from './agent-loader.ts';

/** 真实的图形表：取不到（包没装）时跳过对照，其余断言照跑。 */
const table: Record<string, unknown> | null = await import('@react-spectrum/ai/loader').then(
  (m) => m as Record<string, unknown>,
  () => null,
);

const sequences = (): [string, readonly string[]][] => [['THINKING', THINKING], ['FALLBACK', FALLBACK], ...Object.entries(KINDS)];

describe('agent-loader', () => {
  it('只用图案类图形，不用字母类图形', () => {
    const icons = new Set<string>(ICONS);
    expect(icons.size).toBe(ICONS.length);
    for (const [key, names] of sequences()) {
      expect(names.length, key).toBeGreaterThan(0);
      for (const name of names) {
        expect(icons.has(name), `${key}: ${name}`).toBe(true);
        expect(name.startsWith('adobe'), `${key}: ${name}`).toBe(false);
      }
    }
  });

  it('通用序列用到全部图形、各一次，aiLogo 打头', () => {
    expect([...THINKING].sort()).toEqual([...ICONS].sort());
    expect(THINKING[0]).toBe('aiLogo');
  });

  it('每个图形都至少用在一个类别里', () => {
    const used = new Set<string>([...FALLBACK, ...Object.values(KINDS).flat()]);
    expect(ICONS.filter((name) => !used.has(name))).toEqual([]);
  });

  it('同一个类别每次返回同一个数组；认不出的类别走 FALLBACK', () => {
    for (const kind of Object.keys(KINDS)) expect(forKind(kind)).toBe(forKind(kind));
    expect(forKind('transcribe')).toBe(KINDS.transcribe);
    expect(forKind('no-such-kind')).toBe(FALLBACK);
    expect(forKind('toString')).toBe(FALLBACK);
    expect(forKind('other')).toBe(FALLBACK);
    expect(Object.isFrozen(KINDS.cut)).toBe(true);
  });

  describe.skipIf(!table)('与 @react-spectrum/ai/loader 对照', () => {
    it('ICONS 恰好是全部非字母的单个图形', () => {
      const singles = Object.entries(table ?? {})
        .filter(([name, v]) => Array.isArray(v) && v.length > 0 && !Array.isArray(v[0]) && !name.startsWith('adobe'))
        .map(([name]) => name);
      expect(singles.sort()).toEqual([...ICONS].sort());
    });
  });
});
