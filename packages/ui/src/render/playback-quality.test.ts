import { expect, test } from 'vitest';

import { PLAYBACK_PIXELS, paintSize } from './playback-quality.ts';

test('停住时按画布像素画原尺寸', () => {
  expect(paintSize({ width: 1920, height: 1080 }, 0.684, 'exact')).toEqual({ width: 1313, height: 739 });
  expect(paintSize({ width: 1920, height: 1080 }, 1, 'exact')).toEqual({ width: 1920, height: 1080 });
  expect(paintSize({ width: 1920, height: 1080 }, 0, 'exact')).toEqual({ width: 1, height: 1 });
});

test('播放中缩到像素预算之内，比例不变，不比停住时大', () => {
  const sizes = [
    { canvas: { width: 1920, height: 1080 }, scale: 0.684 },
    { canvas: { width: 1920, height: 1080 }, scale: 1 },
    { canvas: { width: 3840, height: 2160 }, scale: 1 },
    { canvas: { width: 1080, height: 1920 }, scale: 0.4 },
    { canvas: { width: 1080, height: 1080 }, scale: 1 },
  ];
  for (const { canvas, scale } of sizes) {
    const exact = paintSize(canvas, scale, 'exact');
    const playback = paintSize(canvas, scale, 'playback');
    expect(playback.width * playback.height).toBeLessThanOrEqual(PLAYBACK_PIXELS * 1.01);
    expect(playback.width).toBeLessThanOrEqual(exact.width);
    expect(playback.height).toBeLessThanOrEqual(exact.height);
    expect(Math.abs(playback.width / playback.height - canvas.width / canvas.height)).toBeLessThan(0.01);
  }
  expect(paintSize({ width: 1920, height: 1080 }, 0.684, 'playback')).toEqual({ width: 960, height: 540 });
  // 本来就在预算之内的（竖屏的小预览）不变。
  expect(paintSize({ width: 1080, height: 1920 }, 0.4, 'playback')).toEqual({ width: 432, height: 768 });
});
