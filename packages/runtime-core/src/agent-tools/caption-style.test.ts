import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_STYLE_BODY } from '@baocut/jobs';
import { captionStylePatch, freshCaptionStyle, patchStudioStyle } from './caption-style.ts';

describe('字幕样式补丁', () => {
  it('合进 Studio 样式：顶层键整体替换，描边与投影只改给出的字段，原正文不变', () => {
    const body = {
      schema: 'baocut.legacy-studio-style/0.1',
      style: { y: 86, textOutline: { on: true, color: '#000000', width: 14 }, punct: true },
    };
    const next = patchStudioStyle(body, { y: 75, verticalAlign: 'bottom', textOutline: { on: false } });
    expect(next).toEqual({
      schema: 'baocut.legacy-studio-style/0.1',
      style: { y: 75, verticalAlign: 'bottom', textOutline: { on: false, color: '#000000', width: 14 }, punct: true },
    });
    expect(body.style.y).toBe(86);
  });

  it('新建的样式以默认预设为底', () => {
    const fresh = freshCaptionStyle({ background: true });
    expect(fresh.style).toEqual({ ...(DEFAULT_CAPTION_STYLE_BODY.style as object), background: true });
  });

  it('定位框样式、动态场景与坏正文不按补丁改', () => {
    expect(patchStudioStyle({ schema: 'baocut.boxed-caption-style/1', canvas: {}, box: {}, style: {} }, { y: 50 })).toBeNull();
    expect(patchStudioStyle({ schema: 'baocut.legacy-studio-style/0.1' }, { y: 50 })).toBeNull();
    expect(patchStudioStyle(null, { y: 50 })).toBeNull();
  });

  it('schema：取值范围、未知键与空补丁拒绝', () => {
    expect(captionStylePatch.safeParse({ y: 75, verticalAlign: 'bottom', width: 84, fontSize: 32, fontColor: '#FFEE00CC' }).success).toBe(
      true,
    );
    expect(captionStylePatch.safeParse({ y: 101 }).success).toBe(false);
    expect(captionStylePatch.safeParse({ width: 2 }).success).toBe(false);
    expect(captionStylePatch.safeParse({ fontColor: 'yellow' }).success).toBe(false);
    expect(captionStylePatch.safeParse({ anchor: 'bottom' }).success).toBe(false);
    expect(captionStylePatch.safeParse({}).success).toBe(false);
  });
});
