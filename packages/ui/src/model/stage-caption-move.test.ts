import { describe, expect, it } from 'vitest';
import type { CaptionHit } from '../render/render-planner.ts';
import { captionBox, movedCaptionStyle, stepCaptionMove } from './stage-caption-move.ts';

const canvas = { width: 1920, height: 1080 };
const env = { canvas, others: [], pxScale: 1 };
const free = { shift: false, alt: false };
const hit = (cy: number, h: number, w = 800): CaptionHit => ({ layerId: 'l', itemId: 'c', documentId: 'd', cueId: 'q', cx: 960, cy, w, h, rotation: 0 });

describe('captionBox', () => {
  it('双语两行合成一个外包框；没有行是 null', () => {
    expect(captionBox([hit(860, 40), hit(910, 60, 1000)])).toEqual({ x: 460, y: 840, w: 1000, h: 100 });
    expect(captionBox([])).toBeNull();
  });
});

describe('stepCaptionMove', () => {
  // 底边钉在 86% 的锚线上：框底 928.8、高 60，中心 898.8。
  const move = { box: { x: 560, y: 868.8, w: 800, h: 60 }, y0: 86, p0: { x: 960, y: 900 } };

  it('只上下动：位移折成锚线的增量，横向位移不算', () => {
    const r = stepCaptionMove(move, { x: 1500, y: 900 - 108 }, free, env);
    expect(r.y).toBe(76);
    expect(r.dy).toBeCloseTo(-108, 6);
    expect(r.guides).toEqual([]);
  });

  it('框的中心吸到画面中线（±1.5%），只出横线；⌥ 不吸', () => {
    // 中心到 548.8 时离中线 8.8px（< 1080 × 1.5%）。
    const p = { x: 960, y: 900 - 350 };
    const r = stepCaptionMove(move, p, free, env);
    expect(r.dy).toBeCloseTo(540 - 898.8, 0);
    expect(r.y).toBe(52.8);
    expect(r.guides).toContainEqual({ axis: 'y', at: 540 });
    expect(r.guides.every((g) => g.axis === 'y')).toBe(true);
    const loose = stepCaptionMove(move, p, { shift: false, alt: true }, env);
    expect(loose.y).toBe(53.6);
    expect(loose.guides).toEqual([]);
  });

  it('框边吸到别的对象的边（6px）', () => {
    const others = [{ x: 100, y: 600, w: 200, h: 100 }];
    // 框顶本来落在 703.8，吸到对象底边 700。
    const r = stepCaptionMove(move, { x: 960, y: 900 - 165 }, free, { ...env, others });
    expect(r.dy).toBeCloseTo(700 - 868.8, 0);
    expect(r.guides).toContainEqual({ axis: 'y', at: 700 });
  });

  it('锚线夹在 4–96%；起手已在限位外的不跳', () => {
    expect(stepCaptionMove(move, { x: 960, y: 900 + 500 }, free, env).y).toBe(96);
    expect(stepCaptionMove(move, { x: 960, y: 900 - 2000 }, free, env).y).toBe(4);
    const low = { ...move, y0: 99 };
    expect(stepCaptionMove(low, { x: 960, y: 901 }, { shift: false, alt: true }, env).y).toBe(99);
    expect(stepCaptionMove(low, { x: 960, y: 900 - 54 }, { shift: false, alt: true }, env).y).toBe(94);
  });
});

describe('movedCaptionStyle', () => {
  it('换锚线；自己定了位置的行跟着平移，只有 y 的覆盖不动', () => {
    const root = { y: 86, verticalAlign: 'bottom', origStyle: { x: 50, y: 70, fontSize: 20 }, transStyle: { y: 40 } };
    expect(movedCaptionStyle(root, 76)).toEqual({
      y: 76,
      verticalAlign: 'bottom',
      origStyle: { x: 50, y: 60, fontSize: 20 },
      transStyle: { y: 40 },
    });
  });

  it('没写 y 时按 86 算位移', () => {
    expect(movedCaptionStyle({ origStyle: { x: 50, y: 90 } }, 80)).toEqual({ y: 80, origStyle: { x: 50, y: 84 } });
  });
});
