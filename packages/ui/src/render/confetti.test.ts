import { describe, expect, it } from 'vitest';
import {
  CONFETTI_LIMITS,
  CONFETTI_SHAPES,
  CONFETTI_STYLES,
  confettiDefaults,
  confettiSeed,
  confettiStyle,
  effectiveEmit,
  normalizeConfetti,
  randomSeed,
  switchConfettiStyle,
} from './confetti.ts';

describe('彩纸配方', () => {
  it('十款齐全，缺省参数落在范围内：颜色 ≤ 8、形状都在 12 种之内、发射起点跟配方', () => {
    expect(CONFETTI_STYLES.map((style) => style.key)).toEqual([
      'rainbow-paper',
      'pastel-fall',
      'neon-streamers',
      'golden-starburst',
      'festival-fireworks',
      'hearts-petals',
      'party-cannons',
      'curling-ribbons',
      'geometric-pop',
      'champagne-sparkle',
    ]);
    expect(CONFETTI_SHAPES).toHaveLength(12);
    expect(CONFETTI_STYLES.map((style) => style.name)).not.toContain(undefined);
    expect(CONFETTI_STYLES.every((style) => style.name !== style.key)).toBe(true);
    expect(confettiStyle('party-cannons').from).toBe('react-confetti');
    for (const style of CONFETTI_STYLES) {
      const props = confettiDefaults(style.key, 7);
      expect(props.style).toBe(style.key);
      expect(props.seed).toBe(7);
      expect(props.colors.length).toBeGreaterThanOrEqual(1);
      expect(props.colors.length).toBeLessThanOrEqual(CONFETTI_LIMITS.colors);
      for (const shape of props.shapes) expect(CONFETTI_SHAPES).toContain(shape);
      expect(props.origin).toBeNull();
      expect(props.angle).toBeNull();
      expect(['continuous', 'burst']).toContain(props.emit.mode);
    }
  });

  it('认不出的款回落到第一款；种子只收 53 位以内的非负整数', () => {
    expect(confettiStyle('nope').key).toBe('rainbow-paper');
    expect(confettiSeed(12.7)).toBe(12);
    expect(confettiSeed(-5)).toBe(5);
    expect(confettiSeed('42')).toBe(42);
    expect(confettiSeed('x')).toBe(0);
    expect(confettiSeed(2 ** 60)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('随机源', () => {
  it('randomSeed 给出非零安全整数', () => {
    for (let i = 0; i < 20; i++) {
      const seed = randomSeed();
      expect(Number.isSafeInteger(seed) && seed > 0).toBe(true);
    }
  });
});

describe('参数', () => {
  it('换款回缺省但种子保留', () => {
    const next = switchConfettiStyle({ ...confettiDefaults('rainbow-paper', 99), size: 3 }, 'hearts-petals');
    expect(next.seed).toBe(99);
    expect(next.style).toBe('hearts-petals');
    expect(next.size).toBe(1);
  });

  it('多于 8 色、非法形状与越界值被夹回', () => {
    const fixed = normalizeConfetti({
      style: 'neon-streamers',
      colors: new Array(12).fill('#FFFFFF'),
      shapes: ['heart', 'nope'],
      size: 99,
      emit: { rate: 9999, mode: 'weird' },
      origin: { x: 500, y: -50 },
      angle: 720,
    });
    expect(fixed.colors).toHaveLength(8);
    expect(fixed.shapes).toEqual(['heart']);
    expect(fixed.size).toBe(4);
    expect(fixed.emit.rate).toBe(400);
    expect(fixed.emit.mode).toBe('continuous');
    expect(fixed.origin).toEqual({ x: 120, y: -20 });
    expect(fixed.angle).toBe(180);
    expect(normalizeConfetti({ shapes: [] }).shapes).toEqual(confettiDefaults('rainbow-paper').shapes);
    expect(normalizeConfetti(null).style).toBe('rainbow-paper');
  });

  it('发射参数：没自定时回落到配方第一枚发射器，多发射器的款标 multi', () => {
    const cannons = effectiveEmit(confettiDefaults('party-cannons'));
    expect([cannons.x, cannons.y, cannons.angle, cannons.spread, cannons.multi]).toEqual([0, 83, -65, 26, true]);
    const custom = effectiveEmit({ ...confettiDefaults('party-cannons'), origin: { x: 50, y: 50 }, angle: -90 });
    expect([custom.x, custom.y, custom.angle, custom.multi]).toEqual([50, 50, -90, false]);
  });
});
