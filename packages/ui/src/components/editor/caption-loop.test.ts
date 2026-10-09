import { describe, expect, it, vi } from 'vitest';
import { CAPTION_FPS, CaptionLoop } from './caption-loop.ts';

// Node 没有 ImageData，补一个装下像素的。
vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
  return { data, width, height };
});

/** 4×2 的透明画面，第一行第 `x` 个像素不透明。 */
function image(x: number): ImageData {
  const data = new Uint8ClampedArray(4 * 2 * 4);
  data.set([255, 0, 0, 255], x * 4);
  return new ImageData(data, 4, 2);
}

describe('字幕样式卡一圈的帧', () => {
  it('按共用时钟取格：一圈循环，原点之前的时刻也落在圈里', () => {
    const loop = new CaptionLoop(2);
    expect(loop.count).toBe(2 * CAPTION_FPS);
    expect(new CaptionLoop(4 / CAPTION_FPS).count).toBe(4);
    expect(loop.index(0)).toBe(0);
    expect(loop.index(2.01)).toBe(0);
    expect(loop.index(1.99)).toBe(loop.count - 1);
    expect(loop.index(-0.01)).toBe(loop.count - 1);
    expect(loop.time(3)).toBeCloseTo(3 / CAPTION_FPS);
  });

  it('裁到不透明的那一块存；画面一样的格共用一份', () => {
    const loop = new CaptionLoop(1);
    const first = loop.put(0, image(1));
    expect(first.at).toEqual({ x: 1, y: 0, width: 1, height: 1 });
    expect(first.image!.data).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
    expect(loop.put(1, image(1))).toBe(first);
    expect(loop.get(1)).toBe(first);
    expect(loop.put(2, image(2))).not.toBe(first);
    // 不相邻的也认得出（第一圈因时钟预算跳过的格，后来补画）。
    expect(loop.put(9, image(1))).toBe(first);
    // 画过的格不再收。
    expect(loop.put(0, image(3))).toBe(first);
  });

  it('一圈每格都画过且都是同一份画面才算不动；清掉之后从头算', () => {
    const loop = new CaptionLoop(4 / CAPTION_FPS);
    // 跳着画：一圈都是同一份画面照样认得出。
    for (const index of [0, 2, 1]) loop.put(index, image(1));
    expect(loop.still).toBe(false);
    loop.put(3, image(1));
    expect(loop.still).toBe(true);
    loop.clear();
    expect(loop.get(0)).toBeUndefined();
    expect(loop.still).toBe(false);
  });

  it('存满了就不再存，那一格照样贴得出来；与相邻格一样的仍共用', () => {
    const loop = new CaptionLoop(1, 8);
    loop.put(0, image(0));
    loop.put(2, image(1));
    const over = loop.put(4, image(2));
    expect(over.at).toEqual({ x: 2, y: 0, width: 1, height: 1 });
    expect(loop.get(4)).toBeUndefined();
    expect(loop.put(1, image(0))).toBe(loop.get(0));
  });
});
