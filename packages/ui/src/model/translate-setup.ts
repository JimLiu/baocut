import { defineMessages, MAX_SELECTED_GLOSSARIES, type DocumentRecord, type GlossaryEntry, type Id, type TranslateParams, type TranslationGlossary } from '@baocut/protocol';
import { languageName } from './caption-tracks.ts';
import { langName } from './tools-models.ts';
import { zhHans } from './translate-setup.zh-Hans.ts';
import { zhHant } from './translate-setup.zh-Hant.ts';
import { ja } from './translate-setup.ja.ts';
import { ko } from './translate-setup.ko.ts';
import { es } from './translate-setup.es.ts';
import { fr } from './translate-setup.fr.ts';
import { de } from './translate-setup.de.ts';
import { nl } from './translate-setup.nl.ts';
import { ptBR } from './translate-setup.pt-BR.ts';
import { it } from './translate-setup.it.ts';
import { ru } from './translate-setup.ru.ts';
import { pl } from './translate-setup.pl.ts';
import { tr } from './translate-setup.tr.ts';
import { vi } from './translate-setup.vi.ts';

/** 目标语言不能选的原因与术语表行的说明（译文在 `translate-setup.<语言>.ts`）。 */
const en = {
  sameAsSource: 'Same language as the original',
  alreadyTranslated: 'Already has a translation in this language',
  glossaryGone: 'No longer in the glossary library · not used this time',
  reading: 'Reading…',
  unreadable: 'Couldn’t be read · not used this time',
  anyLanguage: 'Any language',
  /** 方向对不上的术语表：`source` / `target` 已是显示名。 */
  wrongDirection: (source: string, target: string) => `Direction is ${source} → ${target} · not used this time`,
};
export type TranslateSetupMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 翻译设置页（原型 panel-aitools-flows.jsx `TranslateFlow`）的纯逻辑：能翻成哪几门语言、视频启用的术语表里哪些
 * 方向对得上、交给 `pipelines.start` 的参数。
 */

/** 常用的目标语言。中文分简繁（`zh-Hans` / `zh-Hant`），别的按主语言。 */
export const TARGET_LANGUAGES = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'it', 'vi', 'th', 'id', 'ar'] as const;

const primary = (tag: string) => tag.split('-')[0]!.toLowerCase();

/** 中文标签的书写系统：繁体（Hant、台港澳）还是简体。 */
function chineseScript(tag: string): 'Hant' | 'Hans' {
  return /-(hant|tw|hk|mo)(-|$)/i.test(tag) ? 'Hant' : 'Hans';
}

/** 两个语言标签说的是不是同一门语言（中文再分简繁）。 */
export function sameLanguage(a: string, b: string): boolean {
  if (primary(a) !== primary(b)) return false;
  return primary(a) !== 'zh' || chineseScript(a) === chineseScript(b);
}

export interface TargetOption {
  tag: string;
  /** 这门语言自己的叫法（English、日本語）。 */
  label: string;
  /** 中文名。 */
  description: string;
  /** 不能选的原因：和原文同一种语言，或这份转写已经有这门语言的译文（一门语言一条轨）。 */
  disabled: string | null;
}

/** 已经有译文的语言：这份转写派生出的译文文档。 */
export function existingTranslations(documents: Record<Id, DocumentRecord>, speechDocumentId: Id): DocumentRecord[] {
  return Object.values(documents).filter((d) => d.kind === 'translation' && d.sourceDocumentId === speechDocumentId);
}

export function targetOptions(sourceLanguage: string | null, existing: readonly DocumentRecord[]): TargetOption[] {
  return TARGET_LANGUAGES.map((tag) => {
    const same = sourceLanguage !== null && sameLanguage(sourceLanguage, tag);
    const done = existing.some((d) => d.language && sameLanguage(d.language, tag));
    return {
      tag,
      label: languageName(tag),
      description: langName(tag),
      disabled: same ? M.sameAsSource : done ? M.alreadyTranslated : null,
    };
  });
}

/** 默认的目标语言：原文是中文时英语，否则简体中文；都不能选时第一门能选的。 */
export function defaultTarget(options: readonly TargetOption[], sourceLanguage: string | null): string | null {
  const preferred = sourceLanguage && primary(sourceLanguage) === 'zh' ? 'en' : 'zh-Hans';
  return (options.find((o) => o.tag === preferred && !o.disabled) ?? options.find((o) => !o.disabled))?.tag ?? null;
}

/**
 * 术语表上的语言标签相不相配（照抄 jobs 的 `languageMatches`，Runtime 按它拒绝语言不符的术语表）：相同，或一个是另一个
 * 在子标签边界上的前缀（`en` 配 `en-US`；`zh-CN` 不配 `zh-Hans`）。
 */
export function languageMatches(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
}

/** 术语表的方向对不对得上：目标语言相配；源语言不限，或与原文相配（原文语言不明时只看目标）。 */
export function glossaryFits(glossary: Pick<TranslationGlossary, 'sourceLanguage' | 'targetLanguage'>, source: string | null, target: string): boolean {
  if (!languageMatches(glossary.targetLanguage, target)) return false;
  return glossary.sourceLanguage === null || source === null || languageMatches(glossary.sourceLanguage, source);
}

/**
 * 原文里出现了的词条（不分大小写），同一个源词只取第一条。设置页用它说「本篇命中几条」；真正交给模型的由 Runtime
 * 按每一批的原文再挑。
 */
export function glossaryHits(terms: TranslationGlossary['terms'], text: string): GlossaryEntry[] {
  const haystack = text.toLocaleLowerCase();
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const term of terms) {
    const source = term.source.trim();
    const target = term.target.trim();
    if (!source || !target || seen.has(source) || !haystack.includes(source.toLocaleLowerCase())) continue;
    seen.add(source);
    out.push({ source, target, ...(term.note ? { note: term.note } : {}) });
  }
  return out;
}

/** 库里的一张翻译用术语表：内容还在读时 `undefined`，读不出来（删了、出错）时 null。 */
export interface GlossaryCandidate {
  id: Id;
  name: string;
  content: TranslationGlossary | null | undefined;
}

export interface GlossaryRow {
  id: Id;
  name: string;
  /** 视频里启用了（`library-selection` 的 `glossaries.translate`）。 */
  enabled: boolean;
  /** 这次翻译用得上：启用了、读得出来、方向对得上。 */
  used: boolean;
  /** 词条数与本篇命中数；内容没读出来时 null。 */
  terms: number | null;
  hits: number | null;
  /** 不能勾、或勾着也不用的原因（方向对不上、不在库里、还在读）；能正常勾选时 null。 */
  note: string | null;
}

/**
 * 设置页「术语表」一节的行：库里方向对得上的翻译用术语表都列出来（勾选 = 视频启用）；视频启用了、但这次用不上的
 * （方向不符、已经不在库里）也列出来、勾着、写明原因——Runtime 合并视频启用的术语表时同样跳过它们。
 * 启用的排前面，按启用的次序（靠前的优先）；没启用的照库里的次序。
 */
export function glossaryRows(
  candidates: readonly GlossaryCandidate[],
  enabled: readonly Id[],
  source: string | null,
  target: string,
  text: string,
): GlossaryRow[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const row = (id: Id, on: boolean): GlossaryRow | null => {
    const candidate = byId.get(id);
    if (!candidate) return on ? { id, name: id, enabled: true, used: false, terms: null, hits: null, note: M.glossaryGone } : null;
    const { content, name } = candidate;
    if (content === undefined) return { id, name, enabled: on, used: false, terms: null, hits: null, note: M.reading };
    if (content === null) return on ? { id, name, enabled: true, used: false, terms: null, hits: null, note: M.unreadable } : null;
    const fits = glossaryFits(content, source, target);
    if (!fits && !on) return null;
    return {
      id,
      name,
      enabled: on,
      used: on && fits,
      terms: content.terms.length,
      hits: glossaryHits(content.terms, text).length,
      note: fits ? null : M.wrongDirection(content.sourceLanguage ? langName(content.sourceLanguage) : M.anyLanguage, langName(content.targetLanguage)),
    };
  };
  const on = enabled.map((id) => row(id, true)).filter((r): r is GlossaryRow => r !== null);
  const rest = candidates
    .filter((c) => !enabled.includes(c.id))
    .map((c) => row(c.id, false))
    .filter((r): r is GlossaryRow => r !== null);
  return [...on, ...rest];
}

/** 勾选或取消一张：新勾的排到最后（靠前的优先），取消的拿掉；超过上限时不变（返回 null）。 */
export function toggleGlossary(enabled: readonly Id[], id: Id, on: boolean): Id[] | null {
  if (on) {
    if (enabled.includes(id)) return null;
    if (enabled.length >= MAX_SELECTED_GLOSSARIES) return null;
    return [...enabled, id];
  }
  return enabled.includes(id) ? enabled.filter((x) => x !== id) : null;
}

export interface TranslateSetup {
  videoId: Id;
  speechDocumentId: Id;
  targetLanguage: string;
  /** 风格提示；空的不传。 */
  style: string;
  /** 选中的文本模型；null 时用文本生成的默认值。 */
  model: { providerId: string; modelId: string } | null;
}

/**
 * `pipelines.start` 的 `params`：只放流程认得的键（`parseTranslateParams` 拒绝多余的键）。术语表不在这里传：用视频启用的
 * （`library.getVideoSelection`），Runtime 启动时自己读、冻结版本。
 */
export function translateParams(setup: TranslateSetup): TranslateParams {
  const style = setup.style.trim().slice(0, 500);
  return {
    videoId: setup.videoId,
    documentId: setup.speechDocumentId,
    targetLanguage: setup.targetLanguage,
    ...(style ? { style } : {}),
    ...(setup.model ? { provider: setup.model.providerId, model: setup.model.modelId } : {}),
  };
}
