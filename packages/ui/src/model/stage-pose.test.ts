import { describe, expect, it } from 'vitest';
import {
  aabbOf,
  cornerScale,
  cornerScales,
  dragMove,
  dragRotation,
  edgeResize,
  groupScale,
  groupShift,
  guidesFor,
  handlesFor,
  marqueeRect,
  moveLimits,
  nudgeDelta,
  oppositeCorner,
  pivotOf,
  placeFields,
  posable,
  poseContains,
  poseOf,
  rectsCross,
  resizeCursor,
  resizeKindOf,
  sizeRange,
  smallHandles,
  snapMove,
  snapRotation,
  type Assets,
  type PlacedItem,
  type Pose,
} from './stage-pose.ts';

const canvas = { width: 1920, height: 1080 };
const range = sizeRange(canvas);
const box: Pose = { cx: 500, cy: 300, w: 200, h: 100, rotation: 0 };
const textLimits = { x: [57.6, 1862.4] as [number, number], y: [43.2, 1036.8] as [number, number] };
const item = (type: PlacedItem['type']) => ({ type }) as PlacedItem;
const placed = (fields: Record<string, unknown>) => ({ place: {}, ...fields }) as unknown as PlacedItem;
/** 竖拍的源（1080 × 1920），版本 1。 */
const assets = {
  tall: {
    id: 'tall',
    kind: 'video',
    name: '竖拍',
    currentRevision: 1,
    revisions: { 1: { video: { displayWidth: 1080, displayHeight: 1920, pixelAspectRatio: { num: 1, den: 1 } } } },
  },
} as unknown as Assets;
const tallRef = { id: 'tall', revision: 1 };
/** `place` 叠上 `placeFields` 的结果（引擎落盘之后的样子）。 */
const applied = (it: PlacedItem, fields: Record<string, unknown>) => ({ ...it, place: { ...it.place, ...fields } }) as PlacedItem;

describe('place ↔ 盒', () => {
  it('铺满画布的视频：盒就是整块画布，只能转', () => {
    const video = placed({ type: 'video', mode: 'fullscreen', place: { x: 10, w: 50, rot: 30 } });
    expect(poseOf(video, canvas)).toEqual({ cx: 960, cy: 540, w: 1920, h: 1080, rotation: 30 });
    expect(posable(video, canvas)).toBe(false);
    expect(placeFields(video, { cx: 100, cy: 100, w: 300, h: 300, rotation: 45 }, canvas)).toEqual({ rot: 45 });
    expect(pivotOf(video, canvas)).toEqual({ x: 960, y: 540 });
  });

  it('画中画视频（源是竖的）：宽是 w% × scale，高按源的显示宽高比；挪动、缩放换回来不漂', () => {
    const video = placed({ type: 'video', mode: 'pip', assetRef: tallRef, place: { x: 25, y: 50, w: 30 } });
    expect(posable(video, canvas, assets)).toBe(true);
    const pose = poseOf(video, canvas, assets);
    expect(pose).toMatchObject({ cx: 480, cy: 540, w: 576, rotation: 0 });
    expect(pose.h).toBeCloseTo(1024);
    // 查不到素材时按画布的宽高比。
    expect(poseOf(video, canvas).h).toBeCloseTo(324);
    const target: Pose = { cx: 576, cy: 432, w: 384, h: (384 * 1920) / 1080, rotation: 0 };
    const fields = placeFields(video, target, canvas, assets);
    expect(fields).toEqual({ x: 30, y: 40, w: 20 });
    const back = poseOf(applied(video, fields), canvas, assets);
    expect(back.cx).toBeCloseTo(target.cx);
    expect(back.cy).toBeCloseTo(target.cy);
    expect(back.w).toBeCloseTo(target.w);
    expect(back.h).toBeCloseTo(target.h);
    // 只压扁高：写进 scaleY，宽与位置不动。
    expect(placeFields(video, { ...pose, h: pose.h / 2 }, canvas, assets)).toEqual({ scaleY: 0.5 });
  });

  it('写了 h 的图形：框高是画幅高的 h%，同样乘 scale；scale 不动，框宽折成 w', () => {
    const shape = placed({ type: 'shape', shape: { shape: 'rect', h: 10 }, place: { w: 20, scale: 2 } });
    const pose = poseOf(shape, canvas);
    expect(pose).toEqual({ cx: 960, cy: 540, w: 768, h: 216, rotation: 0 });
    expect(placeFields(shape, { ...pose, w: 384 }, canvas)).toEqual({ w: 10 });
    const taller = placeFields(shape, { ...pose, w: 384, h: 432 }, canvas);
    expect(taller).toEqual({ w: 10, scaleY: 2 });
    const back = poseOf(applied(shape, taller), canvas);
    expect(back.w).toBeCloseTo(384);
    expect(back.h).toBeCloseTo(432);
  });

  it('box 贴纸：高是宽的 0.62；没变的盒不出字段', () => {
    const sticker = placed({ type: 'sticker', sticker: { source: 'template', templateId: 'box' } });
    const pose = poseOf(sticker, canvas);
    expect(pose).toMatchObject({ cx: 960, cy: 540, w: 384 });
    expect(pose.h).toBeCloseTo(238.08);
    expect(placeFields(sticker, pose, canvas)).toEqual({});
    const moved = placeFields(sticker, { ...pose, cx: 480, w: 192, h: 119.04 }, canvas);
    expect(moved).toEqual({ x: 25, w: 10 });
    expect(poseOf(applied(sticker, moved), canvas).h).toBeCloseTo(119.04);
  });

  it('素材是视频的贴纸与占位框按媒体摆，裁剪留下的区域定框高：与帧计划画的是同一个框', () => {
    const sticker = placed({ type: 'sticker', sticker: { source: 'asset' }, assetRef: tallRef });
    expect(poseOf(sticker, canvas, assets)).toMatchObject({ cx: 960, cy: 540, w: 384 });
    expect(poseOf(sticker, canvas, assets).h).toBeCloseTo(682.67, 2);
    const holder = placed({ type: 'placeholder', placeholder: {}, assetRef: tallRef });
    expect(poseOf(holder, canvas, assets)).toEqual({ cx: 960, cy: 540, w: 806.4, h: 259.2, rotation: 0 });
    const cropped = placed({ type: 'video', assetRef: tallRef, crop: { left: 0, top: 0.5, right: 0, bottom: 0 }, place: { w: 30 } });
    expect(poseOf(cropped, canvas, assets).h).toBeCloseTo(512);
  });

  it('文字左右拉边：只改框宽，高写进 scaleY；换回来高不变（取三位小数之内）', () => {
    const text = placed({ type: 'text', text: '标题', place: { x: 50, y: 50, w: 20 } });
    const pose = poseOf(text, canvas);
    expect(pose).toEqual({ cx: 960, cy: 540, w: 384, h: 384, rotation: 0 });
    const wider = placeFields(text, { ...pose, w: 576 }, canvas);
    expect(wider).toEqual({ w: 30, scaleY: 0.667 });
    const back = poseOf(applied(text, wider), canvas);
    expect(back.w).toBeCloseTo(576);
    expect(back.h).toBeCloseTo(384, 0);
  });

  it('各种类的缺省：声波贴底铺满，进度条 80% × 5%；角度绕回 ±180', () => {
    expect(poseOf(placed({ type: 'visualizer' }), canvas)).toEqual({ cx: 960, cy: 918, w: 1920, h: 216, rotation: 0 });
    expect(poseOf(placed({ type: 'progress' }), canvas)).toEqual({ cx: 960, cy: 540, w: 1536, h: 54, rotation: 0 });
    const wave = placed({ type: 'visualizer' });
    expect(placeFields(wave, poseOf(wave, canvas), canvas)).toEqual({});
    expect(placeFields(wave, { ...poseOf(wave, canvas), rotation: 370 }, canvas)).toEqual({ rot: 10 });
  });

  it('点在不在旋转过的盒里；外包盒按旋转后算', () => {
    const tall = { cx: 500, cy: 300, w: 200, h: 20, rotation: 90 };
    expect(poseContains(tall, { x: 500, y: 390 })).toBe(true);
    expect(poseContains(tall, { x: 590, y: 300 })).toBe(false);
    const r = aabbOf(tall);
    expect(r.w).toBeCloseTo(20);
    expect(r.h).toBeCloseTo(200);
  });
});
describe('能力表与把手', () => {
  it('三档：视频与合成自由、文字左右加四角、图片与图形只有四角', () => {
    expect(resizeKindOf(item('video'))).toBe('free');
    expect(resizeKindOf(item('composition'))).toBe('free');
    expect(resizeKindOf(item('text'))).toBe('text');
    expect(resizeKindOf(item('image'))).toBe('corner');
    expect(resizeKindOf(item('shape'))).toBe('corner');
  });

  it('任一边 < 24 退化成少几个的那一套', () => {
    expect(handlesFor('free', 100, 100)).toHaveLength(8);
    expect(handlesFor('free', 20, 100)).toEqual(['nw', 's', 'e']);
    expect(handlesFor('text', 100, 100)).toEqual(['w', 'e', 'nw', 'ne', 'sw', 'se']);
    expect(handlesFor('text', 100, 10)).toEqual(['se', 'e']);
    expect(handlesFor('corner', 30, 23)).toEqual(['nw']);
    expect(smallHandles(49, 100)).toBe(true);
    expect(smallHandles(50, 40)).toBe(false);
  });

  it('四角：自由一档改宽高，其余等比缩放', () => {
    expect(cornerScales('free', 'se')).toBe(false);
    expect(cornerScales('text', 'se')).toBe(true);
    expect(cornerScales('text', 'e')).toBe(false);
  });

  it('光标随旋转角转（30° 一格）', () => {
    expect(resizeCursor('e', 0)).toBe('e-resize');
    expect(resizeCursor('n', 45)).toBe('ne-resize');
    expect(resizeCursor('n', 90)).toBe('e-resize');
    expect(resizeCursor('n', -90)).toBe('w-resize');
  });
});

describe('移动', () => {
  const snap = { canvas, others: [], threshold: 10 };

  it('中心 ±1.5% 吸到画布中线，⌥（不吸）时原样', () => {
    expect(dragMove(box, 450, 0, textLimits, snap)).toMatchObject({ cx: 960, cy: 300 });
    expect(dragMove(box, 450, 0, textLimits, null)).toMatchObject({ cx: 950, cy: 300 });
  });

  it('夹进限位', () => {
    expect(dragMove(box, -1000, 0, textLimits, null).cx).toBeCloseTo(57.6);
  });

  it('多线吸附：边对上别的对象的边，并报出那条线', () => {
    const others = [{ x: 1200, y: 0, w: 100, h: 100 }];
    const moved = dragMove(box, 593, 0, textLimits, { canvas, others, threshold: 10 });
    expect(moved.cx).toBe(1100);
    expect(snapMove({ x: 993, y: 250, w: 200, h: 100 }, { canvas, others, threshold: 10 })).toEqual({
      dx: 7,
      dy: 0,
      guides: [{ axis: 'x', at: 1200 }],
    });
  });

  it('参考线：此刻贴着的线', () => {
    expect(guidesFor({ x: 860, y: 0, w: 200, h: 100 }, canvas, [], 1)).toEqual([
      { axis: 'x', at: 960 },
      { axis: 'y', at: 0 },
    ]);
  });

  it('限位：视频只留一条可见带；起手在限位外的放宽到起手位置', () => {
    const big = { cx: 960, cy: 540, w: 3840, h: 2160, rotation: 0 };
    expect(moveLimits(item('video'), big, canvas).x).toEqual([-1728, 3648]);
    expect(moveLimits(item('text'), box, canvas).x).toEqual(textLimits.x);
    expect(moveLimits(item('text'), { ...box, cx: 10 }, canvas).x).toEqual([10, 1862.4]);
  });
});

describe('改边', () => {
  const base = { start: box, alt: false, shift: false, ratio: null, range };

  it('右边：只长宽，左边不动', () => {
    const r = edgeResize({ ...base, handle: 'e', dx: 50, dy: 30 });
    expect(r).toMatchObject({ w: 250, h: 100, cx: 525, cy: 300 });
  });

  it('转 90° 的左边：位移投影到自身轴', () => {
    const r = edgeResize({ ...base, start: { ...box, rotation: 90 }, handle: 'w', dx: 0, dy: 50 });
    expect(r.w).toBeCloseTo(150);
    expect(r.cx).toBeCloseTo(500);
    expect(r.cy).toBeCloseTo(325);
  });

  it('四角默认锁比例、对角不动；⇧ 解锁', () => {
    const locked = edgeResize({ ...base, handle: 'se', dx: 40, dy: 0 });
    expect(locked.w / locked.h).toBeCloseTo(2);
    expect(locked.cx - locked.w / 2).toBeCloseTo(400);
    expect(locked.cy - locked.h / 2).toBeCloseTo(250);
    expect(edgeResize({ ...base, handle: 'se', dx: 40, dy: 0, shift: true })).toMatchObject({ w: 240, h: 100 });
  });

  it('⌥ 以中心对称、位移双倍计入', () => {
    expect(edgeResize({ ...base, handle: 'e', dx: 50, dy: 0, alt: true })).toMatchObject({ w: 300, cx: 500 });
  });

  it('不窄于画布 2%，对边照样不动', () => {
    const r = edgeResize({ ...base, handle: 'e', dx: -500, dy: 0 });
    expect(r.w).toBeCloseTo(38.4);
    expect(r.cx - r.w / 2).toBeCloseTo(400);
  });
});

describe('四角等比缩放', () => {
  it('锚在对角：倍率按到对角的距离比，对角不动', () => {
    const { pose, factor } = cornerScale(box, 'se', { x: 600, y: 350 }, { x: 700, y: 400 }, false);
    expect(factor).toBeCloseTo(1.5);
    expect(pose.w).toBeCloseTo(300);
    expect(pose.cx - pose.w / 2).toBeCloseTo(400);
    expect(pose.cy - pose.h / 2).toBeCloseTo(250);
  });

  it('⌥ 锚在中心', () => {
    const { pose, factor } = cornerScale(box, 'se', { x: 600, y: 350 }, { x: 700, y: 400 }, true);
    expect(factor).toBeCloseTo(2);
    expect(pose).toMatchObject({ cx: 500, cy: 300 });
  });

  it('倍率夹在 0.1 以上', () => {
    expect(cornerScale(box, 'se', { x: 600, y: 350 }, { x: 400.5, y: 250.2 }, false).factor).toBe(0.1);
  });

  it('对角随旋转走', () => {
    const p = oppositeCorner({ ...box, rotation: 90 }, 'se');
    expect(p.x).toBeCloseTo(550);
    expect(p.y).toBeCloseTo(200);
  });
});

describe('旋转', () => {
  it('15° 栅格；⇧ 自由一位小数', () => {
    expect(snapRotation(7.4, false)).toBe(0);
    expect(snapRotation(7.6, false)).toBe(15);
    expect(snapRotation(-172, false)).toBe(-165);
    expect(snapRotation(-173, false)).toBe(180);
    expect(snapRotation(370, false)).toBe(15);
    expect(snapRotation(33.33, true)).toBe(33.3);
  });

  it('指针绕枢轴转过的角度', () => {
    expect(dragRotation(0, { x: 500, y: 300 }, { x: 500, y: 200 }, { x: 600, y: 300 }, false)).toBe(90);
    expect(dragRotation(30, { x: 500, y: 300 }, { x: 500, y: 200 }, { x: 400, y: 300 }, false)).toBe(-60);
  });
});

describe('多选', () => {
  it('整体平移：位移夹到全组都合法', () => {
    const starts = [
      { ...box, cx: 100 },
      { ...box, cx: 1800 },
    ];
    const d = groupShift(starts, [textLimits, textLimits], -100, 0);
    expect(d.x).toBeCloseTo(-42.4);
    expect(d.y).toBe(0);
  });

  it('整体缩放：绕统一框中心，把手跟手', () => {
    const starts = [
      { cx: 400, cy: 300, w: 100, h: 100, rotation: 0 },
      { cx: 600, cy: 300, w: 100, h: 100, rotation: 15 },
    ];
    const { poses, factor } = groupScale(starts, { x: 350, y: 250, w: 300, h: 100 }, { x: 650, y: 350 }, { x: 800, y: 400 });
    expect(factor).toBeCloseTo(2);
    expect(poses.map((p) => [p.cx, p.w, p.rotation])).toEqual([
      [300, 200, 0],
      [700, 200, 15],
    ]);
  });
});

describe('键盘与框选', () => {
  it('方向键 1%，⇧ 5%，⌥↑/↓ 0.1%；⌥←/→ 让给时间', () => {
    expect(nudgeDelta('ArrowLeft', false, false, canvas)).toEqual({ x: -19.2, y: 0 });
    expect(nudgeDelta('ArrowRight', true, false, canvas)).toEqual({ x: 96, y: 0 });
    expect(nudgeDelta('ArrowUp', false, true, canvas)?.y).toBeCloseTo(-1.08);
    expect(nudgeDelta('ArrowLeft', false, true, canvas)).toBeNull();
    expect(nudgeDelta('a', false, false, canvas)).toBeNull();
  });

  it('框选 4px 以内仍是点击；相交不算边贴边', () => {
    expect(marqueeRect({ x: 10, y: 10 }, { x: 12, y: 13 }).on).toBe(false);
    expect(marqueeRect({ x: 10, y: 10 }, { x: 6, y: 20 })).toEqual({ x: 6, y: 10, w: 4, h: 10, on: true });
    expect(rectsCross({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsCross({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
  });
});
