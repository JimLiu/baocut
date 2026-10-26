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

  it('当前词：none 与 colourHighlight 展开成目录格的整份载荷；不给颜色时沿用原来的当前词色；旧键 anim 一起去掉', () => {
    const none = freshCaptionStyle({ wordAnimation: { catalogId: 'none' } }).style as Record<string, unknown>;
    expect(none.wordAnimation).toEqual({ animationId: 'none', animationName: 'None', catalogId: 'none', spoken: {}, active: {}, unspoken: {} });
    expect(none).not.toHaveProperty('textMotion');

    const accent = freshCaptionStyle({ wordAnimation: { catalogId: 'colourHighlight', active: { color: '#F2B544' } } }).style as Record<string, unknown>;
    expect(accent.wordAnimation).toEqual({
      animationId: 'magic-wbw',
      animationName: 'Color',
      catalogId: 'colourHighlight',
      spoken: {},
      active: { color: '#F2B544' },
      unspoken: {},
    });
    // 默认样式是青绿的那一格：只给格子时颜色照旧；原来不是这一格时取内核的缺省色。
    expect((freshCaptionStyle({ wordAnimation: { catalogId: 'colourHighlight' } }).style as Record<string, any>).wordAnimation.active).toEqual({
      color: '#18E1D6',
    });
    const legacy = { schema: 'baocut.legacy-studio-style/0.1', style: { anim: { animationName: 'Reveal' }, karaokeColor: '#FF0000' } };
    const fromLegacy = patchStudioStyle(legacy, { wordAnimation: { catalogId: 'colourHighlight' } })!.style as Record<string, any>;
    expect(fromLegacy.wordAnimation.active).toEqual({ color: '#FFD43B' });
    expect(fromLegacy).not.toHaveProperty('anim');
    expect(fromLegacy).not.toHaveProperty('karaokeColor');
  });

  it('KTV 扫色：写进 textMotion.karaoke、当前词换成 none；原有的入场与出场留着，没给的扫色字段沿用；null 去掉扫色', () => {
    const fresh = freshCaptionStyle({ fontColor: '#8A8F98', textMotion: { karaoke: { color: '#1F2328' } } }).style as Record<string, any>;
    expect(fresh.textMotion).toEqual({ version: 1, karaoke: { color: '#1F2328' } });
    expect(fresh.wordAnimation.catalogId).toBe('none');
    expect(fresh.fontColor).toBe('#8A8F98');

    const entrance = { preset: 'fade-up', unit: 'cue', durationSeconds: 0.3, staggerSeconds: 0, intensity: 1, easing: 'easeOutQuad' };
    const body = {
      schema: 'baocut.legacy-studio-style/0.1',
      style: {
        wordAnimation: { animationId: 'magic-wbw', animationName: 'Color', catalogId: 'colourHighlight', spoken: {}, active: { color: '#18E1D6' }, unspoken: {} },
        textMotion: { version: 1, in: entrance, emphasis: { color: '#18E1D6', scale: 1, durationSeconds: 0.16 }, karaoke: { color: '#000000', guide: true } },
      },
    };
    const sung = patchStudioStyle(body, { textMotion: { karaoke: { color: '#FFB000', unit: 'word' } } })!.style as Record<string, any>;
    expect(sung.textMotion).toEqual({ version: 1, in: entrance, karaoke: { color: '#FFB000', unit: 'word', guide: true } });
    expect(sung.wordAnimation.catalogId).toBe('none');
    // 当前词与 none 一起给也行；同一笔里再给 colourHighlight 是矛盾的。
    expect(captionStylePatch.safeParse({ wordAnimation: { catalogId: 'none' }, textMotion: { karaoke: { color: '#FFB000' } } }).success).toBe(true);
    expect(
      captionStylePatch.safeParse({ wordAnimation: { catalogId: 'colourHighlight' }, textMotion: { karaoke: { color: '#FFB000' } } }).success,
    ).toBe(false);

    const off = patchStudioStyle({ schema: body.schema, style: sung }, { textMotion: { karaoke: null } })!.style as Record<string, any>;
    expect(off.textMotion).toEqual({ version: 1, in: entrance });
    expect(off.wordAnimation.catalogId).toBe('none');
    const bare = patchStudioStyle({ schema: body.schema, style: fresh }, { textMotion: { karaoke: null } })!.style as Record<string, unknown>;
    expect(bare).not.toHaveProperty('textMotion');
  });

  it('换回目录的一格时去掉扫色；还有入场、出场时变色同时写成 textMotion.emphasis（内核那时不读 wordAnimation）', () => {
    const entrance = { preset: 'pop', unit: 'word', durationSeconds: 0.2, staggerSeconds: 0.04, intensity: 1, easing: 'easeOutBack' };
    const style = { textMotion: { version: 1, in: entrance, karaoke: { color: '#FFB000' } }, wordAnimation: { catalogId: 'none', animationName: 'None' } };
    const body = { schema: 'baocut.legacy-studio-style/0.1', style };
    const color = patchStudioStyle(body, { wordAnimation: { catalogId: 'colourHighlight', active: { color: '#F2B544' } } })!.style as Record<string, any>;
    expect(color.textMotion).toEqual({ version: 1, in: entrance, emphasis: { color: '#F2B544', scale: 1, durationSeconds: 0.16 } });
    expect(color.wordAnimation.active).toEqual({ color: '#F2B544' });
    const none = patchStudioStyle(body, { wordAnimation: { catalogId: 'none' } })!.style as Record<string, any>;
    expect(none.textMotion).toEqual({ version: 1, in: entrance });
    // 只有扫色的 textMotion：换回一格时整个去掉，内核回到按 wordAnimation 画。
    const only = patchStudioStyle({ ...body, style: { textMotion: { version: 1, karaoke: { color: '#FFB000' } } } }, { wordAnimation: { catalogId: 'colourHighlight' } })!
      .style as Record<string, unknown>;
    expect(only).not.toHaveProperty('textMotion');
  });

  it('当前词与扫色的 schema：只收目录里的两格、扫色字段与颜色写法', () => {
    const ok = (patch: unknown) => captionStylePatch.safeParse(patch).success;
    expect(ok({ wordAnimation: { catalogId: 'flipClock' } })).toBe(false);
    expect(ok({ wordAnimation: { catalogId: 'none', active: { color: '#FFFFFF' } } })).toBe(false);
    expect(ok({ wordAnimation: { catalogId: 'colourHighlight', active: { color: 'cyan' } } })).toBe(false);
    expect(ok({ wordAnimation: { catalogId: 'colourHighlight', active: { color: '#00FFAA', opacity: 1 } } })).toBe(false);
    expect(ok({ textMotion: { karaoke: { color: '#FFB000', unit: 'grapheme', guide: true, nextLine: false } } })).toBe(true);
    expect(ok({ textMotion: { karaoke: { unit: 'word' } } })).toBe(false);
    expect(ok({ textMotion: { karaoke: { color: '#FFB000', unit: 'letter' } } })).toBe(false);
    expect(ok({ textMotion: { in: { preset: 'pop' } } })).toBe(false);
    expect(ok({ textMotion: {} })).toBe(false);
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
