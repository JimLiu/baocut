import { describe, expect, it } from 'vitest';
import type { CaptionHit } from '../render/render-planner.ts';
import { captionBox, lineMoveStart, movedCaptionStyle, movedLineStyle, restackedRootY, stepCaptionMove } from './stage-caption-move.ts';

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

describe('lineMoveStart', () => {
  it('还在堆栈里的行按画出来的框量：框的中心折成百分比（一位小数），不读根样式的 x', () => {
    // 框 560–1360 × 868.8–928.8：中心 (960, 898.8) → (50, 83.2)。
    const box = { x: 560, y: 868.8, w: 800, h: 60 };
    expect(lineMoveStart({ x: 30, y: 86 }, 'translation', box, canvas)).toEqual({ x0: 50, y0: 83.2, detached: false });
    // 覆盖里只有 y（或只有字号）不算单独摆。
    expect(lineMoveStart({ transStyle: { y: 40, fontSize: 20 } }, 'translation', box, canvas).detached).toBe(false);
  });

  it('已经单独摆了的从覆盖里的值起手', () => {
    const root = { origStyle: { x: 30.25, y: 20, verticalAlign: 'bottom' } };
    expect(lineMoveStart(root, 'original', { x: 0, y: 0, w: 10, h: 10 }, canvas)).toEqual({ x0: 30.25, y0: 20, detached: true });
  });
});

describe('movedLineStyle', () => {
  it('头一回离开堆栈：这一行的覆盖写上 x、y 与 center 对齐，别的覆盖与另一行不动', () => {
    const root = { y: 86, verticalAlign: 'bottom', transStyle: { fontSize: 20, verticalAlign: 'top' }, origStyle: { color: '#fff' } };
    expect(movedLineStyle(root, 'translation', { x: 40, y: 70 }, false)).toEqual({
      y: 86,
      verticalAlign: 'bottom',
      transStyle: { fontSize: 20, verticalAlign: 'center', x: 40, y: 70 },
      origStyle: { color: '#fff' },
    });
    expect(movedLineStyle({}, 'original', { x: 50, y: 83.2 }, false)).toEqual({ origStyle: { x: 50, y: 83.2, verticalAlign: 'center' } });
  });

  it('已经单独摆了的只换位置，保留它自己的对齐', () => {
    const root = { origStyle: { x: 30, y: 20, verticalAlign: 'bottom' } };
    expect(movedLineStyle(root, 'original', { x: 35, y: 25 }, true)).toEqual({ origStyle: { x: 35, y: 25, verticalAlign: 'bottom' } });
  });

  it('带上根样式锚线时一并改根样式的 y；与原值相同就不写', () => {
    expect(movedLineStyle({ y: 86 }, 'translation', { x: 40, y: 70 }, false, 80.4)).toEqual({
      y: 80.4,
      transStyle: { x: 40, y: 70, verticalAlign: 'center' },
    });
    expect(movedLineStyle({}, 'translation', { x: 40, y: 70 }, false, 86)).toEqual({ transStyle: { x: 40, y: 70, verticalAlign: 'center' } });
  });

  it('单拖过的行在整组拖时跟着平移', () => {
    const detached = movedLineStyle({ y: 86 }, 'translation', { x: 40, y: 70 }, false);
    expect(movedCaptionStyle(detached, { x: 55, y: 80 })).toEqual({
      x: 55,
      y: 80,
      transStyle: { x: 45, y: 64, verticalAlign: 'center' },
    });
  });
});

describe('restackedRootY', () => {
  // 另一行（原文）此刻画在 838.8–898.8：中心 868.8 → 80.4%。
  const rest = [{ ...hit(868.8, 60), itemId: 'o' }];

  it('块锚点是 center（或没写）时，根样式锚线换成另一行此刻的中心', () => {
    expect(restackedRootY({ y: 86 }, 'translation', rest, canvas)).toBe(80.4);
    expect(restackedRootY({ y: 50, verticalAlign: 'center' }, 'translation', rest, canvas)).toBe(80.4);
  });

  it('上、下对齐、另一行没画出来或不止一件、另一行自己已经单独摆了，都不挪', () => {
    expect(restackedRootY({ verticalAlign: 'bottom' }, 'translation', rest, canvas)).toBeNull();
    expect(restackedRootY({ verticalAlign: 'top' }, 'translation', rest, canvas)).toBeNull();
    expect(restackedRootY({}, 'translation', [], canvas)).toBeNull();
    expect(restackedRootY({}, 'translation', [...rest, { ...hit(500, 60), itemId: 'p' }], canvas)).toBeNull();
    expect(restackedRootY({ origStyle: { x: 50, y: 30 } }, 'translation', rest, canvas)).toBeNull();
    // 只有 y 的覆盖还在堆栈里。
    expect(restackedRootY({ origStyle: { y: 30 } }, 'translation', rest, canvas)).toBe(80.4);
  });
});

describe('单拖一行的整个过程', () => {
  it('从框起手、按住没动或拖回原处时终值等于起点（松手不写文档，行不会离开堆栈）', () => {
    const box = { x: 560, y: 868.8, w: 800, h: 60 };
    const { x0, y0 } = lineMoveStart({}, 'translation', box, canvas);
    const move = { box, x0, y0, p0: { x: 960, y: 900 } };
    expect(stepCaptionMove(move, { x: 960, y: 900 }, loose, env)).toMatchObject({ x: x0, y: y0 });
    const moved = stepCaptionMove(move, { x: 960, y: 900 - 108 }, loose, env);
    expect(moved).toMatchObject({ x: 50, y: 73.2 });
  });
});
