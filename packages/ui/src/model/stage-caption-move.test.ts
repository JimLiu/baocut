import { describe, expect, it } from 'vitest';
import type { CaptionHit } from '../render/render-planner.ts';
import { captionBox, movedCaptionStyle, stepCaptionMove } from './stage-caption-move.ts';

const canvas = { width: 1920, height: 1080 };
const env = { canvas, others: [], pxScale: 1 };
const free = { shift: false, alt: false };
const loose = { shift: false, alt: true };
const hit = (cy: number, h: number, w = 800): CaptionHit => ({ layerId: 'l', itemId: 'c', documentId: 'd', cueId: 'q', cx: 960, cy, w, h, rotation: 0 });

describe('captionBox', () => {
  it('双语两行合成一个外包框；没有行是 null', () => {
    expect(captionBox([hit(860, 40), hit(910, 60, 1000)])).toEqual({ x: 460, y: 840, w: 1000, h: 100 });
    expect(captionBox([])).toBeNull();
  });
});

describe('stepCaptionMove', () => {
  // 横向居中、底边钉在 86% 的锚线上：框 560–1360 × 868.8–928.8，中心 (960, 898.8)。
  const move = { box: { x: 560, y: 868.8, w: 800, h: 60 }, x0: 50, y0: 86, p0: { x: 960, y: 900 } };

  it('上下左右一起动：位移折成水平中心与锚线的增量', () => {
    const r = stepCaptionMove(move, { x: 960 + 192, y: 900 - 108 }, free, env);
    expect(r).toMatchObject({ x: 60, y: 76, guides: [] });
    expect(r.dx).toBeCloseTo(192, 6);
    expect(r.dy).toBeCloseTo(-108, 6);
  });

  it('只上下拖时 x 原样留着，不顺手取整', () => {
    const r = stepCaptionMove({ ...move, x0: 50.04 }, { x: 960, y: 800 }, loose, env);
    expect(r.x).toBe(50.04);
    expect(r.dx).toBe(0);
  });

  it('框的中心吸到画面中线（±1.5%），两个方向各出一条线；⌥ 不吸', () => {
    // 中心到 (965, 548.8)：离竖中线 5px（< 1920 × 1.5%），离横中线 8.8px（< 1080 × 1.5%）。
    const p = { x: 965, y: 900 - 350 };
    const r = stepCaptionMove(move, p, free, env);
    expect(r.x).toBe(50);
    expect(r.y).toBe(52.8);
    expect(r.guides).toContainEqual({ axis: 'x', at: 960 });
    expect(r.guides).toContainEqual({ axis: 'y', at: 540 });
    const off = stepCaptionMove(move, p, loose, env);
    expect(off).toMatchObject({ x: 50.3, y: 53.6, guides: [] });
  });

  it('框边吸到别的对象的边（6px）', () => {
    // 框顶本来落在 703.8，吸到对象底边 700。
    const below = stepCaptionMove(move, { x: 960, y: 900 - 165 }, free, { ...env, others: [{ x: 100, y: 600, w: 200, h: 100 }] });
    expect(below.dy).toBeCloseTo(700 - 868.8, 0);
    expect(below.guides).toContainEqual({ axis: 'y', at: 700 });
    // 框右边本来落在 1397，吸到对象左边 1400。
    const beside = stepCaptionMove(move, { x: 960 + 37, y: 900 }, free, { ...env, others: [{ x: 1400, y: 100, w: 100, h: 100 }] });
    expect(beside.x).toBe(52.1);
    expect(beside.guides).toContainEqual({ axis: 'x', at: 1400 });
  });

  it('左右按画出来的字夹：框的两边不出画，贴边时往里取整', () => {
    const right = stepCaptionMove(move, { x: 960 + 2000, y: 900 }, free, env);
    expect(right.x).toBe(79.1);
    expect(1360 + right.dx).toBeLessThanOrEqual(1920);
    const left = stepCaptionMove(move, { x: 960 - 2000, y: 900 }, free, env);
    expect(left.x).toBe(20.9);
    expect(560 + left.dx).toBeGreaterThanOrEqual(0);
  });

  it('框比画面还宽就不左右动；起手已经出画的不跳，只能往回拖', () => {
    const wide = { ...move, box: { x: -40, y: 868.8, w: 2000, h: 60 }, x0: 50.04 };
    expect(stepCaptionMove(wide, { x: 960 + 300, y: 900 }, loose, env).x).toBe(50.04);
    // 框 1300–2100，右边已经出画 180px。
    const out = { ...move, box: { x: 1300, y: 868.8, w: 800, h: 60 }, x0: 88.5 };
    expect(stepCaptionMove(out, { x: 960 + 100, y: 900 }, loose, env).x).toBe(88.5);
    expect(stepCaptionMove(out, { x: 960 - 192, y: 900 }, loose, env).x).toBe(78.5);
  });

  it('锚线夹在 4–96%；起手已在限位外的不跳', () => {
    expect(stepCaptionMove(move, { x: 960, y: 900 + 500 }, free, env).y).toBe(96);
    expect(stepCaptionMove(move, { x: 960, y: 900 - 2000 }, free, env).y).toBe(4);
    const low = { ...move, y0: 99 };
    expect(stepCaptionMove(low, { x: 960, y: 901 }, loose, env).y).toBe(99);
    expect(stepCaptionMove(low, { x: 960, y: 900 - 54 }, loose, env).y).toBe(94);
  });
});

describe('movedCaptionStyle', () => {
  it('换水平中心与锚线；自己定了位置的行跟着平移，只有 y 的覆盖不动', () => {
    const root = { y: 86, verticalAlign: 'bottom', origStyle: { x: 50, y: 70, fontSize: 20 }, transStyle: { y: 40 } };
    expect(movedCaptionStyle(root, { x: 60, y: 76 })).toEqual({
      x: 60,
      y: 76,
      verticalAlign: 'bottom',
      origStyle: { x: 60, y: 60, fontSize: 20 },
      transStyle: { y: 40 },
    });
  });

  it('没写的按 50 / 86 算位移；没变的那一项不写进文档', () => {
    expect(movedCaptionStyle({ origStyle: { x: 50, y: 90 } }, { x: 50, y: 80 })).toEqual({ y: 80, origStyle: { x: 50, y: 84 } });
    expect(movedCaptionStyle({ y: 86.04 }, { x: 40, y: 86.04 })).toEqual({ x: 40, y: 86.04 });
  });
});
