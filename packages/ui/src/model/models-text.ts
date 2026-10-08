import {
  defineMessages,
  live,
  DEFAULT_TEXT_CONCURRENCY,
  MAX_TEXT_CONCURRENCY,
  type ModelCapabilitiesView,
  type SetCapabilityParametersRequest,
  type TextCapabilityParameters,
  type TextEffort,
  type TextModelInfo,
} from '@baocut/protocol';
import { zhHans } from './models-text.zh-Hans.ts';
import { zhHant } from './models-text.zh-Hant.ts';
import { ja } from './models-text.ja.ts';
import { ko } from './models-text.ko.ts';
import { es } from './models-text.es.ts';
import { fr } from './models-text.fr.ts';
import { de } from './models-text.de.ts';
import { nl } from './models-text.nl.ts';
import { ptBR } from './models-text.pt-BR.ts';
import { it } from './models-text.it.ts';
import { ru } from './models-text.ru.ts';
import { pl } from './models-text.pl.ts';
import { tr } from './models-text.tr.ts';
import { vi } from './models-text.vi.ts';

/**
 * 模型 › 文本生成 › 云端模型的两行参数（设计稿 settings-cloud.jsx:258-269「推理强度」「并发请求数」）：
 * 存在 Runtime 的能力参数里（`models.setCapabilityParameters`，架构设计 §6.8），新值经 `models` 主题送回。
 */

/** 这一页的文案（英文是键与类型的来源，译文在 `models-text.<语言>.ts`）。 */
const en = {
  /** 推理强度的几档（设计稿是「低 / 中 / 高」；Runtime 还有一档 `minimal`）。 */
  effort: { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High' } as Record<TextEffort, string>,
  /** 不设默认，交给模型自己的默认。 */
  auto: 'Auto',
  context: (tokens: string) => `Context ${tokens}`,
  maxOutput: (tokens: string) => `Max output ${tokens}`,
  efforts: (labels: readonly string[]) => `Reasoning effort ${labels.join(' / ')}`,
  noEffort: "Reasoning effort can't be adjusted",
};

export type ModelsTextMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 推理强度各档的名字。 */
export const EFFORT_LABEL: Record<TextEffort, string> = live(() => M.effort);

/** token 数写短：整千的按千（128000 → 128K），否则按 1024（32768 → 32K、1048576 → 1M）。 */
export function tokensShort(n: number): string {
  if (n >= 1_000_000) {
    const unit = n % 1_000_000 === 0 ? 1_000_000 : 1_048_576;
    return `${Math.round((n / unit) * 10) / 10}M`;
  }
  if (n >= 1000) {
    const unit = n % 1000 === 0 ? 1000 : 1024;
    return `${Math.round(n / unit)}K`;
  }
  return String(n);
}

/** 一只文本模型的一句：上下文、单次输出、推理强度（从能力描述里来；模型页的模型行与工具页的模型菜单共用）。 */
export function textModelLine(info: Pick<TextModelInfo, 'notes' | 'contextTokens' | 'maxOutputTokens' | 'efforts'>): string {
  return [
    info.notes ?? null,
    M.context(tokensShort(info.contextTokens)),
    M.maxOutput(tokensShort(info.maxOutputTokens)),
    info.efforts.length ? M.efforts(info.efforts.map((e) => M.effort[e])) : M.noEffort,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 分段的键：「自动」= 不设默认（null），交给模型自己的默认。 */
export type EffortKey = 'auto' | TextEffort;

/** 分段的几项：自动、最低、低、中、高。 */
export const EFFORT_CHOICES: readonly { key: EffortKey; label: string }[] = [
  {
    key: 'auto',
    get label() {
      return M.auto;
    },
  },
  ...(['minimal', 'low', 'medium', 'high'] as const).map((key) => ({
    key,
    get label() {
      return M.effort[key];
    },
  })),
];

export function effortKey(effort: TextEffort | null): EffortKey {
  return effort ?? 'auto';
}

export function effortOfKey(key: string): TextEffort | null {
  return key === 'minimal' || key === 'low' || key === 'medium' || key === 'high' ? key : null;
}

/** 并发上限的范围（protocol schemas.ts：1–32）。 */
export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = MAX_TEXT_CONCURRENCY;

/** 视图里的参数；Runtime 没给时用出厂值。 */
export function textParameters(view: ModelCapabilitiesView): TextCapabilityParameters {
  return view.generateText.parameters ?? { effort: null, concurrency: DEFAULT_TEXT_CONCURRENCY };
}

/** 输入框里的数 → 合法的并发上限；不是数时 null（不提交）。 */
export function clampConcurrency(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, Math.round(value)));
}

/** 改推理强度：「自动」交 null（回到交给模型自己的默认）。 */
export function effortRequest(key: string): SetCapabilityParametersRequest {
  return { capability: 'generateText', effort: effortOfKey(key) };
}

/** 改并发上限；不是数时不提交（null）。 */
export function concurrencyRequest(value: number): SetCapabilityParametersRequest | null {
  const n = clampConcurrency(value);
  return n === null ? null : { capability: 'generateText', concurrency: n };
}

/** 已连接的文本模型里能调推理强度的有几只（推理强度那一行的说明用）。 */
export function effortModelCount(view: ModelCapabilitiesView): { tunable: number; total: number } {
  const models = view.generateText.providers.filter((p) => p.kind === 'online' && p.available).flatMap((p) => p.models);
  return { tunable: models.filter((m) => m.efforts.length > 0).length, total: models.length };
}
