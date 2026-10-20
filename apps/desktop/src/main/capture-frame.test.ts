import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_SIDE, captureRect } from './capture-frame.ts';

describe('标记截图要截的那一块（主进程重新校验渲染进程给的位置）', () => {
  it('取整，原样返回四个数', () => {
    expect(captureRect({ x: 12.4, y: 80.6, width: 960.2, height: 540.5 })).toEqual({ x: 12, y: 81, width: 960, height: 541 });
    expect(captureRect({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('不是矩形、不是数字、出窗口左上角、没有面积或超过上限的都拒绝', () => {
    for (const bad of [
      undefined,
      null,
      'rect',
      {},
      { x: 0, y: 0, width: 10 },
      { x: '0', y: 0, width: 10, height: 10 },
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 },
      { x: -1, y: 0, width: 10, height: 10 },
      { x: 0, y: -0.6, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 0, y: 0, width: 10, height: 0.2 },
      { x: 0, y: 0, width: CAPTURE_MAX_SIDE + 1, height: 10 },
      { x: 0, y: 0, width: 10, height: CAPTURE_MAX_SIDE + 1 },
    ]) {
      expect(() => captureRect(bad), JSON.stringify(bad)).toThrow();
    }
  });
});
