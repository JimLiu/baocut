import { describe, expect, it } from 'vitest';
import { canvasToSource, clampFocus, cropRect, draggedFocus, focusView, rectQuad, sourceToCanvas, type FrameLayer } from './screen-focus-frame.ts';

const close = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9));

describe('focusView', () => {
  it('centres the visible area on the focus point, scaled down from the crop', () => {
    close(focusView({ x: 0.5, y: 0.5 }, 2, [0, 0, 1, 1]), [0.25, 0.25, 0.75, 0.75]);
  });

  it('pushes the visible area back inside the crop at the edges (same as the solver)', () => {
    close(focusView({ x: 0.05, y: 0.98 }, 4, [0, 0, 1, 1]), [0, 0.75, 0.25, 1]);
  });

  it('scales and clamps against the crop, not the whole source', () => {
    const crop = cropRect({ left: 0.2, top: 0.1, right: 0.2, bottom: 0.3 });
    close(crop, [0.2, 0.1, 0.8, 0.7]);
    // C is 0.6 × 0.6; at 2× V is 0.3 × 0.3, and a focus at the corner of the source stays inside C.
    close(focusView({ x: 0, y: 0 }, 2, crop), [0.2, 0.1, 0.5, 0.4]);
    close(focusView({ x: 0.5, y: 0.4 }, 2, crop), [0.35, 0.25, 0.65, 0.55]);
  });

  it('treats an invalid crop as none', () => {
    close(cropRect({ left: 0.6, top: 0, right: 0.5, bottom: 0 }), [0, 0, 1, 1]);
    close(cropRect(null), [0, 0, 1, 1]);
  });
});

describe('clampFocus', () => {
  it('returns the centre of the clamped visible area', () => {
    expect(clampFocus({ x: 0.02, y: 0.5 }, 2, [0, 0, 1, 1])).toEqual({ x: 0.25, y: 0.5 });
    const c = clampFocus({ x: 0.9, y: 0.9 }, 2, cropRect({ left: 0.25, top: 0, right: 0.25, bottom: 0 }));
    close([c.x, c.y], [0.625, 0.75]);
  });
});

describe('source ↔ canvas mapping', () => {
  // Full-screen 1920×1080, no crop.
  const full: FrameLayer = { matrix: [1920, 0, 0, 1080, 0, 0], sourceRect: [0, 0, 1, 1] };
  // A picture-in-picture box at (1260, 600) with the left and right quarters cropped: the plan's sourceRect is the
  // crop (in whole-source coordinates) and the matrix is the contained content rectangle inside the `place` box.
  const pip: FrameLayer = { matrix: [320, 0, 0, 360, 1260, 600], sourceRect: [0.25, 0, 0.75, 1] };

  it('maps through the layer source rect and matrix', () => {
    expect(sourceToCanvas(full, { x: 0.5, y: 0.25 })).toEqual({ x: 960, y: 270 });
    expect(sourceToCanvas(pip, { x: 0.25, y: 0 })).toEqual({ x: 1260, y: 600 });
    expect(sourceToCanvas(pip, { x: 0.75, y: 1 })).toEqual({ x: 1580, y: 960 });
    const back = canvasToSource(pip, { x: 1420, y: 780 })!;
    close([back.x, back.y], [0.5, 0.5]);
  });

  it('draws the visible area of a cropped pip at the right place', () => {
    const crop = cropRect({ left: 0.25, top: 0, right: 0.25, bottom: 0 });
    const quad = rectQuad(pip, focusView({ x: 0.5, y: 0.5 }, 2, crop));
    close(
      quad.flatMap((p) => [p.x, p.y]),
      [1340, 690, 1500, 690, 1500, 870, 1340, 870],
    );
  });

  it('follows rotation and flips in the matrix', () => {
    // Rotated 90° clockwise around the canvas origin, then moved right by 1080.
    const rotated: FrameLayer = { matrix: [0, 1920, -1080, 0, 1080, 0], sourceRect: [0, 0, 1, 1] };
    expect(sourceToCanvas(rotated, { x: 1, y: 0 })).toEqual({ x: 1080, y: 1920 });
    const back = canvasToSource(rotated, { x: 540, y: 960 })!;
    close([back.x, back.y], [0.5, 0.5]);
    const flipped: FrameLayer = { matrix: [-1920, 0, 0, 1080, 1920, 0], sourceRect: [0, 0, 1, 1] };
    expect(sourceToCanvas(flipped, { x: 0, y: 0 })).toEqual({ x: 1920, y: 0 });
  });

  it('gives null for a degenerate matrix', () => {
    expect(canvasToSource({ matrix: [0, 0, 0, 0, 0, 0], sourceRect: [0, 0, 1, 1] }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('draggedFocus', () => {
  const pip: FrameLayer = { matrix: [320, 0, 0, 360, 1260, 600], sourceRect: [0.25, 0, 0.75, 1] };
  const crop = cropRect({ left: 0.25, top: 0, right: 0.25, bottom: 0 });

  it('moves the focus by the distance the pointer travelled on the source', () => {
    // 32 px on a 320 px wide picture of half the source = 0.05 of the source.
    const next = draggedFocus(pip, { x: 0.5, y: 0.5 }, { x: 1400, y: 700 }, { x: 1432, y: 736 }, 2, crop);
    close([next.x, next.y], [0.55, 0.6]);
  });

  it('cannot drag the visible area out of the picture', () => {
    const next = draggedFocus(pip, { x: 0.5, y: 0.5 }, { x: 1400, y: 700 }, { x: 4000, y: -4000 }, 2, crop);
    close([next.x, next.y], [0.625, 0.25]);
  });

  it('keeps the start when the matrix is degenerate', () => {
    const flat: FrameLayer = { matrix: [0, 0, 0, 0, 0, 0], sourceRect: [0, 0, 1, 1] };
    expect(draggedFocus(flat, { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 2, [0, 0, 1, 1])).toEqual({ x: 0.5, y: 0.5 });
  });
});
