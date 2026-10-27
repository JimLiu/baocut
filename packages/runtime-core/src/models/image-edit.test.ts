import { describe, expect, it } from 'vitest';
import { closestSize } from './image-edit.ts';

/** AI 修补出图的尺寸：模型支持的尺寸里比例最接近工作区的，比例一样时取大的（至多 2048×2048）。 */
describe('closestSize', () => {
  const model = { sizes: ['1024x1024', '1536x1024', '1024x1536', '512x512', '4096x4096', 'auto'] };
  it('按比例挑；一样时取像素多的；不列尺寸时 null', () => {
    expect(closestSize(model, 512, 512)).toBe('1024x1024');
    expect(closestSize(model, 2000, 1200)).toBe('1536x1024');
    expect(closestSize(model, 600, 1000)).toBe('1024x1536');
    expect(closestSize({ sizes: [] }, 512, 512)).toBeNull();
  });
});
