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
    expect(patchStudioStyle(body, { panelSeam: false })?.style).toMatchObject({ y: 86, panelSeam: false });
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
    expect(captionStylePatch.safeParse({ panelSeam: false }).success).toBe(true);
    expect(captionStylePatch.safeParse({ panelSeam: 'off' }).success).toBe(false);
    expect(captionStylePatch.safeParse({ y: 101 }).success).toBe(false);
    expect(captionStylePatch.safeParse({ width: 2 }).success).toBe(false);
    expect(captionStylePatch.safeParse({ fontColor: 'yellow' }).success).toBe(false);
    expect(captionStylePatch.safeParse({ anchor: 'bottom' }).success).toBe(false);
    expect(captionStylePatch.safeParse({}).success).toBe(false);
  });

  it('排版键：对齐、贴边、行高、字距与标点照写；字重同时写粗体', () => {
    const patch = { textAlign: 'left', alignWithinWrap: true, lineHeight: 1.45, letterSpacing: 1, punct: false, fontWeight: 400 } as const;
    expect(captionStylePatch.safeParse(patch).success).toBe(true);
    const next = freshCaptionStyle(patch).style as Record<string, unknown>;
    expect(next).toMatchObject({ ...patch, bold: false });
    expect((freshCaptionStyle({ fontWeight: 800 }).style as Record<string, unknown>).bold).toBe(true);
    expect(captionStylePatch.safeParse({ textAlign: 'justify' }).success).toBe(false);
    expect(captionStylePatch.safeParse({ lineHeight: 0.2 }).success).toBe(false);
    expect(captionStylePatch.safeParse({ alignWithinWrap: 'yes' }).success).toBe(false);
  });

  it('双语两行：次序与距离写在根上；一行的覆盖只给要不同的键，x、y 成对，行里的未知键与空覆盖拒绝', () => {
    const ok = (patch: unknown) => captionStylePatch.safeParse(patch).success;
    expect(ok({ order: 'orig', gap: 12 })).toBe(true);
    expect(ok({ order: 'top' })).toBe(false);
    expect(ok({ gap: 41 })).toBe(false);
    expect(ok({ origStyle: { fontSize: 18, fontColor: '#C8C2B4', fontFamily: 'Iowan Old Style' } })).toBe(true);
    expect(ok({ transStyle: { x: 70, y: 40, verticalAlign: 'top', textOutline: { on: false }, background: true } })).toBe(true);
    expect(ok({ origStyle: null })).toBe(true);
    expect(ok({ origStyle: { y: 90 } })).toBe(false);
    expect(ok({ origStyle: { x: 30 } })).toBe(false);
    expect(ok({ origStyle: {} })).toBe(false);
    // 折行宽度、标点、说话人名字与分屏接缝是两行共用的，不在行覆盖里。
    expect(ok({ origStyle: { width: 40 } })).toBe(false);
    expect(ok({ transStyle: { punct: false } })).toBe(false);
    expect(ok({ origStyle: { fontColor: 'gray' } })).toBe(false);
  });

  it('一行的覆盖合进它原有的那份；描边、投影从这一行此刻画出来的值合起写全；字重同时写这一行的粗体', () => {
    const body = {
      schema: 'baocut.legacy-studio-style/0.1',
      style: {
        fontColor: '#FFFFFF',
        bold: true,
        fontWeight: 700,
        textOutline: { on: true, color: '#000000', width: 14 },
        origStyle: { x: 50, y: 92, fontColor: '#CCCCCC' },
      },
    };
    const next = patchStudioStyle(body, {
      origStyle: { fontWeight: 400, textOutline: { on: true, width: 6 } },
      transStyle: { fontColor: '#F2D27A', dropShadow: { on: false } },
    })!.style as Record<string, unknown>;
    expect(next.origStyle).toEqual({
      x: 50,
      y: 92,
      fontColor: '#CCCCCC',
      fontWeight: 400,
      bold: false,
      textOutline: { on: true, color: '#000000', width: 6 },
    });
    expect(next.transStyle).toEqual({ fontColor: '#F2D27A', dropShadow: { on: false } });
    expect(next).toMatchObject({ fontColor: '#FFFFFF', bold: true, fontWeight: 700 });
    expect(body.style.origStyle).toEqual({ x: 50, y: 92, fontColor: '#CCCCCC' });
  });

  it('根上改外观时两行覆盖里的同名键去掉，两行都按新值画；位置键不动单独摆走的一行；null 去掉这一行的覆盖', () => {
    const body = {
      schema: 'baocut.legacy-studio-style/0.1',
      style: {
        y: 86,
        fontColor: '#FFFFFF',
        origStyle: { x: 30, y: 90, fontColor: '#999999', fontSize: 16 },
        transStyle: { fontColor: '#FFEE00', bold: false, fontWeight: 400 },
      },
    };
    const both = patchStudioStyle(body, { fontColor: '#F5F0E6', fontWeight: 600, y: 70 })!.style as Record<string, unknown>;
    expect(both).toMatchObject({ fontColor: '#F5F0E6', fontWeight: 600, bold: false, y: 70 });
    expect(both.origStyle).toEqual({ x: 30, y: 90, fontSize: 16 });
    // 这一行只剩被根盖掉的键：覆盖整个去掉。
    expect(both).not.toHaveProperty('transStyle');

    // 同一笔里先改根再给一行另设：那一行用自己的。
    const mixed = patchStudioStyle(body, { fontColor: '#F5F0E6', origStyle: { fontColor: '#8A8A8A' } })!.style as Record<string, unknown>;
    expect(mixed.origStyle).toMatchObject({ fontColor: '#8A8A8A' });
    expect(mixed.transStyle).toEqual({ bold: false, fontWeight: 400 });

    const followed = patchStudioStyle(body, { origStyle: null })!.style as Record<string, unknown>;
    expect(followed).not.toHaveProperty('origStyle');
    expect(followed.transStyle).toEqual(body.style.transStyle);
  });

  it('说话人名字：只改给出的字段，缩放比例越界拒绝', () => {
    const body = { schema: 'baocut.legacy-studio-style/0.1', style: { speakerLabel: { on: true, scale: 0.6 } } };
    const patch = captionStylePatch.parse({ speakerLabel: { on: true, color: '#FFCC00' } });
    expect(patchStudioStyle(body, patch)?.style).toEqual({
      speakerLabel: { on: true, scale: 0.6, color: '#FFCC00' },
    });
    expect(captionStylePatch.safeParse({ speakerLabel: { on: true } }).success).toBe(true);
    expect(captionStylePatch.safeParse({ speakerLabel: { color: '#FFCC00' } }).success).toBe(false);
    expect(captionStylePatch.safeParse({ speakerLabel: { on: true, scale: 2 } }).success).toBe(false);
  });
});
