import { SHAPE_OUTLINES } from './shape-outlines.ts';

/** 认得的图形：矩形、椭圆与 20 款轮廓形状（`shape-outlines.ts`）。 */
export function knownShape(kind: unknown): boolean {
  return kind === 'rect' || kind === 'ellipse' || (typeof kind === 'string' && Object.hasOwn(SHAPE_OUTLINES, kind));
}
