import { defineMessages, formatRef, LOCALES, type CaptionItem, type DocumentRecord, type EditOperation, type Id, type Sequence } from '@baocut/protocol';
import { STUDIO_STYLE, asObject, isObject, mergedLineStyle, type Json, type LineKind } from '../render/text-style.ts';
import type { CaptionChip } from './caption-tracks.ts';
import { LINE_STYLE_KEY, lineSize } from './caption-lines.ts';
import { CLASSIC_PAINT, LOOKS, PRESET_TABLE, SHORTS_PAINT, STUDIO_DESIGNS, completePaint, lookStyle, type PresetCategory } from './caption-preset-looks.ts';
import { DEFAULT_SEQUENCE } from './caption-sequence-style.ts';
import {
  CAPTION_STYLE_SCHEMA,
  PAINT_KEYS,
  PRESET_KEY,
  WORD_KEYS,
  compileCaptionStyle,
  keepOverrides,
  motionEffect,
  parseStudioStyle,
  sameKeys,
  type CaptionStyleBody,
  type CompileContext,
  type Motion,
  type MotionEffect,
  type MotionStage,
} from './caption-style-body.ts';
import { normalizeActive, type ActiveMode } from './caption-word-animation.ts';
import { zhHans } from './caption-presets.zh-Hans.ts';
import { zhHant } from './caption-presets.zh-Hant.ts';
import { ja } from './caption-presets.ja.ts';
import { ko } from './caption-presets.ko.ts';
import { es } from './caption-presets.es.ts';
import { fr } from './caption-presets.fr.ts';
import { de } from './caption-presets.de.ts';
import { nl } from './caption-presets.nl.ts';
import { ptBR } from './caption-presets.pt-BR.ts';
import { it } from './caption-presets.it.ts';
import { ru } from './caption-presets.ru.ts';
import { pl } from './caption-presets.pl.ts';
import { tr } from './caption-presets.tr.ts';
import { vi } from './caption-presets.vi.ts';

export { PAINT_KEYS, WORD_KEYS } from './caption-style-body.ts';
export { fontFamilyOf, lookStyle, type DesignLook, type PresetCategory } from './caption-preset-looks.ts';

/** 字幕样式画廊的文案（英文是键与类型的来源，译文在 `caption-presets.zh-Hans.ts`）。专名的卡（Shorts、Ali……）不进目录。 */
const en = {
  categories: {
    basic: 'Basic',
    social: 'Social',
    business: 'Business',
    retro: 'Retro',
    motion: 'Motion',
    kinetic: 'Kinetic type',
  } as Record<PresetCategory, string>,
  classic: 'Classic',
  simple: 'Simple',
  daoyazi: 'Kinetic Captions',
  studio: {
    'studio-focus': 'Spoken Emphasis',
    'studio-word-tiles': 'Word Tiles',
    'studio-word-drop': 'Word Drop',
    'studio-paper-typewriter': 'Typewriter',
    'studio-line-swipe': 'Line Swipe',
    'studio-soft-focus': 'Soft Focus',
    'studio-rise-settle': 'Rise & Settle',
    'studio-kinetic-wave': 'Kinetic Wave',
    'studio-ktv': 'Karaoke',
  } as Record<string, string>,
  styleDocument: 'Subtitle style',
};
export type CaptionPresetsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 流程新建的缺省字幕样式文档的名字（jobs 的 `jobsCaptionLayer.styleName`）：界面新建的与它同名。 */
const STYLE_NAME_REF = { key: 'jobsCaptionLayer.styleName' };

/** 新建的字幕样式文档叫什么（当前语言）。 */
export function defaultStyleName(): string {
  return formatRef(STYLE_NAME_REF, M.styleDocument);
}

/** 这个名字是不是缺省字幕样式的名字：哪种语言下建的都认（文档名按建它时的语言写进视频）。 */
export function isDefaultStyleName(name: string): boolean {
  return name === M.styleDocument || LOCALES.some((locale) => formatRef(STYLE_NAME_REF, '', locale) === name);
}


/**
 * 字幕样式画廊的预设（字幕样式模型设计 §7，原型 `BC_CS.presets()`）。
 *
 * 一份预设是新正文（`CaptionStyleBody`）七个维度各一个取值，外加分类：字体与涂装、当前词（`activeWord`，每份都显式写出）、
 * 动效（`motion`）、排版模式（倒鸭子是 `layout.mode: 'sequence'`）。套一张 = 把它编译成 Studio 样式（`compileCaptionStyle`），
 * 写进涂装键（`PAINT_KEYS`）与词级键（`WORD_KEYS`：`wordAnimation` / `textMotion` / `wordBackground` / `emphasisLook`
 * 与来源卡 `stylePreset`）；位置、字号、显示时机、双语次序与间距不动。
 *
 * 43 份：基础 3（经典、Shorts、简洁）、社交 20、商务 6、复古 6、动效 7、动态排版 1（倒鸭子）。涂装数据与当前词取值在
 * `caption-preset-looks.ts`。
 */

export interface CaptionPreset {
  id: string;
  name: string;
  category: PresetCategory;
  /** 这份预设的新正文（`preset` 记着它自己）。 */
  body: CaptionStyleBody;
  /** 编译出来的涂装（每个涂装键都给值）。 */
  style: Json;
}

/** 画廊的分区（§7，只按气质分）。 */
export const PRESET_GROUPS: readonly { key: PresetCategory; label: string }[] = (['basic', 'social', 'business', 'retro', 'motion', 'kinetic'] as const).map(
  (key) => ({
    key,
    get label() {
      return M.categories[key];
    },
  }),
);

/** 经典的涂装：默认预设（`DEFAULT_CAPTION_STYLE`）用它。 */
export const CLASSIC: Json = CLASSIC_PAINT;

const LAYOUT_BASE = { mode: 'line', anchor: 'bottom', y: 0.86, width: 0.8, maxLines: 2 } as const;
const SOURCE: CompileContext = { role: 'source', hasWordTiming: true };
const TRANSLATION: CompileContext = { role: 'translation', hasWordTiming: false };
const roleOf = (kind: LineKind): CompileContext => (kind === 'translation' ? TRANSLATION : SOURCE);

function pick(style: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const key of keys) if (key in style) out[key] = style[key];
  return out;
}

type PresetRow = (typeof PRESET_TABLE)[number];

/** 念到时入场的只写了预设名，按动效目录的默认补齐；出现时触发的照原样。 */
function presetMotion(row: PresetRow): Motion | undefined {
  if (!row.motion) return undefined;
  const out: Motion = {};
  for (const [stage, value] of Object.entries(row.motion) as [MotionStage, Partial<MotionEffect> & { preset: string }][]) {
    const spoken = Object.keys(value).length === 1;
    const effect = spoken ? motionEffect(stage, value.preset, { trigger: 'spoken', unit: 'word' }) : motionEffect(stage, value.preset, { ...value, trigger: 'enter' });
    if (effect) out[stage] = effect;
  }
  return out;
}

function presetPaint(id: string): { paint: Json; wordBox?: CaptionStyleBody['surface']['wordBox'] } {
  if (id === 'classic') return { paint: CLASSIC_PAINT };
  if (id === 'shorts') return { paint: SHORTS_PAINT };
  const design = STUDIO_DESIGNS.find((d) => d.id === id);
  if (design) return { paint: completePaint(design.style), wordBox: design.wordBox };
  // 倒鸭子借 Casper 的涂装（原型 `dz.look = 'casper'`）。
  const look = LOOKS.find((l) => l.id === (id === 'daoyazi' ? 'casper' : id))!;
  return { paint: lookStyle(look.look) };
}

function presetName(id: string): string {
  if (id === 'classic') return M.classic;
  if (id === 'simple') return M.simple;
  if (id === 'daoyazi') return M.daoyazi;
  if (id === 'shorts') return 'Shorts';
  return M.studio[id] ?? LOOKS.find((l) => l.id === id)?.name ?? id;
}

function buildPreset(row: PresetRow): CaptionPreset {
  const { paint, wordBox } = presetPaint(row.id);
  // 涂装照旧数据解析：编译不回原值的涂装键记进 legacy，套上去与旧涂装逐键相等；当前词、动效与落位由预设给。
  const parsed = keepOverrides(parseStudioStyle(paint), PAINT_KEYS);
  const body: CaptionStyleBody = {
    schema: CAPTION_STYLE_SCHEMA,
    typography: parsed.typography,
    surface: wordBox ? { ...parsed.surface, wordBox } : parsed.surface,
    layout:
      row.id === 'daoyazi'
        ? { ...LAYOUT_BASE, mode: 'sequence', sequence: DEFAULT_SEQUENCE }
        : row.id === 'shorts'
          ? { ...LAYOUT_BASE, y: 0.72, width: 0.6 }
          : { ...LAYOUT_BASE },
    activeWord: normalizeActive(row.activeWord),
    preset: { id: row.id, revision: 1 },
  };
  if (parsed.legacy) body.legacy = parsed.legacy;
  const motion = presetMotion(row);
  if (motion) body.motion = motion;
  let style: Json | null = null;
  return {
    id: row.id,
    get name() {
      return presetName(row.id);
    },
    category: row.category,
    body,
    get style() {
      return (style ??= pick(compileCaptionStyle(body, SOURCE), PAINT_KEYS));
    },
  };
}

/** 画廊的卡，按陈列次序。 */
export const CAPTION_PRESETS: readonly CaptionPreset[] = PRESET_TABLE.map(buildPreset);

/** 套这张卡写进样式的键（涂装 ＋ 词级）。`kind` 是落在哪一种行上：译文的当前词恒 none、念到时的入场不要。 */
export function presetStyle(preset: CaptionPreset, kind: LineKind = 'original'): Json {
  return pick(compileCaptionStyle(preset.body, roleOf(kind)), [...PAINT_KEYS, ...WORD_KEYS]);
}

/**
 * 「经典」卡的当前词（变色 #18E1D6）：默认预设（`DEFAULT_CAPTION_STYLE`，规范 §5.6）带上它，新字幕不套卡也与画廊里亮着的
 * 「经典」一致。流程（`packages/jobs/src/pipelines/caption-layer.ts`）与内核（`video_model::caption_style::default_studio_style`）
 * 各留一份同样的字面量，三处一起改。
 */
export const CLASSIC_WORD_ANIMATION: Json = presetStyle(CAPTION_PRESETS.find((p) => p.id === 'classic')!).wordAnimation as Json;

/** 分区陈列：按 `PRESET_GROUPS` 的次序，空区不出。 */
export function presetGroups(): { key: PresetCategory; label: string; presets: CaptionPreset[] }[] {
  return PRESET_GROUPS.map((g) => ({ key: g.key, label: g.label, presets: CAPTION_PRESETS.filter((p) => p.category === g.key) })).filter(
    (g) => g.presets.length > 0,
  );
}

/** 套到哪儿：`all` 是用这份样式的每一行；`original` / `translation` 只给那一行上妆（写进 `origStyle` / `transStyle`）。 */
export type PresetScope = 'all' | LineKind;

const REPLACED: readonly string[] = [...PAINT_KEYS, ...WORD_KEYS];

function withoutReplaced(style: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(style)) if (!REPLACED.includes(key)) out[key] = value;
  return out;
}

/**
 * 套一张卡之后的样式文档正文（同 `patchCaptionStyle`：正文别的字段原样保留）。
 * - `all`：根样式的涂装键与词级键整组换成这张卡编译出来的；`origStyle` / `transStyle` 里的这两组键清掉（字号这类覆盖留着），
 *   清空了就去掉。
 * - 一行：按这一行的角色编译（译文的当前词恒 none），写进那一行的覆盖；根样式上有、这张卡没有的键在覆盖里写 `null`
 *   （两个渲染器都把 null 当没设），免得根样式的旧值从底下透上来。另一行不动。
 */
export function applyPreset(body: unknown, preset: CaptionPreset, scope: PresetScope): Json {
  const doc = asObject(body);
  const root = asObject(doc.style);
  let next: Json;
  if (scope === 'all') {
    next = { ...withoutReplaced(root), ...presetStyle(preset, 'original') };
    for (const key of Object.values(LINE_STYLE_KEY)) {
      if (!(key in root)) continue;
      const rest = withoutReplaced(asObject(root[key]));
      if (Object.keys(rest).length) next[key] = rest;
      else delete next[key];
    }
  } else {
    const key = LINE_STYLE_KEY[scope];
    const style = presetStyle(preset, scope);
    const masked: Json = {};
    for (const name of REPLACED) if (name in root && !(name in style)) masked[name] = null;
    next = { ...root, [key]: { ...withoutReplaced(asObject(root[key])), ...masked, ...style } };
  }
  return { ...doc, schema: STUDIO_STYLE, style: next };
}

/** 一行叠完覆盖后的样式，null（遮掉根上的值）当没有。 */
function lineStyle(root: Json, kind: LineKind): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(mergedLineStyle(root, kind))) if (value !== null) out[key] = value;
  return out;
}

/** 这一行记着的来源卡（`stylePreset.id`）；没有记的是 null。 */
export function presetIdOf(root: Json, kind: LineKind): string | null {
  const id = asObject(lineStyle(root, kind)[PRESET_KEY]).id;
  return typeof id === 'string' ? id : null;
}

/** 来源卡记在根上（全部）还是那一行的覆盖里（只给一行），决定按哪种角色比。 */
function appliedKind(root: Json, kind: LineKind): LineKind {
  const own = root[LINE_STYLE_KEY[kind]];
  return isObject(own) && PRESET_KEY in own ? kind : 'original';
}

/**
 * 这张卡是不是这几行的来源卡：按记下的 `stylePreset.id` 判（改过别的维度仍算，旁边标「已修改」）；
 * 旧样式没有记来源卡时按涂装逐键比。
 */
export function presetOn(root: Json, preset: CaptionPreset, kinds: readonly LineKind[]): boolean {
  if (kinds.length === 0) return false;
  return kinds.every((kind) => {
    const id = presetIdOf(root, kind);
    if (id !== null) return id === preset.id;
    return sameKeys(lineStyle(root, kind), preset.style, Object.keys(preset.style));
  });
}

/**
 * 来源卡亮着、但这几行与它编译出来的已经不一样（原型「已修改 · 还原」）。只看记着这张卡的行：没记来源卡的旧样式
 * （比如缺省样式）是按涂装认出来的，词级键本来就没写，不算改过。
 */
export function presetModified(root: Json, preset: CaptionPreset, kinds: readonly LineKind[]): boolean {
  return kinds.some((kind) => presetIdOf(root, kind) === preset.id && !sameKeys(lineStyle(root, kind), presetStyle(preset, appliedKind(root, kind)), REPLACED));
}

/** 卡片角标：这张卡的当前词模式（倒鸭子是排版模式）。 */
export function presetBadge(preset: CaptionPreset): ActiveMode | 'sequence' {
  return preset.body.layout.mode === 'sequence' ? 'sequence' : preset.body.activeWord.mode;
}

/** 正套在这几行上的那张卡；混搭或没有时是 null。 */
export function currentPreset(root: Json, kinds: readonly LineKind[]): CaptionPreset | null {
  return CAPTION_PRESETS.find((preset) => presetOn(root, preset, kinds)) ?? null;
}

/**
 * 属性页改「当前词」「动效」「倒鸭子」这几个词级维度：这一行叠完覆盖的样式解析成正文、改、按这一行的角色编译，
 * 只回写词级键（`WORD_KEYS`），涂装、落位一个键都不动。写到哪儿：
 * - 原文：这张卡只套给了原文（`origStyle` 里记着来源卡）就写进 `origStyle`，否则写根样式；
 * - 译文：与原文叠成双语时写进 `transStyle`（根样式是两行共用的），只有译文时写根样式。
 * 写进覆盖时，根上有、编译结果没有的词级键写 null 遮掉。
 */
export function editWordStyle(root: Json, kind: LineKind, paired: boolean, edit: (body: CaptionStyleBody) => CaptionStyleBody): Json {
  const next = pick(compileCaptionStyle(edit(parseStudioStyle(lineStyle(root, kind))), roleOf(kind)), WORD_KEYS);
  const key = LINE_STYLE_KEY[kind];
  const own = asObject(root[key]);
  const intoLine = kind === 'translation' ? paired : PRESET_KEY in own;
  if (!intoLine) {
    const out = withoutWord(root);
    return { ...out, ...next };
  }
  const line: Json = withoutWord(own);
  for (const name of WORD_KEYS) {
    if (name in next) line[name] = next[name];
    else if (name in root) line[name] = null;
  }
  return { ...root, [key]: line };
}

/** 这一行现在的正文（属性页读当前词、动效与倒鸭子的取值）。 */
export function lineBody(root: Json, kind: LineKind): CaptionStyleBody {
  return parseStudioStyle(lineStyle(root, kind));
}

function withoutWord(style: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(style)) if (!WORD_KEYS.includes(key)) out[key] = value;
  return out;
}

/**
 * 画廊套到哪一份样式文档：轨条选中的那条用的；它还没有样式时取画面上别的字幕在用的那份；都没有是 null（套的时候新建）。
 * `kinds` 是套上去之后这份样式管的几种行：画面上用它的，加上还没有样式、会一起挂上来的。
 */
export function galleryTarget(chips: readonly CaptionChip[], selected: string | null): { styleDocumentId: Id | null; kinds: LineKind[] } {
  const showing = chips.filter((chip) => chip.state !== 'shelved');
  const current = showing.find((chip) => chip.key === selected) ?? showing[0] ?? null;
  const styleDocumentId = current?.styleDocumentId ?? showing.find((chip) => chip.styleDocumentId)?.styleDocumentId ?? null;
  const present = new Set(showing.filter((chip) => !chip.styleDocumentId || chip.styleDocumentId === styleDocumentId).map((chip) => chip.kind));
  return { styleDocumentId, kinds: (['original', 'translation'] as const).filter((kind) => present.has(kind)) };
}

/** 序列上还没有样式、能挂样式的字幕（锁住的实例与锁住轨道上的引擎会拒绝，跳过）。 */
function unstyledCaptions(sequence: Sequence): CaptionItem[] {
  const locked = new Set(sequence.tracks.filter((track) => track.locked).map((track) => track.id));
  return sequence.items.filter((item): item is CaptionItem => item.type === 'caption' && !item.styleDocumentId && !item.locked && !locked.has(item.trackId));
}

/**
 * 写一份字幕样式的事务（一笔撤销）：有样式文档就写它的新版本；没有就新建一份（ref `style`，同 inspector-caption）。
 * 两种情况都把还没有样式的字幕挂上这份——原文与译文用同一份样式才叠成双语两行（预览按样式文档分组）。
 */
export function captionStyleOperations(sequence: Sequence, record: DocumentRecord | undefined, body: Json): EditOperation[] {
  const target = record ? { documentId: record.id } : { ref: 'style' };
  const attach = unstyledCaptions(sequence).map(
    (item): EditOperation => ({ type: 'setCaptionStyle', sequenceId: sequence.id, itemId: item.id, styleDocument: target }),
  );
  const put: EditOperation = record
    ? { type: 'putDocument', documentId: record.id, kind: record.kind, body }
    : { type: 'putDocument', ref: 'style', kind: 'caption-style', name: defaultStyleName(), body };
  return [put, ...attach];
}

/** 画廊缩略图的英中样张（data.js `subtitle.sample` 的 thumb 那句；样张按位次给：上面那行英文、下面那行中文）。 */
// i18n-ignore: 双语样张，下面那行固定是中文，用来演示双语两行，不随界面语言
export const THUMB_SAMPLE = { main: 'Words are truth', sub: '词是真相' } as const;

/** 缩略图的灰底（原型 .sthumb 的 135° 渐变，左上到右下）：画在画布上的数据，不随界面主题变（原型也钉成浅色）。 */
export const THUMB_BACKDROP = ['#CFD2D6', '#A8ACB3'] as const;

/**
 * 缩略图用的样式与行：涂装照搬，落位换成「居中、占满宽、固定字号」——原型缩略图按固定字号画（`SubThumb` fz 13），
 * 不随画面上的字号与位置走；双语比例、次序与间距保留，两行的相对大小与画面一致。
 * `px` 是大的那一行在缩略图上的像素（覆盖里单独写的字号不算，按比例链）。
 * 行覆盖里的落位也去掉：在画面上单独拖过的一行（`origStyle` / `transStyle` 的 `x`、`y`、`verticalAlign`）在缩略图里仍叠回两行的堆栈。
 */
export function thumbScene(
  root: Json,
  kinds: readonly LineKind[],
  size: { width: number; height: number },
  px: number,
): { root: Json; lines: { kind: LineKind; text: string }[]; bilingual: boolean } {
  const sized = (style: unknown): Json => {
    const { fontSize: _size, fontSizeBasis: _basis, ...rest } = asObject(style);
    return rest;
  };
  const unplaced = (style: unknown): Json => {
    const { x: _x, y: _y, verticalAlign: _align, ...rest } = sized(style);
    return rest;
  };
  const out: Json = {
    ...sized(root),
    x: 50,
    y: 50,
    width: 94,
    verticalAlign: 'center',
    fontSize: 30,
  };
  for (const key of Object.values(LINE_STYLE_KEY)) if (isObject(root[key])) out[key] = unplaced(root[key]);
  const shown = kinds.length ? kinds : (['original'] as const);
  const bilingual = shown.length > 1;
  const largest = Math.max(...shown.map((kind) => lineSize(out, kind, bilingual).size));
  out.scale = (px * 540) / (largest * Math.max(1, Math.min(size.width, size.height)));
  const top: LineKind = bilingual && (root.order ?? 'trans') !== 'trans' ? 'original' : bilingual ? 'translation' : shown[0]!;
  return { root: out, bilingual, lines: shown.map((kind) => ({ kind, text: kind === top ? THUMB_SAMPLE.main : THUMB_SAMPLE.sub })) };
}
