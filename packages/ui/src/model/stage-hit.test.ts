import { describe, expect, it } from 'vitest';
import type { Sequence, SequenceItem } from '@baocut/protocol';
import type { VisualLayer } from '../render/frame-plan.ts';
import { hitAt, isMainVideo, layerContains, marqueeHits, unitPoint, visibleItems } from './stage-hit.ts';
import { poseContains } from './stage-pose.ts';

type Matrix = VisualLayer['matrix'];

/** 与 render-graph 的 `placement` 同一个式子：中心锚点的框绕锚点顺时针转。 */
function placed(cx: number, cy: number, w: number, h: number, deg = 0): Matrix {
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const qx = -w / 2;
  const qy = -h / 2;
  return [w * cos, w * sin, -h * sin, h * cos, cx + qx * cos - qy * sin, cy + qx * sin + qy * cos];
}

const layer = (itemId: string, kind: VisualLayer['kind'], matrix: Matrix) => ({ itemId, kind, matrix, opacity: 1 }) as VisualLayer;

describe('层的反变换', () => {
  it('点映回单位正方形；矩阵退化给 null', () => {
    expect(unitPoint([200, 0, 0, 100, 100, 50], { x: 200, y: 100 })).toEqual({ x: 0.5, y: 0.5 });
    expect(unitPoint([0, 0, 0, 0, 10, 10], { x: 10, y: 10 })).toBeNull();
  });

  it('旋转过的层：按自身轴判断', () => {
    const tall = layer('a', 'text', placed(500, 300, 200, 100, 90));
    expect(layerContains(tall, { x: 500, y: 300 })).toBe(true);
    expect(layerContains(tall, { x: 500, y: 390 })).toBe(true);
    expect(layerContains(tall, { x: 590, y: 300 })).toBe(false);
  });
});

describe('点选', () => {
  const layers = [
    layer('main', 'video', placed(960, 540, 1920, 1080)),
    layer('pip', 'video', placed(400, 300, 200, 100)),
    layer('logo', 'image', placed(420, 300, 100, 100)),
    layer('subs', 'caption', placed(960, 540, 1920, 1080)),
  ];

  it('从上往下，第一件盖住的赢；字幕层跳过', () => {
    expect(hitAt(layers, { x: 420, y: 300 })).toBe('logo');
    expect(hitAt(layers, { x: 330, y: 300 })).toBe('pip');
    expect(hitAt(layers, { x: 1500, y: 900 })).toBe('main');
  });

  it('跳过的那件（没选中的主视频）不参与', () => {
    expect(hitAt(layers, { x: 1500, y: 900 }, { skip: (id) => id === 'main' })).toBeNull();
  });

  it('选中的那件按布局框算（「适应」的画面只占框的一部分）', () => {
    const boxes = new Map([['pip', { cx: 400, cy: 300, w: 300, h: 200, rotation: 0 }]]);
    const at = { x: 280, y: 250 };
    expect(hitAt(layers, at, { skip: (id) => id === 'main' })).toBeNull();
    expect(hitAt(layers, at, { skip: (id) => id === 'main', boxes, contains: poseContains })).toBe('pip');
  });

  it('这一帧画面上的实例：自下而上、不重复、不含字幕', () => {
    expect(visibleItems([...layers, layer('pip', 'video', placed(0, 0, 1, 1))])).toEqual(['main', 'pip', 'logo']);
  });
});

describe('主视频与框选', () => {
  const sequence = {
    tracks: [
      { id: 'v2', order: 1, kind: 'visual' },
      { id: 'a1', order: 0, kind: 'audio' },
      { id: 'v1', order: 0, kind: 'visual' },
    ],
  } as unknown as Sequence;
  const item = (type: string, trackId: string, role?: string) => ({ type, trackId, role }) as SequenceItem;

  it('最下面那条画面轨上的视频，或标成 a-roll 的视频', () => {
    expect(isMainVideo(item('video', 'v1'), sequence)).toBe(true);
    expect(isMainVideo(item('video', 'v2'), sequence)).toBe(false);
    expect(isMainVideo(item('video', 'v2', 'a-roll'), sequence)).toBe(true);
    expect(isMainVideo(item('image', 'v1'), sequence)).toBe(false);
  });

  it('框选收相交的那几件', () => {
    const candidates = [
      { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
      { id: 'b', rect: { x: 200, y: 0, w: 100, h: 100 } },
      { id: 'c', rect: { x: 100, y: 100, w: 10, h: 10 } },
    ];
    expect(marqueeHits(candidates, { x: 50, y: 50, w: 100, h: 20 })).toEqual(['a']);
    expect(marqueeHits(candidates, { x: 50, y: 50, w: 200, h: 100 })).toEqual(['a', 'b', 'c']);
  });
});

describe('字幕的真实行框', () => {
  const layers = [
    layer('main', 'video', placed(960, 540, 1920, 1080)),
    layer('orig', 'caption', placed(960, 540, 1920, 1080)),
    layer('trans', 'caption', placed(960, 540, 1920, 1080)),
  ];
  const original = { layerId: 'orig', itemId: 'orig', documentId: 'doc_orig', cueId: 'c1', cx: 960, cy: 900, w: 800, h: 50, rotation: 0 };
  const translation = { ...original, itemId: 'trans', documentId: 'doc_trans', cy: 960 };
  const captionHits = [original, translation];

  it('视频已经选中时，原文与译文仍分别命中各自实例；行外仍选视频', () => {
    const boxes = new Map([['main', { cx: 960, cy: 540, w: 1920, h: 1080, rotation: 0 }]]);
    const options = { captionHits, boxes, contains: poseContains };
    expect(hitAt(layers, { x: 960, y: 900 }, options)).toBe('orig');
    expect(hitAt(layers, { x: 960, y: 960 }, options)).toBe('trans');
    expect(hitAt(layers, { x: 960, y: 800 }, options)).toBe('main');
  });

  it('没有可见句子、隐藏字幕层或被更上面的元素盖住时不误选字幕', () => {
    expect(hitAt(layers, { x: 960, y: 900 }, { captionHits: [] })).toBe('main');
    expect(hitAt(layers.slice(0, 1), { x: 960, y: 900 }, { captionHits })).toBe('main');
    expect(hitAt([...layers, layer('logo', 'image', placed(960, 900, 100, 100))], { x: 960, y: 900 }, { captionHits })).toBe('logo');
    expect(hitAt(layers, { x: 960, y: 900 }, { captionHits, skip: (id) => id === 'orig' })).toBe('main');
  });

  it('旋转行按真实角度判断，不使用外包轴对齐框', () => {
    const rotated = [{ ...original, rotation: 90 }];
    expect(hitAt(layers, { x: 960, y: 600 }, { captionHits: rotated })).toBe('orig');
    expect(hitAt(layers, { x: 1200, y: 900 }, { captionHits: rotated })).toBe('main');
  });
});
