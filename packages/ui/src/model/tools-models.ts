import {
  defineMessages,
  intlLocale,
  localizeText,
  type MessageRef,
  type ModelCapabilitiesView,
  type ModelInfoByCapability,
  type ModelRef,
  type ModelServiceCapability,
  type OnlineCapability,
  type TextModelInfo,
} from '@baocut/protocol';
import { cloudProviders, defaultKey, parseDefaultKey } from './models-cloud.ts';
import { zhHans } from './tools-models.zh-Hans.ts';
import { zhHant } from './tools-models.zh-Hant.ts';
import { ja } from './tools-models.ja.ts';
import { ko } from './tools-models.ko.ts';
import { es } from './tools-models.es.ts';
import { fr } from './tools-models.fr.ts';
import { de } from './tools-models.de.ts';
import { nl } from './tools-models.nl.ts';
import { ptBR } from './tools-models.pt-BR.ts';
import { it } from './tools-models.it.ts';
import { ru } from './tools-models.ru.ts';
import { pl } from './tools-models.pl.ts';
import { tr } from './tools-models.tr.ts';
import { vi } from './tools-models.vi.ts';

const en = {
  notConnected: 'Not connected',
  unavailable: 'Unavailable',
  notDownloaded: 'Not downloaded',
  unsupported: 'Not available on this platform or build',
  auto: 'Auto',
  anyLanguage: 'Many languages',
  languages: (named: readonly string[]) => named.join(', '),
  languagesMore: (first: readonly string[], total: number) => `${first.join(', ')} and ${total - first.length} more`,
};
export type ToolsModelsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 工具页的「选一只模型」（设计稿 tool-tts.jsx `ModelLine`、image-gen.jsx `ModelLine`、tool-transcribe.jsx 的语音模型 Picker）：
 * 从 `models` 主题的能力视图里折出可选的模型。服务商清单不写死；没连上的也列出来，标「未连接」，选中时页面给门卡。
 * 键与模型页的默认模型菜单同形：`providerId/modelId`。
 */

export interface ToolModelOption<M> {
  key: string;
  providerId: string;
  /** 服务商的名字（OpenAI、自建服务商的名字）。 */
  provider: string;
  modelId: string;
  /** 模型的名字（自建服务商声明的可能与 ID 不同）。 */
  label: string;
  connected: boolean;
  /** 连上了、这一档可用、这只模型也可用：可以提交。 */
  usable: boolean;
  /** 不能用的原因（未连接、没有声明模型……）；能用时 null。 */
  why: string | null;
  info: M;
  /** 本机模型（设计稿 image-gen.jsx 的「本机 · 不联网」一组）：没装好也能选，选中时页面给下载卡。 */
  local?: boolean;
  /** 智能体 Provider 的模型（Codex 画图与写文字，设计稿 image-gen.jsx 的「智能体」一组、tool-translate.jsx `textModels`）。 */
  agent?: boolean;
  /** 能用但要提醒的一句（Codex 不是以 ChatGPT 订阅登录：费用不在订阅里，画图可能画不了）；出厂顺序与开页的回落都跳过它。 */
  caution?: string;
  /** 云端语音合成：这家能克隆音色（Runtime 报的 `voiceClone`），我的声音建了克隆就能在这里用。 */
  voiceClone?: { requiresConsentClip: boolean };
}

/**
 * 云端（在线 Provider）的模型：已连接的服务商排前面、列出它的每只模型；没连上的只列它的第一只（设计稿 image-gen.jsx
 * `x.ready ? x.models : x.models.slice(0, 1)`），`all` 时全列（转录的 Picker 照设计稿全列）。Codex 画图这类智能体
 * Provider 不在这里（`cloudProviders` 只取在线的）。
 */
export function cloudModelOptions<C extends OnlineCapability>(
  view: ModelCapabilitiesView,
  capability: C,
  all = false,
): ToolModelOption<ModelInfoByCapability[C]>[] {
  return cloudProviders(view, capability).flatMap((card) => {
    const models = (card.connected || all ? card.models : card.models.slice(0, 1)) as ModelInfoByCapability[C][];
    return models.map((info) => {
      const why = !card.connected
        ? M.notConnected
        : !card.available
          ? (card.detail ?? M.unavailable)
          : info.available === false
            ? (localizeText(info.detail, info.detailRef) ?? M.unavailable)
            : null;
      return {
        key: defaultKey({ providerId: card.providerId, modelId: info.modelId }),
        providerId: card.providerId,
        provider: card.label,
        modelId: info.modelId,
        label: info.label || info.modelId,
        connected: card.connected,
        usable: why === null,
        why,
        info,
        ...(card.voiceClone ? { voiceClone: card.voiceClone } : {}),
      };
    });
  });
}

/**
 * 智能体 Provider（`kind: 'agent'`，如 Codex 画图、Codex 写文字）的模型：Runtime 注册了才有（架构设计 §6.9）。没打开、没装、没登录时照样列出，
 * 写 Runtime 给的原因；能用但不是订阅（`cost` 不是 `subscription`）时带 `caution`（模型的 `notes`）。
 */
export function agentModelOptions<C extends ModelServiceCapability>(
  view: ModelCapabilitiesView,
  capability: C,
): ToolModelOption<ModelInfoByCapability[C]>[] {
  return view[capability].providers
    .filter((p) => p.kind === 'agent')
    .flatMap((p) =>
      (p.models as ModelInfoByCapability[C][]).map((info) => {
        const why = !p.available
          ? (localizeText(p.detail, p.detailRef) ?? M.unavailable)
          : info.available === false
            ? (localizeText(info.detail, info.detailRef) ?? M.unavailable)
            : null;
        const caution = why === null && info.cost !== 'subscription' ? (info.notes ?? M.unavailable) : null;
        return {
          key: defaultKey({ providerId: p.providerId, modelId: info.modelId }),
          providerId: p.providerId,
          provider: p.label,
          modelId: info.modelId,
          label: info.label || info.modelId,
          connected: true,
          usable: why === null,
          why,
          info,
          agent: true,
          ...(caution ? { caution } : {}),
        };
      }),
    );
}

/** 本机模型没下载时的原因（页面据此给下载卡、主按钮说「还没安装」）：按当前界面语言，拿 `why` 比对时也调它。 */
export function localNotDownloaded(): string {
  return M.notDownloaded;
}

/** 本机模型不能用的原因（设计稿 model-cloud-image.js `engines` 的 `why`）。 */
function localWhy(
  capability: { available: boolean; detail?: string; detailRef?: MessageRef },
  info: { unavailableReason?: string; available?: boolean; detail?: string; detailRef?: MessageRef },
): string | null {
  if (info.unavailableReason === 'not-installed') return M.notDownloaded;
  if (info.unavailableReason === 'unsupported') return M.unsupported;
  if (info.available === false) return localizeText(info.detail, info.detailRef) ?? M.unavailable;
  if (!capability.available) return localizeText(capability.detail, capability.detailRef) ?? M.unsupported;
  return null;
}

/**
 * 本机（`kind: 'local'` 的 Provider）的模型：都列出来（没装的也列，选中时页面说还没安装、给去设置或下载），
 * 名字用模型的名字（产品设计 §2.7「模型」一行）。
 */
export function localModelOptions<C extends ModelServiceCapability>(
  view: ModelCapabilitiesView,
  capability: C,
): ToolModelOption<ModelInfoByCapability[C]>[] {
  return view[capability].providers
    .filter((p) => p.kind === 'local')
    .flatMap((p) =>
      (p.models as ModelInfoByCapability[C][]).map((info) => {
        const why = localWhy(p, info);
        return {
          key: defaultKey({ providerId: p.providerId, modelId: info.modelId }),
          providerId: p.providerId,
          provider: p.label,
          modelId: info.modelId,
          label: info.label || info.modelId,
          connected: true,
          usable: why === null,
          why,
          info,
          local: true,
        };
      }),
    );
}

/** 选中的本机模型还没装时换用哪只（设计稿 tool-tts.jsx「换用已装的 X」）：菜单里第一只装好能用的本机模型；没有时 null。 */
export function installedAlternative<M>(options: readonly ToolModelOption<M>[], selected: ToolModelOption<M> | null): ToolModelOption<M> | null {
  return options.find((o) => o.local && o.usable && o.key !== selected?.key) ?? null;
}

/** 「模型」一行的菜单：这种能力已配置的云端模型在前，然后是本机模型，智能体（文本生成的 Codex）在最后。 */
export function modelOptions<C extends OnlineCapability>(view: ModelCapabilitiesView, capability: C): ToolModelOption<ModelInfoByCapability[C]>[] {
  return [...cloudModelOptions(view, capability), ...localModelOptions(view, capability), ...agentModelOptions(view, capability)];
}

/**
 * 翻译、配音翻译这类只用文本生成的地方的菜单：API 提供方的模型在前，智能体（Codex 写文字，§6.9）在后。文本生成没有出厂默认，
 * Codex 只在用户选它、或把它设成默认时用；开页的回落用 `withoutCaution` 跳过 API key 登录的 Codex。
 */
export function textModelOptions(view: ModelCapabilitiesView): ToolModelOption<TextModelInfo>[] {
  return [...cloudModelOptions(view, 'generateText'), ...agentModelOptions(view, 'generateText')];
}

/** `initialModelKey` 的回落条件：跳过要提醒的（API key 登录的 Codex，设计稿 model-cloud-image.js `preferred`、tool-translate.jsx `useTextModel`）。 */
export function withoutCaution<M>(option: ToolModelOption<M>): boolean {
  return !option.caution;
}

/** 菜单与状态里这只模型的叫法：云端写模型 ID，本机与智能体写模型的名字。 */
export function optionName<M>(option: ToolModelOption<M>): string {
  return option.local || option.agent ? option.label : option.modelId;
}

/**
 * 进页时选哪只：上次选的（还在清单里就留着，哪怕现在不能用——页面给门卡），再是这种能力的生效默认值（用户设的，或
 * Runtime 按出厂顺序挑的），再是第一只能用的，最后是第一只。清单为空时 null。后两步只在 `fallback` 认的里面挑（生图跳过要提醒的
 * Codex，设计稿 model-cloud-image.js `preferred`）。
 */
export function initialModelKey<M>(
  options: readonly ToolModelOption<M>[],
  saved: string | null,
  effective: ModelRef | null,
  fallback: (option: ToolModelOption<M>) => boolean = () => true,
): string | null {
  if (saved && options.some((o) => o.key === saved)) return saved;
  const preferred = effective ? defaultKey(effective) : null;
  const hit = options.find((o) => o.key === preferred && o.usable);
  const pool = options.filter(fallback);
  return (hit ?? pool.find((o) => o.usable) ?? pool[0] ?? options[0])?.key ?? null;
}

export function findOption<M>(options: readonly ToolModelOption<M>[], key: string | null): ToolModelOption<M> | null {
  return options.find((o) => o.key === key) ?? null;
}

/** 键 → Provider 与模型（带回一条记录的设置时用）。 */
export function modelKeyOf(providerId: string, modelId: string): string {
  return defaultKey({ providerId, modelId });
}

export function parseModelKey(key: string): ModelRef | null {
  return parseDefaultKey(key);
}

// ---- 语言 ----

/** 模型不限语言（`any`）时 Picker 里列的常用语言。 */
const COMMON_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar'];

const namesByLocale = new Map<string, Intl.DisplayNames | null>();

/** 语言按界面语言写的名字（中文界面 `zh` → 中文，英文界面 → Chinese）；认不出来时原样返回。 */
export function langName(tag: string): string {
  const locale = intlLocale();
  let names = namesByLocale.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale], { type: 'language' });
    } catch {
      names = null;
    }
    namesByLocale.set(locale, names);
  }
  try {
    return names?.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** BCP 47 的主语言子标签（`zh-CN` → `zh`）。 */
export function primaryLanguage(tag: string): string {
  return tag.split('-')[0]!.toLowerCase();
}

export interface LanguageOption {
  /** 空串为「自动」：不给 `language`。 */
  key: string;
  label: string;
}

/** 语言下拉：自动 + 模型声明的语言（不限时列常用的）。 */
export function languageOptions(languages: 'any' | readonly string[], auto: string = M.auto): LanguageOption[] {
  const list = languages === 'any' ? COMMON_LANGUAGES : languages;
  return [{ key: '', label: auto }, ...list.map((tag) => ({ key: tag, label: langName(tag) }))];
}

/** 这只模型会不会念 / 认这种语言（`any` 都会）。 */
export function speaks(languages: 'any' | readonly string[], tag: string): boolean {
  if (languages === 'any') return true;
  const want = primaryLanguage(tag);
  return languages.some((l) => primaryLanguage(l) === want);
}

/** 按字符粗判文字的语言（设计稿 model-tools.js `detectLang`）：假名、韩文、阿拉伯文、汉字、拉丁字母；都没有时 null。 */
export function detectLang(text: string): string | null {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/[㐀-鿿]/.test(text)) return 'zh';
  if (/[A-Za-z]/.test(text)) return 'en';
  return null;
}

/** 按 Unicode 码点数（Runtime 的上限也按码点计）。 */
export function codePoints(text: string): number {
  return Array.from(text).length;
}

/** 种子：留空或一个非负整数。 */
export function parseSeed(text: string): { ok: true; seed: number | null } | { ok: false } {
  const t = text.trim();
  if (!t) return { ok: true, seed: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  return Number.isSafeInteger(n) ? { ok: true, seed: n } : { ok: false };
}

/** 记录卡上的服务商名：按 Provider ID 在这种能力的视图里找；找不到（已删除的自建服务商）时写 ID。 */
export function providerName(view: ModelCapabilitiesView | null, capability: ModelServiceCapability, providerId: string): string {
  return view?.[capability].providers.find((p) => p.providerId === providerId)?.label ?? providerId;
}

/** 语言清单的短说法：不限时「多种语言」，三种以内列名字，再多写「中文、英语等 N 种」。 */
export function languagesShort(languages: 'any' | readonly string[]): string {
  if (languages === 'any') return M.anyLanguage;
  const named = languages.map(langName);
  if (named.length <= 3) return M.languages(named);
  return M.languagesMore(named.slice(0, 2), named.length);
}
