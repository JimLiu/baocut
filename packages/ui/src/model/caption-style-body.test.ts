import { describe, expect, it } from 'vitest';
import type { Json } from '../render/text-style.ts';
import { CAPTION_PRESETS, PAINT_KEYS, WORD_KEYS, presetStyle } from './caption-presets.ts';
import { CELL_KEYS, fromCell, parseWordAnimation, toCell, wordAnimationOf } from './caption-word-animation.ts';
import { compileCaptionStyle, editCaptionStyle, parseStudioStyle, type CaptionStyleBody, type CompileContext } from './caption-style-body.ts';
import FIXTURE from './caption-style-body.fixture.json';

const SOURCE: CompileContext = { role: 'source', hasWordTiming: true };
const TRANSLATION: CompileContext = { role: 'translation', hasWordTiming: false };
const preset = (id: string) => CAPTION_PRESETS.find((p) => p.id === id)!;
const pick = (style: Json, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in style).map((k) => [k, style[k]]));

/** 内核 `textMotion` 的取值域（`deny_unknown_fields`：一项不合法整份丢掉）。 */
function expectValidTextMotion(tm: unknown, id: string) {
  if (tm === undefined) return;
  const t = tm as Json;
  expect(Object.keys(t).every((k) => ['version', 'in', 'out', 'loop', 'emphasis', 'karaoke'].includes(k)), id).toBe(true);
  expect(t.version).toBe(1);
  for (const stage of ['in', 'out', 'loop']) {
    const e = t[stage] as Json | undefined;
    if (!e) continue;
    expect(Object.keys(e).every((k) => ['preset', 'unit', 'durationSeconds', 'staggerSeconds', 'intensity', 'easing', 'order', 'seed'].includes(k)), id).toBe(true);
    expect(['cue', 'line', 'word', 'grapheme']).toContain(e.unit);
    expect(e.durationSeconds as number).toBeGreaterThanOrEqual(0.001);
    expect(e.intensity as number).toBeLessThanOrEqual(2);
  }
  const emphasis = t.emphasis as Json | undefined;
  if (emphasis) expect(emphasis.color).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
  const karaoke = t.karaoke as Json | undefined;
  if (karaoke) expect(karaoke.color).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
}

describe('当前词 ↔ 逐词动画目录', () => {
  it('目录 19 格往返：格 → activeWord → wordAnimation → 解析回同一格、同一份载荷', () => {
    expect(CELL_KEYS).toHaveLength(19);
    for (const cell of CELL_KEYS) {
      const { activeWord, entrance } = fromCell(cell);
      const payload = wordAnimationOf(activeWord, entrance);
      expect(payload.catalogId, cell).toBe(cell);
      const back = parseWordAnimation({ wordAnimation: payload });
      expect(toCell(back.activeWord, back.entrance), cell).toBe(cell);
      expect(wordAnimationOf(back.activeWord, back.entrance), cell).toEqual(payload);
    }
  });

  it('没有 wordAnimation 时照内核：变色，色取 karaokeColor，再退回 #8CAAFF', () => {
    expect(parseWordAnimation({}).activeWord).toMatchObject({ mode: 'color', color: '#8CAAFF' });
    expect(parseWordAnimation({ karaokeColor: '#123456' }).activeWord).toMatchObject({ mode: 'color', color: '#123456' });
  });
});

describe('预设编译', () => {
  it('43 份都编译得出，textMotion 落在内核的取值域里；每份都写 wordAnimation', () => {
    expect(CAPTION_PRESETS).toHaveLength(43);
    for (const p of CAPTION_PRESETS) {
      for (const ctx of [SOURCE, TRANSLATION]) {
        const style = compileCaptionStyle(p.body, ctx);
        expect(style.wordAnimation, p.id).toBeDefined();
        expectValidTextMotion(style.textMotion, p.id);
      }
    }
  });

  it('42 份涂装与现有涂装逐键相等（31 份 look、9 份 Studio、经典与 Shorts）', () => {
    const fixture = FIXTURE as Record<string, Json>;
    expect(Object.keys(fixture)).toHaveLength(42);
    for (const [id, paint] of Object.entries(fixture)) expect(preset(id).style, id).toEqual(paint);
  });

  it('编译 → 解析 → 编译不变（套卡写进去的键）', () => {
    for (const p of CAPTION_PRESETS) {
      for (const kind of ['original', 'translation'] as const) {
        const style = presetStyle(p, kind);
        expect(compileCaptionStyle(parseStudioStyle(style), SOURCE), `${p.id}/${kind}`).toEqual(style);
      }
    }
  });

  it('旧样式（不认识的键、旧别名）解析再编译逐键回原值', () => {
    const root = { x: 50, y: 82, fontSize: 34, order: 'orig', fontFamily: 'Inter', fontStyle: 'italic', bgOn: true, anim: { name: 'Bounce' }, karaokeColor: '#FF0000', origStyle: { fontSize: 28 } };
    expect(compileCaptionStyle(parseStudioStyle(root), SOURCE)).toEqual(root);
  });
});

describe('维度互不牵连', () => {
  const root = presetStyle(preset('studio-focus'));

  it('改当前词不动涂装键', () => {
    const next = editCaptionStyle(root, (b) => ({ ...b, activeWord: { ...b.activeWord, mode: 'box', box: { color: '#00FF00', radius: 0.2, padding: [0.2, 0.08] } } }));
    expect(pick(next, PAINT_KEYS)).toEqual(pick(root, PAINT_KEYS));
    expect(next.wordAnimation).not.toEqual(root.wordAnimation);
  });

  it('改涂装不动词级键', () => {
    const next = editCaptionStyle(root, (b) => ({ ...b, surface: { ...b.surface, color: '#00FF00' } }));
    expect(next.fontColor).toBe('#00FF00');
    expect(pick(next, WORD_KEYS)).toEqual(pick(root, WORD_KEYS));
  });

  it('改动效不动涂装与当前词', () => {
    const next = editCaptionStyle(root, (b): CaptionStyleBody => ({
      ...b,
      motion: { in: { preset: 'pop', unit: 'word', trigger: 'enter', durationSeconds: 0.24, staggerSeconds: 0.05, intensity: 1, easing: 'easeOutQuad' } },
    }));
    expect(pick(next, PAINT_KEYS)).toEqual(pick(root, PAINT_KEYS));
    expect(next.wordAnimation).toEqual(root.wordAnimation);
    expect((next.textMotion as Json).in).toMatchObject({ preset: 'pop', unit: 'word' });
  });
});

describe('译文', () => {
  it('当前词恒 none、不扫色、念到时的入场丢掉；出现时的动效留着', () => {
    for (const id of ['studio-ktv', 'karl', 'phantom', 'studio-focus']) {
      const style = compileCaptionStyle(preset(id).body, TRANSLATION);
      expect((style.wordAnimation as Json).catalogId, id).toBe('none');
      expect((style.textMotion as Json | undefined)?.karaoke, id).toBeUndefined();
      expect((style.textMotion as Json | undefined)?.emphasis, id).toBeUndefined();
    }
    expect((compileCaptionStyle(preset('studio-word-drop').body, TRANSLATION).textMotion as Json).in).toMatchObject({ preset: 'cascade' });
  });

  it('没有词级时间的原文同译文', () => {
    const style = compileCaptionStyle(preset('studio-ktv').body, { role: 'source', hasWordTiming: false });
    expect((style.wordAnimation as Json).catalogId).toBe('none');
  });
});

describe('倒鸭子信封', () => {
  it('caption 挂在 wordAnimation 下、不带 catalogId；接管要 content orig 与 style.version 1', () => {
    const style = compileCaptionStyle(preset('daoyazi').body, SOURCE);
    const wa = style.wordAnimation as Json;
    expect(wa.catalogId).toBeUndefined();
    expect(style.anim).toBeUndefined();
    expect(wa.caption).toMatchObject({ content: 'orig', style: { id: 'caption-daoyazi', version: 1 }, intensity: 60, speed: 1 });
    const options = (wa.caption as Json).options as Json[];
    expect(options[0]).toMatchObject({ key: 'daoyazi' });
    expect(typeof options[0]!.value).toBe('object');
  });

  it('强调词外观的放大夹在 0.8–1.6', () => {
    const body = { ...preset('classic').body, emphasis: { scale: 3 } };
    expect((compileCaptionStyle(body, SOURCE).emphasisLook as Json).scale).toBe(1.6);
  });
});
