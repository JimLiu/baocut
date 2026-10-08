import {
  TEMPLATE_ASSET_TYPES,
  TEMPLATE_CATEGORIES,
  templateExampleText,
  type TemplateAsset,
  type TemplateAssetType,
  type TemplateField,
  type TemplateFigure,
  type TemplateKind,
  type TemplateRatio,
  type TemplateSummary,
  type TemplateTone,
} from '@baocut/protocol';
import {
  TEMPLATE_ASSET_LABEL,
  TEMPLATE_CATEGORY_LABEL,
  TEMPLATE_KIND_LABEL,
  TEMPLATE_SOURCE_LABEL,
  TEMPLATE_SPEC_COPY,
  type TemplateSourceKey,
} from '../copy.ts';
import { lengthLabel } from './home-brief.ts';
import { slotLabels } from './prompt-slots.ts';

export type { TemplateSourceKey } from '../copy.ts';

/**
 * Home 模板库（产品设计 §3.2.1；模板包规范 docs/spec/template-spec.md；原型 designs/baocut/app/model-home-templates.js）。
 * 模板来自 Runtime 的模板目录（`templates.list`），这里只有纯逻辑：清单换成界面用的形状、筛选、搜索、分页、
 * 输入框下模板网格的货架与卡片上的文案。两类模板（规范 §1.2）：
 * - `scene` 场景模板：挂在输入框上，发送时只带模板标识，简报引导与正文由 Runtime 拼（§5.2）；
 * - `example` 作品示例：提示词全文放进输入框，之后就是用户自己的话（§5.1）。
 */

export interface HomeTemplate {
  id: string;
  version: string;
  /**
   * 文案的语言：Runtime 按界面语言挑出的语言版本（模板包规范 §3.6），没有译文时是清单原文的语言。
   * 取提示词、发送时都照它要，和卡片上看到的是同一版本。
   */
  language: string;
  kind: TemplateKind;
  /** 分类键（规范 §3.2）；认不出的键照样留着，显示名有兜底。 */
  category: string;
  /** 来源筛选用的键：内置目录、用户目录，清单写了 `community` 的算社区。 */
  source: TemplateSourceKey;
  author: string;
  title: string;
  summary: string;
  description: string;
  /** 「可以这样说」：`brief` 里的占位符换成各项的示例（没有示例的用 label）；没有 brief 时为空串。 */
  sample: string;
  /** 选用场景模板时填进输入框的那段话，带 `{{label}}` 占位符（规范 §5.5）；作品示例没有，为空串。 */
  brief: string;
  /** 待填项：scene 对应 `brief` 里的占位符，example 对应提示词正文里的。 */
  fields: readonly TemplateField[];
  /** 做这类成片建议先读的 craft。 */
  skills: readonly string[];
  /** 默认画幅；null = 自动。 */
  ratio: TemplateRatio | null;
  /** 默认时长（秒，清单 `durationSeconds`）；null = 自动。 */
  length: number | null;
  tags: readonly string[];
  tone: TemplateTone;
  figure: TemplateFigure;
  kicker: string;
  /** 占位预览轮播的分幕；清单没给（有预览视频）时用标题顶一幕，轮播不会空。 */
  beats: readonly string[];
  /** 封面图（清单 `cover.file`，且 Runtime 说文件在）；null 时画占位封面。 */
  cover: string | null;
  /** 预览视频（清单 `preview.file`，且 Runtime 说文件在）；null 时轮播 beats。 */
  preview: string | null;
  assets: readonly TemplateAsset[];
}

/** 「全部模板」一页放几个。 */
export const TEMPLATES_PER_PAGE = 9;
/** 起始页模板网格最多几张（四列两行）。 */
export const SHELF_MAX = 8;
/** 网格的默认八个：六个场景模板加两个作品示例，两类混排，七个分类都有（原型 `SHELF_DEFAULT`）。 */
export const SHELF_DEFAULT: readonly string[] = [
  'promo-ad',
  'knowledge-explainer',
  'data-story',
  'typography-motion',
  'launch-film',
  'vlog-edit',
  'story-short',
  'ai-news-take',
];

const SOURCE_ORDER: readonly TemplateSourceKey[] = ['builtin', 'user', 'community'];

/** 清单里的时长（秒）；没写或不是正数时为 null（自动）。 */
export function templateLength(seconds: number | null | undefined): number | null {
  return typeof seconds === 'number' && seconds > 0 ? seconds : null;
}

function sourceKey(summary: TemplateSummary): TemplateSourceKey {
  if (summary.manifest.source === 'community') return 'community';
  return summary.origin === 'builtin' ? 'builtin' : 'user';
}

/** `templates.list` 的一项 → 界面用的形状。 */
export function homeTemplateOf(summary: TemplateSummary): HomeTemplate {
  const m = summary.manifest;
  const beats = m.preview.beats?.length ? m.preview.beats : [m.title];
  return {
    id: m.id,
    version: m.version,
    language: m.language,
    kind: m.kind,
    category: m.category,
    source: sourceKey(summary),
    author: m.author,
    title: m.title,
    summary: m.summary,
    description: m.description,
    sample: m.brief ? templateExampleText(m.brief, m.fields) : '',
    brief: m.brief ?? '',
    fields: m.fields ?? [],
    skills: m.skills ?? [],
    ratio: m.ratio ?? null,
    length: templateLength(m.durationSeconds),
    tags: m.tags,
    tone: m.cover.tone ?? 'blue',
    figure: m.cover.figure ?? 'bars',
    kicker: m.cover.kicker ?? '',
    beats,
    cover: summary.files.cover && m.cover.file ? m.cover.file : null,
    preview: summary.files.preview && m.preview.file ? m.preview.file : null,
    assets: m.assets ?? [],
  };
}

/** 整个目录：Runtime 给的顺序不是合同（规范 §6），这里按来源（内置、我的、社区）再按 id 排。 */
export function templateCatalogOf(list: readonly TemplateSummary[]): HomeTemplate[] {
  return list
    .map(homeTemplateOf)
    .sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function isExample(t: Pick<HomeTemplate, 'kind'> | null | undefined): boolean {
  return t?.kind === 'example';
}

export function templateOf(catalog: readonly HomeTemplate[], id: string | null | undefined): HomeTemplate | null {
  return (id && catalog.find((t) => t.id === id)) || null;
}

/** 输入框下面的模板网格摆哪几个：最近用过的在前，不够八个用默认的补齐；目录里已经没有的键丢掉（旧版本存下的键也是）。 */
export function templateShelf(catalog: readonly HomeTemplate[], recent: readonly unknown[] | null | undefined): HomeTemplate[] {
  const keys = [...(Array.isArray(recent) ? recent : []), ...SHELF_DEFAULT].filter(
    (k, i, all): k is string => typeof k === 'string' && !!templateOf(catalog, k) && all.indexOf(k) === i,
  );
  return keys.slice(0, SHELF_MAX).map((k) => templateOf(catalog, k)!);
}

/** 选了一个模板之后网格的键：已经在网格里的不挪位置（卡片不乱跳），从模板库里挑的新面孔排到最前、挤掉最后一个。 */
export function shelfAfterPick(catalog: readonly HomeTemplate[], recent: readonly unknown[] | null | undefined, id: string): string[] {
  const keys = templateShelf(catalog, recent).map((t) => t.id);
  if (!templateOf(catalog, id) || keys.includes(id)) return keys;
  return [id, ...keys].slice(0, SHELF_MAX);
}

export interface TemplateFilter {
  kind?: TemplateKind | 'all';
  category?: string;
  source?: TemplateSourceKey | 'all';
}

/** 模板库里的筛选：类型、分类、来源，加一句搜索词（名字、一句话介绍、标签、作者里有就算）。 */
export function findTemplates(catalog: readonly HomeTemplate[], query: string, filter: TemplateFilter = {}): HomeTemplate[] {
  const q = query.trim().toLowerCase();
  const on = (value: string, want: string | undefined) => !want || want === 'all' || value === want;
  return catalog.filter(
    (t) =>
      on(t.kind, filter.kind) &&
      on(t.category, filter.category) &&
      on(t.source, filter.source) &&
      (!q || [t.title, t.summary, t.author, ...t.tags].some((x) => x.toLowerCase().includes(q))),
  );
}

/** 分类的显示名；认不出的键（更新的 Runtime 带来的）按键名显示。 */
export function categoryLabel(key: string): string {
  return (TEMPLATE_CATEGORY_LABEL as Record<string, string>)[key] ?? key;
}

/** 分类按钮：全部、规范的七类，再加目录里出现了但认不出的键。 */
export function templateCategories(catalog: readonly HomeTemplate[]): { key: string; label: string }[] {
  const known: readonly string[] = TEMPLATE_CATEGORIES;
  const extra = [...new Set(catalog.map((t) => t.category).filter((c) => !known.includes(c)))].sort();
  return [{ key: 'all', label: TEMPLATE_CATEGORY_LABEL.all }, ...[...known, ...extra].map((key) => ({ key, label: categoryLabel(key) }))];
}

/** 类型分段：全部、场景模板、作品示例。 */
export const TEMPLATE_KINDS_FILTER: readonly { key: TemplateKind | 'all'; label: string }[] = [
  { key: 'all', label: TEMPLATE_KIND_LABEL.all },
  { key: 'scene', label: TEMPLATE_KIND_LABEL.scene },
  { key: 'example', label: TEMPLATE_KIND_LABEL.example },
];

/** 来源筛选的选项：目录里只有一种来源时不用筛，返回空。 */
export function templateSources(catalog: readonly HomeTemplate[]): { key: TemplateSourceKey | 'all'; label: string }[] {
  const present = SOURCE_ORDER.filter((s) => catalog.some((t) => t.source === s));
  return present.length > 1
    ? [{ key: 'all', label: TEMPLATE_SOURCE_LABEL.all }, ...present.map((key) => ({ key, label: TEMPLATE_SOURCE_LABEL[key] }))]
    : [];
}

/** 分页：页码从 1 起，越界的收回到有效范围；空列表也算一页。 */
export function pageOf<T>(
  list: readonly T[],
  page: number,
  per = TEMPLATES_PER_PAGE,
): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(list.length / per));
  const p = Math.min(pages, Math.max(1, Math.round(page) || 1));
  return { items: list.slice((p - 1) * per, p * per), page: p, pages, total: list.length };
}

/** 画幅与时长，一小段：「9:16 · 约 30 秒」「16:9 · 时长自动」「画幅与时长自动」。 */
export function templateSpec(t: Pick<HomeTemplate, 'ratio' | 'length'>): string {
  const length = lengthLabel(t.length);
  if (!t.ratio && !length) return TEMPLATE_SPEC_COPY.allAuto;
  return [t.ratio ?? TEMPLATE_SPEC_COPY.ratioAuto, length ?? TEMPLATE_SPEC_COPY.lengthAuto].join(' · ');
}

/** 详情里那一行：场景模板写「默认」，作品示例没写的说明交给 Agent。 */
export function templateSpecLine(t: Pick<HomeTemplate, 'kind' | 'ratio' | 'length'>): string {
  if (!isExample(t)) return TEMPLATE_SPEC_COPY.sceneDefault(templateSpec(t));
  return t.ratio || t.length ? templateSpec(t) : TEMPLATE_SPEC_COPY.exampleAuto;
}

/** 卡片上那行小字：「9:16 · 约 30 秒 · 内置」「画幅与时长自动 · 我的」。 */
export function templateMeta(t: HomeTemplate): string {
  return [templateSpec(t), TEMPLATE_SOURCE_LABEL[t.source]].join(' · ');
}

/** 详情里的出处：「内置 · 场景模板 · 营销推广」「我的 · 作者 · 作品示例 · 动效设计」。内置的不写作者（都是 BaoCut）。 */
export function templateByline(t: HomeTemplate): string {
  return [TEMPLATE_SOURCE_LABEL[t.source], t.source === 'builtin' ? null : t.author, TEMPLATE_KIND_LABEL[t.kind], categoryLabel(t.category)]
    .filter(Boolean)
    .join(' · ');
}

/** 自带素材按种类数一数，没有的种类不列。 */
export function templateAssets(t: Pick<HomeTemplate, 'assets'>): { kind: TemplateAssetType; label: string; count: number }[] {
  return TEMPLATE_ASSET_TYPES.map((kind) => ({
    kind,
    label: TEMPLATE_ASSET_LABEL[kind],
    count: t.assets.filter((a) => a.type === kind).length,
  })).filter((a) => a.count > 0);
}

/**
 * 详情「需要你补充」（规范 §5.5；原型 `slotFields`）：按 brief 里第一次出现的顺序列出待填项，带上清单里同名项的说明；
 * 清单里没写的 label 只列名字。作品示例的待填项在提示词正文里，详情不列（返回空）。
 */
export function templateSlotFields(t: Pick<HomeTemplate, 'kind' | 'brief' | 'fields'>): TemplateField[] {
  if (isExample(t)) return [];
  return slotLabels(t.brief).map((label) => t.fields.find((f) => f.label === label) ?? { label });
}
