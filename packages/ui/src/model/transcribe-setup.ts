import {
  localizeText,
  type Id,
  type LibraryEntrySummary,
  type ModelCapabilitiesView,
  type ModelRef,
  type TranscribeModelInfo,
  type TranscribeParams,
  type TranscriptionGlossary,
} from '@baocut/protocol';
import {
  cloudModelOptions,
  langName,
  languageOptions,
  languagesShort,
  modelKeyOf,
  type LanguageOption,
  type ToolModelOption,
} from './tools-models.ts';
import { transcribeOptions } from './tools-transcribe.ts';
import { M } from './transcribe-setup-copy.ts';

/**
 * 字幕面板「生成字幕」的转录设置（原型 glossary-tool.jsx `AsrHintBlock`、tool-transcribe.jsx 的语音模型与语言）：
 * 语言（自动 / 指定）、语音模型、识别提示（视频启用的转录术语表 + 自定义提示词，能不能用由这只模型的 `acceptsHint` 说了算）。
 *
 * 默认值等于什么都不设：没挑模型时不传 `provider` / `model`（Runtime 按用户默认值、出厂默认挑，都没有时照旧以
 * `CAPABILITY_NOT_CONFIGURED` 拒绝并给去处）；语言自动时不传 `language`；术语表从不显式传，Runtime 读视频启用的那几张
 * （`library.getVideoSelection` 的 `glossaries.transcribe`）。所以不动设置、直接点「生成字幕」和以前一模一样。
 */

/** 提示（提示词 + 术语）的上限，与 `models.transcribe` 的 `hint` 同（Runtime 的 `TRANSCRIBE_HINT_MAX_CHARS`）。 */
export const TRANSCRIBE_HINT_MAX = 1200;

export interface TranscribeSetup {
  /** 空串为自动检测。 */
  language: string;
  /** 挑的模型（`providerId/modelId`）；null 为跟随默认。 */
  model: string | null;
  /** 自定义提示词。 */
  prompt: string;
}

export const DEFAULT_TRANSCRIBE_SETUP: TranscribeSetup = { language: '', model: null, prompt: '' };

export type TranscribeModelOption = ToolModelOption<TranscribeModelInfo>;

/** 远端节点上的模型包：节点没连上、模型包不可用的也列，写原因。 */
function nodeOptions(view: ModelCapabilitiesView): TranscribeModelOption[] {
  return view.transcribe.providers
    .filter((p) => p.kind === 'node')
    .flatMap((p) =>
      p.models.map((info) => {
        const why = !p.available
          ? (localizeText(p.detail, p.detailRef) ?? M.notConnected)
          : info.available === false
            ? (localizeText(info.detail, info.detailRef) ?? M.unavailable)
            : null;
        return {
          key: modelKeyOf(p.providerId, info.modelId),
          providerId: p.providerId,
          provider: p.label,
          modelId: info.modelId,
          label: info.label || info.modelId,
          connected: true,
          usable: why === null,
          why,
          info,
        };
      }),
    );
}

/** 能挑的语音模型：本机的模型包、远端节点、云端（已连接的全列，没连上的只列第一只，与工具页同一套规则）。 */
export function transcribeModelOptions(view: ModelCapabilitiesView): TranscribeModelOption[] {
  return [...transcribeOptions(view, 'local'), ...nodeOptions(view), ...cloudModelOptions(view, 'transcribe')];
}

export interface PickedModel {
  /** 这次会用的模型；没挑、也没有默认值（或默认值不在清单里）时 null。 */
  option: TranscribeModelOption | null;
  /** 用户挑的（要传 `provider` / `model`）；跟随默认时 false。 */
  explicit: boolean;
}

/** 这次用哪只：挑过且还在清单里的那只；否则默认值（视图的 `effective`）。 */
export function pickModel(options: readonly TranscribeModelOption[], picked: string | null, effective: ModelRef | null): PickedModel {
  const chosen = picked ? options.find((o) => o.key === picked) : undefined;
  if (chosen) return { option: chosen, explicit: true };
  const key = effective ? modelKeyOf(effective.providerId, effective.modelId) : null;
  return { option: options.find((o) => o.key === key) ?? null, explicit: false };
}

/** 语言下拉：自动检测 + 这只模型认的语言（不限时列常用的）。 */
export function languageChoices(option: TranscribeModelOption | null): LanguageOption[] {
  return languageOptions(option?.info.languages ?? 'any', M.autoDetect);
}

/** 选的语言这只模型认不认；换了模型、不认了就回到自动（Runtime 会拒绝它不支持的语言）。 */
export function effectiveLanguage(language: string, option: TranscribeModelOption | null): string {
  return language && languageChoices(option).some((l) => l.key === language) ? language : '';
}

/** 识别提示这一块为什么用不上；能用时 null。 */
export function hintBlock(option: TranscribeModelOption | null, options: readonly TranscribeModelOption[] = []): string | null {
  if (!option) return M.hintNoModel;
  if (option.info.acceptsHint) return null;
  const alt = options.find((o) => o.usable && o.info.acceptsHint);
  return M.hintUnsupported(option.label, alt ? alt.label : null);
}

/** 按 UTF-16 长度截断（`hint` 的上限按字符串长度检查），不切开代理对。 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

export type TranscribeOptions = Pick<TranscribeParams, 'provider' | 'model' | 'language' | 'hint'>;

/**
 * 交给转录流程（`pipelines.start` 的 `transcribe`）的选项（`videoId` / `assetId` 之外）。只放偏离默认的：挑过的模型、
 * 指定的语言（断言，与命令行 `--language` 同）、这只模型收得下的提示词。术语表不放，Runtime 用视频启用的。
 */
export function transcribeRequestOptions(setup: TranscribeSetup, picked: PickedModel): TranscribeOptions {
  const { option, explicit } = picked;
  const language = effectiveLanguage(setup.language, option);
  const prompt = setup.prompt.trim();
  return {
    ...(explicit && option ? { provider: option.providerId, model: option.modelId } : {}),
    ...(language ? { language } : {}),
    ...(prompt && option?.info.acceptsHint ? { hint: clip(prompt, TRANSCRIBE_HINT_MAX) } : {}),
  };
}

export interface HintBudget {
  /** 提示词的字数。 */
  custom: number;
  /** 拼进提示的术语（规范写法）个数，与放不下的个数。 */
  terms: number;
  dropped: number;
  /** 拼好之后的字数。 */
  chars: number;
}

/**
 * 提示词加术语表拼出来有多长（照抄 Runtime 的 `composeTranscribeHint`：规范写法去重、按表的次序，第一条换行接在提示词后，
 * 之后用顿号；超过上限的舍去）。界面用它说「送给模型的是什么」，真正拼的是 Runtime。
 */
export function hintBudget(prompt: string, glossaries: readonly Pick<TranscriptionGlossary, 'terms'>[], max = TRANSCRIBE_HINT_MAX): HintBudget {
  const seen = new Set<string>();
  const canonical: string[] = [];
  for (const g of glossaries) {
    for (const t of g.terms) {
      if (seen.has(t.canonical)) continue;
      seen.add(t.canonical);
      canonical.push(t.canonical);
    }
  }
  const base = clip(prompt.trim(), max);
  let hint = base;
  let terms = 0;
  for (const term of canonical) {
    // i18n-ignore: 拼给语音模型的提示，格式照 Runtime 的 composeTranscribeHint（顿号分隔），不是界面文字
    const next = hint ? (terms === 0 ? `${hint}\n${term}` : `${hint}、${term}`) : term;
    if ([...next].length > max) break;
    hint = next;
    terms++;
  }
  return { custom: [...base].length, terms, dropped: canonical.length - terms, chars: [...hint].length };
}

/** 预算那一行（原型 `AsrHintBlock` 的 gls-asr__sum）。 */
export function budgetLine(model: string, budget: HintBudget): string {
  return M.budget(model, budget, TRANSCRIBE_HINT_MAX);
}

/** 库里一张术语表的内容：还在读时 `undefined`，读不出来时 null。 */
export type GlossaryContentState = TranscriptionGlossary | null | undefined;

export interface TranscribeGlossaryRow {
  id: Id;
  name: string;
  /** 这个视频启用了（`glossaries.transcribe`）。 */
  enabled: boolean;
  /** 转录时用得上：启用了、还在库里、是转录术语表。 */
  used: boolean;
  /** 勾选框下面那行：适用语言与条数，或用不上的原因。 */
  meta: string;
}

/**
 * 「术语表」一节的行：库里的转录术语表都列（勾选 = 在这个视频启用）；启用了、但这次用不上的（已经不在库里、是翻译术语表）
 * 也列、勾着、写原因——Runtime 合并视频启用的术语表时同样跳过它们。启用的排前面、按启用的次序（靠前的优先进提示），
 * 没启用的照库里的次序。Runtime 不按语言挑表，这里只把适用语言写出来。
 */
export function transcribeGlossaryRows(
  library: readonly Pick<LibraryEntrySummary, 'id' | 'name' | 'kind' | 'termCount'>[],
  contents: Record<Id, GlossaryContentState>,
  enabled: readonly Id[],
): TranscribeGlossaryRow[] {
  const byId = new Map(library.map((e) => [e.id, e]));
  const row = (id: Id, on: boolean): TranscribeGlossaryRow => {
    const entry = byId.get(id);
    if (!entry) return { id, name: id, enabled: on, used: false, meta: M.glossaryGone };
    if (entry.kind !== 'transcription') return { id, name: entry.name, enabled: on, used: false, meta: M.glossaryTranslation };
    const content = contents[id];
    const terms = content ? content.terms.length : entry.termCount;
    const language = content === undefined ? null : content ? (content.language ? langName(content.language) : M.anyLanguage) : null;
    const count = terms === undefined ? null : M.termCount(terms);
    return { id, name: entry.name, enabled: on, used: on, meta: [language, count].filter(Boolean).join(' · ') };
  };
  const rest = library.filter((e) => e.kind === 'transcription' && !enabled.includes(e.id)).map((e) => row(e.id, false));
  return [...enabled.map((id) => row(id, true)), ...rest];
}

/** 折起来时那行摘要：语言 · 模型 · 识别提示。 */
export function setupSummary(setup: TranscribeSetup, picked: PickedModel, glossaries: number, hintBlocked: boolean): string {
  const language = effectiveLanguage(setup.language, picked.option);
  const model = !picked.option ? M.noDefaultModel : picked.explicit ? picked.option.label : M.defaultModel(picked.option.label);
  const parts = [language ? langName(language) : M.autoDetectLanguage, model];
  if (!hintBlocked) {
    if (glossaries) parts.push(M.glossaries(glossaries));
    if (setup.prompt.trim()) parts.push(M.hasPrompt);
  }
  return parts.join(' · ');
}

/** 模型下面那行：跟随默认与否、认哪些语言、收不收提示；不能用时写原因。 */
export function modelFacts(picked: PickedModel): string {
  const { option, explicit } = picked;
  if (!option) return M.noDefaultFacts;
  if (!option.usable) return option.why ?? M.modelUnusable;
  const facts = `${languagesShort(option.info.languages)} · ${option.info.acceptsHint ? M.acceptsHint : M.noHint}`;
  return explicit ? facts : M.followDefault(facts);
}
