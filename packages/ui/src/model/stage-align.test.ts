import { describe, expect, it } from 'vitest';
import type { Place } from '@baocut/protocol';
import { alignOperations, distributeOperations } from './stage-align.ts';
import type { Assets, PlacedItem } from './stage-pose.ts';

const canvas = { width: 1920, height: 1080 };
/** 左上角在画布的 (`left`%, `top`%)、宽 `w`% 高 `h`%（画幅百分比）的矩形图形；`place.x`、`place.y` 是框中心。 */
const at = (id: string, left: number, top: number, w = 5, h = 5, patch: Partial<Place> = {}) =>
  ({
    id,
    type: 'shape',
    shape: { shape: 'rect', h },
    place: { x: left + w / 2, y: top + h / 2, w, ...patch },
  }) as unknown as PlacedItem;

describe('对齐', () => {
  it('左对齐到选区：都对到最左那件的左边，只写 x', () => {
    const items = [at('a', 5, 10), at('b', 15, 20), at('c', 12, 40, 10)];
    expect(alignOperations('s', items, 'left', 'selection', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'b', x: 7.5 },
      { type: 'setTransform', sequenceId: 's', itemId: 'c', x: 10 },
    ]);
  });

  it('左对齐到画布：贴画布左边', () => {
    const items = [at('a', 5, 10), at('b', 15, 20)];
    expect(alignOperations('s', items, 'left', 'canvas', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'a', x: 2.5 },
      { type: 'setTransform', sequenceId: 's', itemId: 'b', x: 2.5 },
    ]);
  });

  it('右对齐、水平居中、底对齐', () => {
    const items = [at('a', 5, 10), at('b', 15, 20, 10)];
    expect(alignOperations('s', items, 'right', 'selection', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'a', x: 22.5 },
    ]);
    // 选区 5–25，中线 15。
    expect(alignOperations('s', items, 'hcenter', 'selection', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'a', x: 15 },
      { type: 'setTransform', sequenceId: 's', itemId: 'b', x: 15 },
    ]);
    expect(alignOperations('s', items, 'vcenter', 'canvas', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'a', y: 50 },
      { type: 'setTransform', sequenceId: 's', itemId: 'b', y: 50 },
    ]);
    expect(alignOperations('s', items, 'bottom', 'selection', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'a', y: 22.5 },
    ]);
  });

  it('按旋转后的外包盒量：转 90° 的盒按竖着的宽高对齐', () => {
    const items = [at('a', 5, 10), at('b', 20, 30, 10, 5, { rot: 90 })];
    // b 宽 192、高 54，中心在 480：外包盒左边在 453；对到 96，中心挪到 123（6.4%）。
    expect(alignOperations('s', items, 'left', 'selection', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'b', x: 6.4 },
    ]);
  });

  it('已经对齐的不出操作；改 y 从不写 x', () => {
    const items = [at('a', 5, 10), at('b', 5, 30)];
    expect(alignOperations('s', items, 'left', 'selection', canvas)).toEqual([]);
    for (const op of alignOperations('s', [at('a', 5, 10), at('b', 15, 30)], 'top', 'selection', canvas)) {
      expect(op).not.toHaveProperty('x');
      expect(op).not.toHaveProperty('w');
    }
  });

  it('画中画视频的框高按源的宽高比量（要给素材表）', () => {
    const video = {
      id: 'v',
      type: 'video',
      mode: 'pip',
      assetRef: { id: 'tall', revision: 1 },
      place: { x: 50, y: 50, w: 10 },
    } as unknown as PlacedItem;
    const assets = {
      tall: {
        id: 'tall',
        kind: 'video',
        revisions: { 1: { video: { displayWidth: 1080, displayHeight: 1920, pixelAspectRatio: { num: 1, den: 1 } } } },
      },
    } as unknown as Assets;
    // 竖拍：宽 192、高 341.3，底边贴到 1080 时中心在 909.3（84.2%）；不给素材表就按画布的宽高比（高 108）。
    expect(alignOperations('s', [video], 'bottom', 'canvas', canvas, assets)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'v', y: 84.2 },
    ]);
    expect(alignOperations('s', [video], 'bottom', 'canvas', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'v', y: 95 },
    ]);
  });
});

describe('分布', () => {
  it('参照选区：首尾不动，中间那件让两边空隙一样大', () => {
    const items = [at('a', 0, 0), at('c', 50, 0), at('b', 10, 0)];
    // 0–5、b 宽 5、50–55：空隙 (55 − 15) / 2 = 20，b 落在 25。
    expect(distributeOperations('s', items, 'x', 'selection', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'b', x: 27.5 },
    ]);
  });

  it('参照画布：首件贴起边、末件贴终边，竖向只写 y', () => {
    const items = [at('a', 0, 10), at('b', 0, 30), at('c', 0, 50)];
    // 高 5 × 3，空隙 (100 − 15) / 2 = 42.5：0、47.5、95。
    expect(distributeOperations('s', items, 'y', 'canvas', canvas)).toEqual([
      { type: 'setTransform', sequenceId: 's', itemId: 'a', y: 2.5 },
      { type: 'setTransform', sequenceId: 's', itemId: 'b', y: 50 },
      { type: 'setTransform', sequenceId: 's', itemId: 'c', y: 97.5 },
    ]);
  });

  it('不到三件不分布；已经等距的不出操作', () => {
    expect(distributeOperations('s', [at('a', 0, 0), at('b', 25, 0)], 'x', 'selection', canvas)).toEqual([]);
    expect(distributeOperations('s', [at('a', 0, 0), at('b', 20, 0), at('c', 40, 0)], 'x', 'selection', canvas)).toEqual([]);
  });
});
