import type { CaptionPresentation, CaptionSceneAdjust, CaptionSceneStyleBody, EditOperation, Sequence } from '@baocut/protocol';

/**
 * 模板字幕样式（`baocut.caption-scene-style/1`）的调整层与实例数据（视频格式规范 §5.6「模板调整与来源」，
 * 字幕编辑器重设计 §5、§11）。调整页只改 `adjust`（场景本身不动）与字幕实例的 `presentation`（关键词、seed）；
 * 能调什么由核心的场景摘要（`captionSceneSummary`）说了算，这里不读场景。
 */

export const SCENE_STYLE_SCHEMA = 'baocut.caption-scene-style/1';
export const MIN_FONT_SCALE = 0.5;
export const MAX_FONT_SCALE = 2;
/** 模板读的「关键词」词标签。 */
export const KEYWORD_TAG = 'keyword';
const ZERO_SEED = '0000000000000000';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function isSceneStyle(body: unknown): body is CaptionSceneStyleBody {
  return isObject(body) && body.schema === SCENE_STYLE_SCHEMA && isObject(body.scene);
}

/** `#RRGGBB` / `#RRGGBBAA` → `#RRGGBBAA`（大写）；别的写法返回 null（与核心同一个判法）。 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return null;
  const hex = value.slice(1).toUpperCase();
  return `#${hex.length === 6 ? `${hex}FF` : hex}`;
}

/** 换色的结果：`to` 只写 `#RRGGBB` 时保留原色的透明度。 */
function swapped(from: string, to: string): string | null {
  const target = normalizeColor(to);
  if (!target) return null;
  return to.length === 7 ? `${target.slice(0, 7)}${from.slice(7)}` : target;
}

/** 去掉不起作用的项：换成原色的颜色、没目标的字体、1 倍字号、空位置。全空返回 null（「模板原样」）。 */
export function cleanAdjust(adjust: CaptionSceneAdjust | null | undefined): CaptionSceneAdjust | null {
  if (!adjust) return null;
  const out: CaptionSceneAdjust = {};
  const colors = (adjust.colors ?? []).flatMap((c) => {
    const from = normalizeColor(c.from);
    const to = from ? swapped(from, c.to) : null;
    return from && to && to !== from ? [{ from, to: c.to }] : [];
  });
  if (colors.length) out.colors = colors;
  const fonts = (adjust.fonts ?? []).filter((f) => f.from && f.to?.family);
  if (fonts.length) out.fonts = fonts;
  const scale = adjust.fontScale;
  if (typeof scale === 'number' && Number.isFinite(scale)) {
    const s = Math.round(Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, scale)) * 100) / 100;
    if (s !== 1) out.fontScale = s;
  }
  const placement: NonNullable<CaptionSceneAdjust['placement']> = {};
  for (const key of ['x', 'y', 'width'] as const) {
    const v = adjust.placement?.[key];
    if (typeof v === 'number' && Number.isFinite(v)) placement[key] = Math.min(1, Math.max(key === 'width' ? 0.01 : 0, v));
  }
  if (Object.keys(placement).length) out.placement = placement;
  return Object.keys(out).length ? out : null;
}

/** 把模板里的 `from`（摘要的颜色键）换成 `to`；`to` 为 null 退回原色。 */
export function withColor(adjust: CaptionSceneAdjust | null, from: string, to: string | null): CaptionSceneAdjust | null {
  const key = normalizeColor(from);
  const rest = (adjust?.colors ?? []).filter((c) => normalizeColor(c.from) !== key);
  return cleanAdjust({ ...adjust, colors: to && key ? [...rest, { from: key, to }] : rest });
}

/** 把摘要里的字体 `key` 换成 `to`；`to` 为 null 退回模板的字体。 */
export function withFont(
  adjust: CaptionSceneAdjust | null,
  key: string,
  to: { family: string; weight?: number; italic?: boolean } | null,
): CaptionSceneAdjust | null {
  const rest = (adjust?.fonts ?? []).filter((f) => f.from !== key);
  return cleanAdjust({ ...adjust, fonts: to ? [...rest, { from: key, to }] : rest });
}

export function withScale(adjust: CaptionSceneAdjust | null, fontScale: number): CaptionSceneAdjust | null {
  return cleanAdjust({ ...adjust, fontScale });
}

/** 改位置的一项（0–1 的画布比例）；给 null 去掉这一项（回到模板的位置）。 */
export function withPlacement(adjust: CaptionSceneAdjust | null, key: 'x' | 'y' | 'width', value: number | null): CaptionSceneAdjust | null {
  const placement = { ...adjust?.placement };
  if (value === null) delete placement[key];
  else placement[key] = value;
  return cleanAdjust({ ...adjust, placement });
}

/** 写回正文：调整为空时删掉 `adjust`（还原就是这一步）。 */
export function withAdjust(body: CaptionSceneStyleBody, adjust: CaptionSceneAdjust | null): CaptionSceneStyleBody {
  const { adjust: _old, ...rest } = body;
  const next = cleanAdjust(adjust);
  return next ? { ...rest, adjust: next } : rest;
}

export const isAdjusted = (body: CaptionSceneStyleBody): boolean => cleanAdjust(body.adjust) !== null;

/* ---------- 字幕实例的 presentation：关键词与 seed ---------- */

/** 标了某个词标签的词 ID。 */
export function taggedWords(presentation: CaptionPresentation | undefined, tag: string = KEYWORD_TAG): Set<string> {
  const out = new Set<string>();
  for (const [id, tags] of Object.entries(presentation?.wordTags ?? {})) if (tags.includes(tag)) out.add(id);
  return out;
}

/** 空的（没有参数、覆盖、词标签，seed 为零）返回 null：引擎把它去掉。 */
function cleanPresentation(p: CaptionPresentation): CaptionPresentation | null {
  const out: CaptionPresentation = {};
  if (p.parameters && Object.keys(p.parameters).length) out.parameters = p.parameters;
  if (p.cueOverrides?.length) out.cueOverrides = p.cueOverrides;
  const tags = Object.entries(p.wordTags ?? {}).filter(([, list]) => list.length);
  if (tags.length) out.wordTags = Object.fromEntries(tags);
  if (p.seed && p.seed !== ZERO_SEED) out.seed = p.seed;
  return Object.keys(out).length ? out : null;
}

/** 给一个词加上（`on`）或去掉词标签；别的标签与实例数据不动。 */
export function setWordTag(presentation: CaptionPresentation | undefined, wordId: string, on: boolean, tag: string = KEYWORD_TAG): CaptionPresentation | null {
  const tags = { ...presentation?.wordTags };
  const own = (tags[wordId] ?? []).filter((t) => t !== tag);
  tags[wordId] = on ? [...own, tag] : own;
  return cleanPresentation({ ...presentation, wordTags: tags });
}

/** 第几版（seed 的数值，从 0 起）。 */
export function seedIndex(presentation: CaptionPresentation | undefined): number {
  const value = Number.parseInt(presentation?.seed ?? ZERO_SEED, 16);
  return Number.isSafeInteger(value) ? value : 0;
}

/** 「换一版」的下一个 seed：数值加一（16 位十六进制）。 */
export function seedAfter(presentation: CaptionPresentation | undefined): string {
  return ((seedIndex(presentation) + 1) % 0x1_0000_0000).toString(16).padStart(16, '0');
}

/** 换上 seed；别的实例数据不动。 */
export function withSeed(presentation: CaptionPresentation | undefined, seed: string): CaptionPresentation | null {
  return cleanPresentation({ ...presentation, seed });
}

/**
 * 模板被内置样式整份换掉时，挂在这些样式上的字幕实例要在同一笔里去掉 `presentation`：
 * 关键词与 seed 只对模板起作用，不是模板的样式带着它画不出来（视频格式规范 §5.6）。
 */
export function dropPresentations(sequence: Sequence, styleDocumentIds: ReadonlySet<string>): EditOperation[] {
  return sequence.items.flatMap((item): EditOperation[] =>
    item.type === 'caption' && item.presentation && item.styleDocumentId && styleDocumentIds.has(item.styleDocumentId)
      ? [{ type: 'setCaptionPresentation', sequenceId: sequence.id, itemId: item.id, presentation: null }]
      : [],
  );
}

/* ---------- 关键词点词：一句字幕的转写词 ---------- */

/** 点词用的一个词：转写里的词 ID 与去掉首尾空白的文字。 */
export interface CueWord {
  id: string;
  text: string;
}

/**
 * 字幕文档里一句的词（视频格式规范 §3.8「句子的词」）：按句子的 `words`（`{first, last}` 或 `{wordIds}`）到转写里取，
 * 跳过隐藏的与空白的。词标签按整个词写，多字的 CJK 词拆字画时由渲染器落到每个字上。句子没写 `words`、
 * 转写不在或认不出时返回 null（译文与导入的字幕没有词）。
 */
export function cueWords(captionBody: unknown, speechBody: unknown, cueId: string): CueWord[] | null {
  if (!isObject(captionBody) || !Array.isArray(captionBody.cues)) return null;
  if (!isObject(speechBody) || speechBody.schema !== 'baocut.speech/1' || !Array.isArray(speechBody.words)) return null;
  const cue = captionBody.cues.filter(isObject).find((c, index) => (typeof c.id === 'string' ? c.id : `cue-${index}`) === cueId);
  const ref = cue && isObject(cue.words) ? cue.words : null;
  if (!ref) return null;
  const words = speechBody.words.filter(isObject);
  const at = new Map<string, number>();
  words.forEach((w, i) => typeof w.id === 'string' && at.set(w.id, i));
  let members: number[];
  if (Array.isArray(ref.wordIds)) {
    members = ref.wordIds.flatMap((id) => {
      const i = typeof id === 'string' ? at.get(id) : undefined;
      return i === undefined ? [] : [i];
    });
  } else {
    const first = at.get(typeof ref.first === 'string' ? ref.first : '');
    const last = at.get(typeof ref.last === 'string' ? ref.last : '');
    if (first === undefined || last === undefined || first > last) return null;
    members = Array.from({ length: last - first + 1 }, (_, n) => first + n);
  }
  return members.flatMap((i) => {
    const w = words[i]!;
    const text = typeof w.text === 'string' ? w.text.trim() : '';
    return w.hidden === true || !text ? [] : [{ id: w.id as string, text }];
  });
}
