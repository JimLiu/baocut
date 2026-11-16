import { describe, expect, it } from 'vitest';
import {
  applyRatio,
  cameraBox,
  cardPlacement,
  CAMERA_SHAPES,
  drawRect,
  edgeHandles,
  fillScreen,
  fitWindow,
  moveRect,
  nextShape,
  nudge,
  resizeCamera,
  resizeRect,
  sizeText,
  toggleCameraSize,
  tooSmall,
  windowAt,
} from './recording-area.ts';

const B = { x: 0, y: 0, width: 1440, height: 900 };
const R = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('recording area geometry', () => {
  it('draws in any direction, clamped to the screen; a ratio follows the longer drag', () => {
    expect(drawRect({ x: 100, y: 100 }, { x: 400, y: 300 }, 'free', B)).toEqual(R(100, 100, 300, 200));
    expect(drawRect({ x: 400, y: 300 }, { x: 100, y: 100 }, 'free', B)).toEqual(R(100, 100, 300, 200));
    expect(drawRect({ x: 1400, y: 10 }, { x: 1600, y: 50 }, 'free', B)).toEqual(R(1400, 10, 40, 40));
    expect(drawRect({ x: 0, y: 0 }, { x: 320, y: 10 }, '16:9', B)).toEqual(R(0, 0, 320, 180));
    expect(drawRect({ x: 0, y: 0 }, { x: 10, y: 300 }, '1:1', B)).toEqual(R(0, 0, 300, 300));
    const r = drawRect({ x: 1000, y: 800 }, { x: 1440, y: 900 }, '16:9', B);
    expect(r.x + r.width).toBeLessThanOrEqual(1440);
    expect(r.y + r.height).toBeLessThanOrEqual(900);
    expect(Math.abs(r.width / r.height - 16 / 9)).toBeLessThan(0.05);
  });

  it('moves inside the screen; arrows nudge 1, Shift 10', () => {
    const r = R(100, 100, 300, 200);
    expect(moveRect(r, -500, 0, B)).toEqual(R(0, 100, 300, 200));
    expect(moveRect(r, 5000, 5000, B)).toEqual(R(1140, 700, 300, 200));
    expect(nudge(r, 'ArrowRight', false, B)).toEqual(R(101, 100, 300, 200));
    expect(nudge(r, 'ArrowUp', true, B)).toEqual(R(100, 90, 300, 200));
    expect(nudge(r, 'Enter', false, B)).toBe(r);
  });

  it('resizes from a handle with the opposite side fixed', () => {
    const r = R(100, 100, 400, 300);
    expect(resizeRect(r, 'se', 100, 50, 'free', B)).toEqual(R(100, 100, 500, 350));
    expect(resizeRect(r, 'nw', -50, -50, 'free', B)).toEqual(R(50, 50, 450, 350));
    expect(resizeRect(r, 'w', -200, 0, 'free', B)).toEqual(R(0, 100, 500, 300));
    expect(resizeRect(r, 'e', -1000, 0, 'free', B).width).toBe(1);
    expect(resizeRect(r, 'se', 0, 0, '1:1', B)).toEqual(R(100, 100, 400, 400));
    expect(resizeRect(r, 'e', 0, 0, '4:3', B)).toEqual(R(100, 100, 400, 300));
    expect(resizeRect(r, 's', 0, 100, '1:1', B)).toEqual(R(100, 100, 400, 400));
    const big = resizeRect(r, 'se', 2000, 2000, '16:9', B);
    expect(big.x + big.width).toBeLessThanOrEqual(1440);
    expect(big.y + big.height).toBeLessThanOrEqual(900);
  });

  it('keeps the centre on a ratio change; minimum 150; edge handles hide under 80; fill and fit', () => {
    expect(applyRatio(R(100, 100, 400, 400), '16:9', B)).toEqual(R(100, 188, 400, 225));
    expect(applyRatio(null, '16:9', B)).toBeNull();
    expect(tooSmall(R(0, 0, 149, 400))).toBe(true);
    expect(tooSmall(R(0, 0, 150, 150))).toBe(false);
    expect(edgeHandles({ width: 79, height: 200 })).toEqual({ n: false, s: false, e: true, w: true });
    expect(fillScreen(B)).toEqual(B);
    expect(fitWindow(R(-20, 600, 400, 600), B)).toEqual(R(0, 600, 380, 300));
    expect(sizeText({ width: 1280.4, height: 720 })).toBe('1280 × 720');
  });

  it('finds the frontmost window under the pointer (front to back order)', () => {
    const ws = [{ id: 'b', ...R(300, 300, 500, 500) }, { id: 'a', ...R(0, 0, 500, 500) }];
    expect(windowAt(ws, { x: 400, y: 400 })?.id).toBe('b');
    expect(windowAt(ws, { x: 100, y: 100 })?.id).toBe('a');
    expect(windowAt(ws, { x: 1000, y: 100 })).toBeNull();
  });

  it('places the card below, then above, then inside the selection', () => {
    const card = { width: 416, height: 120 };
    expect(cardPlacement(R(200, 100, 400, 300), B, card)).toEqual({ x: 192, y: 416, where: 'below' });
    expect(cardPlacement(R(200, 500, 400, 350), B, card)).toEqual({ x: 192, y: 364, where: 'above' });
    expect(cardPlacement(R(0, 0, 1440, 900), B, card)).toEqual({ x: 512, y: 16, where: 'inside' });
    expect(cardPlacement(R(0, 100, 100, 100), B, card).x).toBe(8);
  });

  it('cycles camera shapes and sizes within 150–600', () => {
    expect(CAMERA_SHAPES.map(nextShape)).toEqual(['square', 'wide', 'round']);
    expect(cameraBox(230, 'round')).toEqual({ width: 230, height: 230 });
    expect(cameraBox(400, 'wide')).toEqual({ width: 400, height: 225 });
    expect(toggleCameraSize(230)).toBe(400);
    expect(toggleCameraSize(400)).toBe(230);
    expect(toggleCameraSize(321)).toBe(230);
    expect(resizeCamera(230, 'se', 40, 10)).toBe(270);
    expect(resizeCamera(230, 'nw', 40, 10)).toBe(190);
    expect(resizeCamera(230, 'se', 9999, 0)).toBe(600);
    expect(resizeCamera(230, 'se', -9999, 0)).toBe(150);
  });
});
