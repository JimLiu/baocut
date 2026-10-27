import { describe, expect, it } from 'vitest';
import { parseImageHeader } from './image-header.ts';
import { encodeGrayPng, expandMask, expandPlan, maskStats, parseRatio, rasterizeMask, scaleMask, workArea } from './image-mask.ts';

/** 图片编辑的选区与画布几何（架构设计 §7.9）：与界面原型 `model-image-edit.js` 的规则一致。 */

describe('选区', () => {
  it('框与笔画的并集：外框、覆盖率；笔画两点之间连起来，向外扩 grow 像素', () => {
    const mask = { boxes: [{ x: 10, y: 10, width: 20, height: 10 }], strokes: [{ radius: 3, points: [[50, 50], [70, 50]] as Array<[number, number]> }] };
    const pixels = rasterizeMask(mask, 100, 80);
    const stats = maskStats(pixels, 100, 80)!;
    expect(stats.bounds).toEqual({ x: 10, y: 10, width: 63, height: 43 });
    expect(pixels[15 * 100 + 15]).toBe(255);
    expect(pixels[50 * 100 + 60]).toBe(255);
    expect(pixels[50 * 100 + 80]).toBe(0);
    expect(stats.coverage).toBeGreaterThan(0.03);
    expect(stats.coverage).toBeLessThan(0.05);
    const grown = maskStats(rasterizeMask(mask, 100, 80, { grow: 4 }), 100, 80)!;
    expect(grown.bounds).toEqual({ x: 6, y: 6, width: 71, height: 51 });
    // 从原图的 origin 起截一块。
    const part = rasterizeMask(mask, 20, 20, { origin: { x: 10, y: 10 } });
    expect(maskStats(part, 20, 20)!.bounds).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(maskStats(rasterizeMask({ boxes: [{ x: 200, y: 200, width: 5, height: 5 }] }, 100, 80), 100, 80)).toBeNull();
  });

  it('换算到别的尺寸：按宽高的比例，半径按较小的那个', () => {
    const mask = { boxes: [{ x: 900, y: 700, width: 200, height: 60 }], strokes: [{ radius: 20, points: [[100, 100]] as Array<[number, number]> }] };
    expect(scaleMask(mask, { width: 1200, height: 800 }, { width: 1200, height: 800 })).toBe(mask);
    expect(scaleMask(mask, { width: 1200, height: 800 }, { width: 600, height: 200 })).toEqual({
      boxes: [{ x: 450, y: 175, width: 100, height: 15 }],
      strokes: [{ radius: 5, points: [[50, 25]] }],
    });
  });

  it('工作区：四周各留一半上下文、每边至少 512、不出界；图小时是整张', () => {
    expect(workArea({ x: 992, y: 688, width: 176, height: 80 }, { width: 1200, height: 800 })).toEqual({ x: 688, y: 288, width: 512, height: 512 });
    expect(workArea({ x: 100, y: 100, width: 400, height: 300 }, { width: 2000, height: 2000 })).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(workArea({ x: 10, y: 10, width: 20, height: 20 }, { width: 300, height: 200 })).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('扩图的画布', () => {
  it('按比例只往缺的方向加、按锚点放原图；按边扩加像素', () => {
    const src = { width: 1200, height: 800 };
    expect(expandPlan(src, { ratio: '16:9' })).toEqual({ width: 1422, height: 800, x: 111, y: 0 });
    expect(expandPlan(src, { ratio: '16:9', anchor: 'left' })).toEqual({ width: 1422, height: 800, x: 0, y: 0 });
    expect(expandPlan(src, { ratio: '9:16', anchor: 'bottom' })).toEqual({ width: 1200, height: 2133, x: 0, y: 1333 });
    expect(expandPlan(src, { margins: { left: 10, top: 20, right: 30, bottom: 0 } })).toEqual({ width: 1240, height: 820, x: 10, y: 20 });
    expect(parseRatio('16:9')).toBeCloseTo(16 / 9);
    expect([parseRatio('16x9'), parseRatio('0:9'), parseRatio('')]).toEqual([null, null, null]);
  });

  it('遮罩：新增的部分 255，原图 0；只在新增了的边向里让出 inset', () => {
    const plan = { width: 20, height: 10, x: 5, y: 0 };
    const mask = expandMask(plan, { width: 10, height: 10 }, 2);
    const at = (x: number, y: number) => mask[y * 20 + x];
    expect([at(0, 5), at(4, 5), at(19, 5)]).toEqual([255, 255, 255]);
    expect([at(5, 5), at(6, 5)]).toEqual([255, 255]);
    expect([at(7, 5), at(12, 5), at(7, 0), at(7, 9)]).toEqual([0, 0, 0, 0]);
    expect([at(13, 5), at(14, 5)]).toEqual([255, 255]);
  });
});

describe('灰度 PNG', () => {
  it('文件头读得出尺寸', () => {
    const png = encodeGrayPng(new Uint8Array(7 * 3).fill(255), 7, 3);
    expect(parseImageHeader(png)).toMatchObject({ mediaType: 'image/png', width: 7, height: 3 });
  });
});
