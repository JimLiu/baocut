import { STUDIO_STYLE, asObject, isObject, mergedLineStyle, num, type Json, type LineKind } from '../render/text-style.ts';

/**
 * 字幕属性页的「原文 | 译文」（原型 panel-subprops.jsx 的每轨属性、model-substyle.js 的比例链）：原文与译文共用一份
 * Studio 字幕样式（预览按样式文档把两行叠成一组），各自的不同写在 `origStyle` / `transStyle` 覆盖里——渲染内核
 * （`crates/subtitle-render` 的 `merged_line_style`）与这里量框用的 render/text-style.ts `mergedLineStyle` 都是根样式叠上覆盖，
 * 覆盖里的 null 当没设。
 *
 * 字号走比例链（与 `resolveLineStyle` 同一算法）：根字号是 30 号口径；双语时原文 = 根字号 × 双语压缩
 * （`bilingualOrigScale`，缺省 20/30），译文 = 根字号 × 双语压缩 × `transScale`（缺省 32/20）。覆盖里写了 `fontSize`
 * 的那一行用它，不跟比例。
 */

/** 与 render/text-style.ts 的缺省同值（那边没有导出）。 */
export const ROOT_FONT_SIZE = 30;
export const BILINGUAL_ORIG_SCALE = 20 / 30;
export const TRANSLATION_RATIO = 32 / 20;

export const LINE_STYLE_KEY: Record<LineKind, 'origStyle' | 'transStyle'> = { original: 'origStyle', translation: 'transStyle' };

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** 正文别的字段原样保留，`style` 根对象整个换掉（`patchCaptionStyle` 是浅补丁，删不掉键）。 */
export function withCaptionStyle(body: unknown, style: Json): Json {
  return { ...asObject(body), schema: STUDIO_STYLE, style };
}

export interface LineSize {
  /** 这一行画出来的字号（30 号口径）。 */
  size: number;
  /** 覆盖里单独写了字号，不跟比例。 */
  explicit: boolean;
  /** 根字号、双语压缩、译文比例。 */
  root: number;
  bi: number;
  k: number;
  /** 原文行的有效字号（比例链的中间那一环）。 */
  orig: number;
}

/** 一行的有效字号。`compact` 是原文与译文叠在一组里（原文按双语压缩缩小）。 */
export function lineSize(root: Json, kind: LineKind, compact: boolean): LineSize {
  const base = Math.max(1, num(root.fontSize, ROOT_FONT_SIZE));
  const bi = Math.max(0.1, num(root.bilingualOrigScale, BILINGUAL_ORIG_SCALE));
  const k = Math.max(0.1, num(root.transScale, TRANSLATION_RATIO));
  const partial = root[LINE_STYLE_KEY[kind]];
  const explicit = isObject(partial) && typeof partial.fontSize === 'number';
  const orig = compact ? base * bi : base;
  const computed = kind === 'translation' ? base * bi * k : orig;
  return { size: explicit ? Math.max(1, partial.fontSize as number) : computed, explicit, root: base, bi, k, orig };
}

/** 属性页上显示的这一行：根样式叠上覆盖，字号换成这一行的有效字号。 */
export function lineView(root: Json, kind: LineKind, compact: boolean): Json {
  return { ...mergedLineStyle(root, kind), fontSize: Math.round(lineSize(root, kind, compact).size * 10) / 10 };
}

/**
 * 「文字样式」里的一笔修改（`TextStyleEditor` 给的根对象补丁）落进样式之后的根对象。
 * - `own`（双语时选了原文或译文）：写进那一行的覆盖。字号没单独设时按比例链落回去：原文改根字号（÷ 双语压缩，译文跟着按比例变），
 *   译文改 `transScale`。
 * - 不是 `own`（这份样式只管一种行）：写根样式，那一行覆盖里的同名键去掉（不然改了看不见）；字号同样换算回根字号。
 * 覆盖里单独写了字号的，字号改的是那个单独值。
 */
export function editLine(root: Json, patch: Json, kind: LineKind, own: boolean, compact: boolean): Json {
  const key = LINE_STYLE_KEY[kind];
  const { fontSize, ...rest } = patch;
  const size = lineSize(root, kind, compact);
  const next: Json = { ...root };
  const partial = isObject(root[key]) ? { ...root[key] } : null;
  if (own) {
    next[key] = { ...(partial ?? {}), ...rest };
  } else {
    Object.assign(next, rest);
    if (partial) {
      for (const name of Object.keys(rest)) delete partial[name];
      if (Object.keys(partial).length) next[key] = partial;
      else delete next[key];
    }
  }
  if (typeof fontSize === 'number') {
    if (size.explicit) next[key] = { ...asObject(next[key]), fontSize };
    else if (kind === 'translation' && own) next.transScale = round(fontSize / (size.root * size.bi));
    else if (kind === 'translation') next.fontSize = round(fontSize / (size.bi * size.k));
    else next.fontSize = round(compact ? fontSize / size.bi : fontSize);
  }
  return next;
}

/**
 * 双语两行一起选中（舞台上框选或 ⇧ 点选了同一份样式的原文与译文）时的一笔修改：写根样式，两行覆盖里的同名键都去掉
 * （不然那一行看不见这一笔）。字号按原文行算（显示的也是原文行的有效字号）：换算回根字号，两行覆盖里单独设的字号去掉，
 * 译文跟比例。
 */
export function editBlock(root: Json, patch: Json): Json {
  const { fontSize, ...rest } = patch;
  const next: Json = { ...root, ...rest };
  const keys = typeof fontSize === 'number' ? [...Object.keys(rest), 'fontSize'] : Object.keys(rest);
  for (const key of Object.values(LINE_STYLE_KEY)) {
    if (!isObject(root[key])) continue;
    const partial = { ...root[key] };
    for (const name of keys) delete partial[name];
    if (Object.keys(partial).length) next[key] = partial;
    else delete next[key];
  }
  if (typeof fontSize === 'number') next.fontSize = round(fontSize / lineSize(root, 'original', true).bi);
  return next;
}

/** 这一行覆盖里单独设了几项（null 是「盖掉根样式的值」，也算）。 */
export function lineOverrides(root: Json, kind: LineKind): number {
  const partial = root[LINE_STYLE_KEY[kind]];
  return isObject(partial) ? Object.keys(partial).length : 0;
}

/** 这一行全部跟随共用样式：去掉它的覆盖。 */
export function followShared(root: Json, kind: LineKind): Json {
  const next = { ...root };
  delete next[LINE_STYLE_KEY[kind]];
  return next;
}

/** 这一行的字号改回跟比例：去掉覆盖里的 `fontSize`。 */
export function followRatio(root: Json, kind: LineKind): Json {
  const key = LINE_STYLE_KEY[kind];
  const partial = isObject(root[key]) ? { ...root[key] } : null;
  if (!partial) return root;
  delete partial.fontSize;
  const next = { ...root };
  if (Object.keys(partial).length) next[key] = partial;
  else delete next[key];
  return next;
}
