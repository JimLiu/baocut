import { describe, expect, it } from 'vitest';
import { applyPanel, boxOf, defaultPin, fieldsOf, fitCanvas, project, quick, wrapRotation, type Pin } from './geometry-panel.ts';
import type { Pose } from './stage-pose.ts';

const canvas = { width: 1920, height: 1080 };

/** 盒：中心与尺寸（画布像素）。 */
function pose(cx: number, cy: number, w: number, h: number, rotation = 0): Pose {
  return { cx, cy, w, h, rotation };
}

describe('几何段：盒与画布盒', () => {
  it('盒是中心与尺寸：换成左上角与宽高的画布百分比', () => {
    expect(boxOf(pose(960, 540, 1920, 1080), canvas)).toEqual({ l: 0, t: 0, w: 100, h: 100 });
    expect(boxOf(pose(480, 270, 960, 540), canvas)).toEqual({ l: 0, t: 0, w: 50, h: 50 });
  });

  it('画布盒换回中心与尺寸', () => {
    expect(fieldsOf({ l: 0, t: 0, w: 50, h: 50 }, canvas)).toEqual({ cx: 480, cy: 270, w: 960, h: 540 });
    expect(fieldsOf({ l: 25, t: 50, w: 50, h: 25 }, canvas)).toEqual({ cx: 960, cy: 675, w: 960, h: 270 });
  });

  it('钉点投影：钉左量左边，钉中量中线偏移，钉右量到右边', () => {
    const box = boxOf(pose(1440, 540, 480, 270), canvas);
    expect(project(box, { x: 'left', y: 'top' })).toEqual({ x: 62.5, y: 37.5, w: 25, h: 25 });
    expect(project(box, { x: 'center', y: 'middle' })).toEqual({ x: 25, y: 0, w: 25, h: 25 });
    expect(project(box, { x: 'right', y: 'bottom' })).toEqual({ x: 12.5, y: 37.5, w: 25, h: 25 });
  });

  it('缺省钉点取最近的那条线，平手取左 / 顶', () => {
    expect(defaultPin({ l: 2, t: 80, w: 20, h: 10 })).toEqual({ x: 'left', y: 'bottom' });
    expect(defaultPin({ l: 40, t: 45, w: 20, h: 10 })).toEqual({ x: 'center', y: 'middle' });
    expect(defaultPin({ l: 0, t: 0, w: 100, h: 100 })).toEqual({ x: 'left', y: 'top' });
  });
});

describe('几何段：提交', () => {
  const pin: Pin = { x: 'right', y: 'bottom' };

  it('钉右的框变宽往左长，右边距不变；没改的那一维原样保留', () => {
    const t = pose(1440, 540, 480, 270);
    const values = project(boxOf(t, canvas), pin);
    const next = applyPanel(t, canvas, pin, { ...values, w: 50 }, false);
    expect(next).toEqual({ cx: 1200, cy: 540, w: 960, h: 270 });
    expect(project(boxOf({ ...t, ...next }, canvas), pin).x).toBe(values.x);
  });

  it('锁定比例：只改宽时高跟着按比例变', () => {
    const t = pose(960, 540, 960, 540);
    const center: Pin = { x: 'center', y: 'middle' };
    const values = project(boxOf(t, canvas), center);
    expect(applyPanel(t, canvas, center, { ...values, w: 25 }, true)).toEqual({ cx: 960, cy: 540, w: 480, h: 270 });
  });

  it('宽不小于画布的 2%', () => {
    const t = pose(960, 540, 960, 540);
    const center: Pin = { x: 'center', y: 'middle' };
    expect(applyPanel(t, canvas, center, { ...project(boxOf(t, canvas), center), w: 0 }, false).w).toBe(38.4);
  });

  it('改位置：钉中的 X 为 0 时框回到水平居中', () => {
    const t = pose(1260, 640, 480, 270);
    const center: Pin = { x: 'center', y: 'middle' };
    const values = project(boxOf(t, canvas), center);
    expect(applyPanel(t, canvas, center, { ...values, x: 0 }, false)).toEqual({ cx: 960, cy: 640, w: 480, h: 270 });
  });

  it('整宽：钉点换到左边，框铺满画布宽', () => {
    const t = pose(1260, 640, 480, 270);
    const q = quick({ x: 'center', y: 'middle' }, project(boxOf(t, canvas), { x: 'center', y: 'middle' }), 'fullWidth');
    expect(q.pin).toEqual({ x: 'left', y: 'middle' });
    expect(applyPanel(t, canvas, q.pin, q.values, false)).toEqual({ cx: 960, cy: 640, w: 1920, h: 270 });
  });
});

describe('适应 / 填满画布与旋转', () => {
  it('等比缩放并摆回正中', () => {
    const t = pose(1260, 640, 400, 400);
    expect(fitCanvas(t, canvas, false)).toEqual({ cx: 960, cy: 540, w: 1080, h: 1080 });
    expect(fitCanvas(t, canvas, true)).toEqual({ cx: 960, cy: 540, w: 1920, h: 1920 });
  });

  it('转过的盒按未旋转的宽高缩放，中心摆回画布正中', () => {
    expect(fitCanvas(pose(0, 0, 400, 200, 90), canvas, false)).toEqual({ cx: 960, cy: 540, w: 1920, h: 960 });
  });

  it('旋转角折回 (−180, 180]', () => {
    expect(wrapRotation(190)).toBe(-170);
    expect(wrapRotation(-180)).toBe(180);
    expect(wrapRotation(540)).toBe(180);
    expect(wrapRotation(-30)).toBe(-30);
  });
});
