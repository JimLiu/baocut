import { describe, expect, it } from 'vitest';
import type { CaptionItem, DocumentRecord, Sequence, Track } from '@baocut/protocol';
import { mergedLineStyle, type Json } from '../render/text-style.ts';
import {
  CAPTION_PRESETS,
  PAINT_KEYS,
  applyPreset,
  captionStyleOperations,
  currentPreset,
  fontFamilyOf,
  galleryTarget,
  lookStyle,
  presetGroups,
  presetOn,
  thumbScene,
  type DesignLook,
} from './caption-presets.ts';
import type { CaptionChip } from './caption-tracks.ts';
import { DEFAULT_CAPTION_STYLE } from './property-values.ts';

const preset = (id: string) => CAPTION_PRESETS.find((p) => p.id === id)!;
const STUDIO = 'baocut.legacy-studio-style/0.1';

const look = (patch: Partial<DesignLook> = {}): DesignLook => ({
  font: 'Poppins SemiBold',
  weight: 600,
  bold: false,
  italic: false,
  color: '#ffffff',
  align: 'center',
  lh: 120,
  spacing: 0,
  upper: '',
  bg: '#000000',
  opacity: 0,
  corners: 0,
  pad: 20,
  plate: 'line',
  outline: false,
  outlineColor: '#000000',
  outlineW: 0,
  shadow: false,
  shDist: 12,
  shAngle: 90,
  shBlur: 24,
  shColor: '#000000cc',
  ...patch,
});

describe('分区与次序', () => {
  it('照 data.js 目录：默认、Shorts、社交、商务；动态排版与复古没有卡不出', () => {
    expect(presetGroups().map((g) => [g.label, g.presets.map((p) => p.id)])).toEqual([
      ['默认', ['classic']],
      ['Shorts', ['shorts']],
      [
        '社交',
        [
          'ali',
          'karl',
          'lime',
          'phantom',
          'bulb',
          'vegas',
          'studio-focus',
          'studio-word-tiles',
          'studio-word-drop',
          'studio-paper-typewriter',
          'studio-line-swipe',
          'studio-soft-focus',
          'studio-rise-settle',
          'studio-kinetic-wave',
          'studio-ktv',
        ],
      ],
      ['商务', ['simple']],
    ]);
  });

  it('每张卡都是完整的涂装：只写涂装键，阴影与发光两个槽都给值', () => {
    for (const p of CAPTION_PRESETS) {
      expect(Object.keys(p.style).filter((key) => !PAINT_KEYS.includes(key))).toEqual([]);
      for (const key of ['fontFamily', 'fontWeight', 'fontColor', 'textAlign', 'textTransform', 'background', 'textOutline', 'dropShadow', 'glow']) {
        expect(p.style[key], `${p.id}.${key}`).toBeDefined();
      }
      expect(p.style.fontSize).toBeUndefined();
    }
  });

  it('Studio 设计带着动效的标出来；经典与 look 涂装不标', () => {
    expect(CAPTION_PRESETS.filter((p) => p.motion).map((p) => p.id)).toHaveLength(9);
    expect(preset('classic').motion).toBeUndefined();
    expect(preset('ali').motion).toBeUndefined();
  });
});

describe('原型 look 换算', () => {
  it('字体：商用字体换替身，字重后缀去掉', () => {
    expect(fontFamilyOf('Poppins SemiBold')).toBe('Poppins');
    expect(fontFamilyOf('Poppins Extrabold')).toBe('Poppins');
    expect(fontFamilyOf('The Bold Font')).toBe('Poppins');
    expect(fontFamilyOf('Komika Axis')).toBe('Bangers');
    expect(fontFamilyOf('Playfair Display')).toBe('Playfair Display');
  });

  it('字距 ×0.3、描边 ×1.25、圆角 30×c/55、留白 30×1.4×p/80、行高 ÷100', () => {
    const style = lookStyle(look({ spacing: -2, outline: true, outlineW: 11, corners: 30, pad: 20, lh: 115, upper: 'upper' }));
    expect(style.letterSpacing).toBe(-0.6);
    expect(style.textOutline).toEqual({ on: true, color: '#000000', width: 13.75 });
    expect(style.outline).toBe(true);
    expect(style.borderRadius).toBe(16.3636);
    expect(style.backgroundPadding).toBe(10.5);
    expect(style.lineHeight).toBe(1.15);
    expect(style.textTransform).toBe('uppercase');
  });

  it('底板：不透明度进颜色的 alpha，0 就关；整块 / 逐行', () => {
    expect(lookStyle(look({ bg: '#B6FF60', opacity: 100, plate: 'block' }))).toMatchObject({
      background: true,
      backgroundColor: '#B6FF60FF',
      backgroundStyle: 'block',
    });
    expect(lookStyle(look({ opacity: 0 }))).toMatchObject({ background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap' });
  });

  it('有阴影：距离为 0 的是发光，否则是投影（距离、模糊 ÷100，alpha 进不透明度）', () => {
    expect(lookStyle(look({ shadow: true, shDist: 0, shBlur: 45, shColor: '#FF25CE80' }))).toMatchObject({
      glow: { on: true, color: '#FF25CE', intensity: 50.2, range: 50 },
      dropShadow: { on: false },
    });
    expect(lookStyle(look({ shadow: true, shDist: 5, shAngle: 90, shBlur: 10, shColor: '#000000ff' }))).toMatchObject({
      dropShadow: { on: true, distance: 0.05, rotation: 90, blur: 0.1, color: '#000000', opacity: 1 },
      glow: { on: false },
    });
  });

  it('画廊里的 look 卡：Lime 的替身字体、Vegas 的粉色描边', () => {
    expect(preset('lime').style).toMatchObject({ fontFamily: 'Poppins', fontWeight: 900, fontColor: '#232323', backgroundColor: '#B6FF60FF' });
    expect(preset('vegas').style).toMatchObject({
      textOutline: { on: true, color: '#ff98e9', width: 3.75 },
      dropShadow: { on: true, color: '#FF25CE', opacity: 1 },
    });
  });

  it('经典与 Shorts 照旧版 classic_look / shorts_look，不带字号', () => {
    expect(preset('classic').style).toMatchObject({
      fontFamily: 'system',
      bold: true,
      fontColor: '#FFFFFF',
      background: false,
      textOutline: { on: true, color: '#000000', width: 14 },
      dropShadow: { on: true, blur: 0.12, distance: 0.08, rotation: 45, color: '#000000', opacity: 0.9 },
    });
    expect(preset('shorts').style).toMatchObject({
      fontWeight: 800,
      lineHeight: 1.1,
      textOutline: { width: 17.5 },
      dropShadow: { rotation: 90, distance: 0.06, blur: 0.1 },
    });
  });
});

describe('套用', () => {
  const body = {
    schema: STUDIO,
    style: {
      x: 50,
      y: 82,
      fontSize: 34,
      order: 'orig',
      fontFamily: 'Inter',
      fontStyle: 'italic',
      bgOn: true,
      origStyle: { fontSize: 28, fontColor: '#FF0000' },
      transStyle: { fontColor: '#00FF00' },
    },
    extra: 1,
  };

  it('全部：涂装整组换掉，落位、字号、次序与正文别的字段不动；覆盖里的涂装清掉', () => {
    const next = applyPreset(body, preset('karl'), 'all');
    const style = next.style as Json;
    expect(next.extra).toBe(1);
    expect(next.schema).toBe(STUDIO);
    expect(style).toMatchObject({ x: 50, y: 82, fontSize: 34, order: 'orig', fontFamily: 'Poppins', textTransform: 'uppercase' });
    expect(style.fontStyle).toBe('normal');
    expect(style.bgOn).toBeUndefined();
    expect(style.origStyle).toEqual({ fontSize: 28 });
    expect(style.transStyle).toBeUndefined();
    expect(presetOn(style, preset('karl'), ['original', 'translation'])).toBe(true);
    expect(currentPreset(style, ['original', 'translation'])?.id).toBe('karl');
  });

  it('改过一项就不算这张卡了', () => {
    const style = applyPreset(body, preset('karl'), 'all').style as Json;
    expect(presetOn({ ...style, fontColor: '#123456' }, preset('karl'), ['original'])).toBe(false);
    expect(currentPreset({ ...style, fontColor: '#123456' }, ['original'])).toBeNull();
  });

  it('只给译文：写进 transStyle，根上有、卡上没有的涂装键写 null，原文不动', () => {
    const next = applyPreset(body, preset('lime'), 'translation');
    const style = next.style as Json;
    expect(style.fontFamily).toBe('Inter');
    expect(style.origStyle).toEqual(body.style.origStyle);
    const trans = style.transStyle as Json;
    expect(trans.fontFamily).toBe('Poppins');
    expect(trans.bgOn).toBeNull();
    expect(mergedLineStyle(style, 'translation').fontStyle).toBe('normal');
    expect(presetOn(style, preset('lime'), ['translation'])).toBe(true);
    expect(presetOn(style, preset('lime'), ['original'])).toBe(false);
    expect(presetOn(style, preset('lime'), ['original', 'translation'])).toBe(false);
  });

  it('只给原文：覆盖里的字号留着', () => {
    const style = applyPreset(body, preset('ali'), 'original').style as Json;
    expect((style.origStyle as Json).fontSize).toBe(28);
    expect(presetOn(style, preset('ali'), ['original'])).toBe(true);
  });

  it('默认预设（规范 §5.6）是「经典」涂装，逗号句号照原文画；画廊里亮的是「经典」', () => {
    const style = DEFAULT_CAPTION_STYLE.style as Json;
    expect(DEFAULT_CAPTION_STYLE.schema).toBe(STUDIO);
    expect(style).toEqual({ ...preset('classic').style, punct: true });
    expect(style.textOutline).toEqual({ on: true, color: '#000000', width: 14 });
    expect(currentPreset(style, ['original', 'translation'])?.id).toBe('classic');
  });

  it('没有样式文档时从空样式套', () => {
    const next = applyPreset(undefined, preset('classic'), 'all');
    expect(next.schema).toBe(STUDIO);
    expect(presetOn(next.style as Json, preset('classic'), ['original'])).toBe(true);
  });
});

describe('套到哪份样式', () => {
  const chip = (key: string, kind: CaptionChip['kind'], extra: Partial<CaptionChip> = {}): CaptionChip => ({
    key,
    documentId: key,
    trackId: 't',
    itemIds: [key],
    kind,
    label: kind,
    name: key,
    state: 'on',
    locked: false,
    ...extra,
  });

  it('选中那条的样式；它没有时取画面上别的在用的；拿下的不算', () => {
    const chips = [chip('a', 'original'), chip('b', 'translation', { styleDocumentId: 's' }), chip('c', 'original', { state: 'shelved', styleDocumentId: 'z' })];
    expect(galleryTarget(chips, 'a')).toEqual({ styleDocumentId: 's', kinds: ['original', 'translation'] });
    expect(galleryTarget([chip('a', 'original')], null)).toEqual({ styleDocumentId: null, kinds: ['original'] });
  });

  it('另一条用着别的样式：不算进这份管的行', () => {
    const chips = [chip('a', 'original', { styleDocumentId: 's' }), chip('b', 'translation', { styleDocumentId: 'u' })];
    expect(galleryTarget(chips, 'a')).toEqual({ styleDocumentId: 's', kinds: ['original'] });
    expect(galleryTarget(chips, 'b')).toEqual({ styleDocumentId: 'u', kinds: ['translation'] });
  });
});

describe('事务', () => {
  const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };
  const track = (id: string, locked = false): Track => ({
    id,
    order: 1,
    kind: 'subtitle',
    locked,
    visible: true,
    muted: false,
    solo: { enabled: false, group: 'visual' },
  });
  const caption = (id: string, trackId: string, extra: Partial<CaptionItem> = {}): CaptionItem => ({
    ...base,
    id,
    trackId,
    type: 'caption',
    span: { fromFrame: 0, durationFrames: 30 },
    documentId: 'cap',
    ...extra,
  });
  const sequence = (tracks: Track[], items: Sequence['items']): Sequence => ({
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps: { num: 30, den: 1 },
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks,
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  });
  const seq = sequence(
    [track('t1'), track('t2', true)],
    [caption('c1', 't1'), caption('c2', 't1', { locked: true }), caption('c3', 't2'), caption('c4', 't1', { styleDocumentId: 's' })],
  );

  it('没有样式文档：新建一份，挂给还没有样式、没锁的字幕', () => {
    expect(captionStyleOperations(seq, undefined, { schema: STUDIO, style: {} })).toEqual([
      { type: 'putDocument', ref: 'style', kind: 'caption-style', name: '字幕样式', body: { schema: STUDIO, style: {} } },
      { type: 'setCaptionStyle', sequenceId: 'seq', itemId: 'c1', styleDocument: { ref: 'style' } },
    ]);
  });

  it('有样式文档：写新版本，没样式的也挂上', () => {
    const record: DocumentRecord = { id: 's', kind: 'caption-style', name: '字幕样式', currentRevision: '1', revisions: {} };
    expect(captionStyleOperations(seq, record, { schema: STUDIO, style: {} })).toEqual([
      { type: 'putDocument', documentId: 's', kind: 'caption-style', body: { schema: STUDIO, style: {} } },
      { type: 'setCaptionStyle', sequenceId: 'seq', itemId: 'c1', styleDocument: { documentId: 's' } },
    ]);
  });
});

describe('缩略图', () => {
  it('居中、固定字号；双语按次序给样张：上行英文、下行中文', () => {
    const root = { x: 10, y: 90, width: 40, fontSize: 60, verticalAlign: 'bottom', scale: 2, transStyle: { fontSize: 50, fontColor: '#fff' } };
    const scene = thumbScene(root, ['original', 'translation'], { width: 160, height: 66 }, 13);
    expect(scene.root).toMatchObject({ x: 50, y: 50, verticalAlign: 'center', fontSize: 30 });
    // 双语时大的那一行是译文：30 × 20/30 × 32/20 = 32
    expect(scene.root.scale).toBeCloseTo((13 * 540) / (32 * 66));
    expect(thumbScene({}, ['original'], { width: 160, height: 66 }, 13).root.scale).toBeCloseTo((13 * 540) / (30 * 66));
    expect(scene.root.transStyle).toEqual({ fontColor: '#fff' });
    expect(scene.bilingual).toBe(true);
    expect(scene.lines).toEqual([
      { kind: 'original', text: '词是真相' },
      { kind: 'translation', text: 'Words are truth' },
    ]);
    const swapped = thumbScene({ order: 'orig' }, ['original', 'translation'], { width: 160, height: 66 }, 13);
    expect(swapped.lines.find((l) => l.kind === 'original')?.text).toBe('Words are truth');
    expect(thumbScene({}, ['translation'], { width: 88, height: 48 }, 10).lines).toEqual([{ kind: 'translation', text: 'Words are truth' }]);
  });
});
