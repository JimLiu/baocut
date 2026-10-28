import { defineMessages, isDriverId, type ModelCapabilitiesView, type TextEffort, type TextModelInfo } from '@baocut/protocol';
import { AGENT_PICKER } from '../copy.ts';
import { agentIcon, effortLabel, effortRows, type AgentIconSpec, type EffortRow } from './agent-choice.ts';
import { providerIcon } from './api-providers.ts';
import { EFFORT_LABEL } from './models-text.ts';
import { optionName, type ToolModelOption } from './tools-models.ts';
import { zhHans } from './text-model-choice.zh-Hans.ts';
import { zhHant } from './text-model-choice.zh-Hant.ts';
import { ja } from './text-model-choice.ja.ts';
import { ko } from './text-model-choice.ko.ts';
import { es } from './text-model-choice.es.ts';
import { fr } from './text-model-choice.fr.ts';
import { de } from './text-model-choice.de.ts';
import { nl } from './text-model-choice.nl.ts';
import { ptBR } from './text-model-choice.pt-BR.ts';
import { it } from './text-model-choice.it.ts';
import { ru } from './text-model-choice.ru.ts';
import { pl } from './text-model-choice.pl.ts';
import { tr } from './text-model-choice.tr.ts';
import { vi } from './text-model-choice.vi.ts';

const en = {
  /** 收起时还没有选中的那一行。 */
  placeholder: 'Choose a text model',
  /** 第一级的组头。 */
  providers: 'Providers',
  /** 智能体那一行能用时的副文案：用谁的订阅、比 API 慢。 */
  agentReady: (provider: string) => `Agent · Uses your ${provider} subscription · Slower than the API`,
  /** 智能体那一行不能用或要提醒时的副文案（原因、API key 登录的提醒）。 */
  agentNote: (note: string) => `Agent · ${note}`,
  /** API 提供方那一行：连上了写有几只模型。 */
  connected: (n: number) => (n === 1 ? 'Connected · 1 model' : `Connected · ${n} models`),
  notConnected: 'Not connected · Connect in Settings',
  /** 菜单最后去模型页的那一项。 */
  settings: 'Manage text models…',
  settingsSub: 'Connect API providers · Default model',
};
export type TextModelChoiceMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
/** 菜单里的几句（读属性时取当前语言）。 */
export const TEXT_PICKER: TextModelChoiceMessages = M;

/**
 * 文本模型的两级菜单（产品设计 §7.6；原型 text-model-picker.jsx、model-llm-tools.js `providers` / `modelRows` / `pickLabel`）：
 * 第一级每家提供方一行（API 提供方与智能体同一张单子，按 `textModelOptions` 的次序，能用的在前）；能用的那家展开第二级选模型，
 * 智能体再选推理强度。这里只算行与文案；画在 components/text-model-picker.tsx。
 */

export type TextOption = ToolModelOption<TextModelInfo>;

/**
 * 一处记下的文本模型选择：模型键（`providerId/modelId`）与推理强度。推理强度只给智能体（null = 模型自己的默认）；
 * API 模型的推理强度在模型页统一设，这里总是 null。
 */
export interface TextPick {
  key: string;
  effort: TextEffort | null;
}

export interface TextProviderRow {
  providerId: string;
  name: string;
  agent: boolean;
  /** 有能用的模型：点了展开第二级；不能用的点了去设置。 */
  ready: boolean;
  /** 当前选中的模型在这家。 */
  selected: boolean;
  sub: string;
  options: TextOption[];
}

/** 第一级：按菜单的次序每家一行。 */
export function textProviderRows(options: readonly TextOption[], selectedKey: string | null): TextProviderRow[] {
  const rows: TextProviderRow[] = [];
  for (const o of options) {
    const row = rows.find((r) => r.providerId === o.providerId);
    if (row) row.options.push(o);
    else rows.push({ providerId: o.providerId, name: o.provider, agent: !!o.agent, ready: false, selected: false, sub: '', options: [o] });
  }
  for (const row of rows) {
    row.ready = row.options.some((o) => o.usable);
    row.selected = row.options.some((o) => o.key === selectedKey);
    row.sub = providerSub(row);
  }
  return rows;
}

/** 一家的图标：智能体用 Agent 的图标（`agent:codex` → Codex），API 提供方用目录给的厂商图标，没有时画名字首字母。 */
export function textProviderIcon(view: ModelCapabilitiesView | null, row: Pick<TextProviderRow, 'providerId' | 'name' | 'agent'>): AgentIconSpec {
  const driverId = row.providerId.replace(/^agent:/, '');
  if (row.agent && isDriverId(driverId)) return agentIcon({ id: driverId, name: row.name });
  const vendor = view?.generateText.providers.find((p) => p.providerId === row.providerId)?.vendor;
  return providerIcon({ providerId: row.providerId, label: row.name, vendor: vendor ?? { kind: 'vendor' } });
}

function providerSub(row: TextProviderRow): string {
  const first = row.options[0]!;
  if (row.agent) {
    if (!row.ready) return M.agentNote(first.why ?? '');
    const caution = row.options.find((o) => o.caution)?.caution;
    return caution ? M.agentNote(caution) : M.agentReady(row.name);
  }
  if (!first.connected) return M.notConnected;
  return row.ready ? M.connected(row.options.length) : (first.why ?? M.notConnected);
}

export interface TextModelRow {
  key: string;
  label: string;
  sub: string | null;
  /** 这家里不能用的那只（比如不支持结构化输出）：列出来、写原因、不能选。 */
  disabled: boolean;
}

/** 第二级的模型：智能体的第一只是「Agent 默认模型」，副文案说按 CLI 配置选；不能用的写原因；API 模型的名字与 ID 不同时写名字。 */
export function textModelRows(row: Pick<TextProviderRow, 'options'>): TextModelRow[] {
  return row.options.map((o) => ({
    key: o.key,
    label: optionName(o),
    sub: o.why ?? (o.agent ? (o.info.default ? AGENT_PICKER.agentDefaultSub : null) : o.label !== o.modelId ? o.label : null),
    disabled: !o.usable,
  }));
}

/** 智能体这家第二级的推理强度跟着哪只模型：选着这家的就是它，否则是「Agent 默认模型」。API 提供方没有。 */
export function effortOption(row: Pick<TextProviderRow, 'agent' | 'options'>, selectedKey: string | null): TextOption | null {
  if (!row.agent) return null;
  return row.options.find((o) => o.key === selectedKey) ?? row.options.find((o) => o.info.default) ?? row.options[0] ?? null;
}

/** 这只模型的推理强度各档（模型自己的默认那档标「默认」）；API 模型与不分强度的智能体模型是空表。 */
export function textEffortRows(option: TextOption | null): EffortRow[] {
  if (!option?.agent) return [];
  return effortRows({ efforts: option.info.efforts.map((id) => ({ id, label: EFFORT_LABEL[id] })), defaultEffort: option.info.defaultEffort });
}

/** 实际会用的那档：选了且这只模型有的；否则模型自己的默认。API 模型是 null（用模型页的默认）。 */
export function textEffortOf(option: TextOption | null, effort: TextEffort | null): TextEffort | null {
  if (!option?.agent) return null;
  return effort && option.info.efforts.includes(effort) ? effort : option.info.defaultEffort;
}

/** 推理强度那一档的名字。 */
export function textEffortName(effort: TextEffort): string {
  return effortLabel(effort, EFFORT_LABEL[effort]);
}

/** 收起时那一行：「提供方 · 模型」，智能体再接推理强度。 */
export function textPickLabel(option: TextOption | null, effort: TextEffort | null): string {
  if (!option) return M.placeholder;
  const applied = textEffortOf(option, effort);
  return [option.provider, optionName(option), applied ? textEffortName(applied) : null].filter(Boolean).join(' · ');
}

/**
 * 在第二级选了一只模型：同一家的智能体沿用已选的强度（新模型也有这一档时），换了一家或是 API 模型回到 null（产品设计 §7.6）。
 */
export function pickModel(option: TextOption, current: { option: TextOption | null; effort: TextEffort | null }): TextPick {
  const same = !!option.agent && current.option?.providerId === option.providerId;
  const effort = same && current.effort && option.info.efforts.includes(current.effort) ? current.effort : null;
  return { key: option.key, effort };
}

/** 在推理强度那组选了一档：用 `effortOption` 那只模型（这家已选着的，否则「Agent 默认模型」）。 */
export function pickEffort(option: TextOption, effort: TextEffort): TextPick {
  return { key: option.key, effort };
}

/** 交给请求的推理强度：只有智能体、选过而且这只模型有这一档时才给（API 模型用模型页的默认；没给时用模型自己的默认）。 */
export function sentEffort(option: Pick<TextOption, 'agent' | 'info'> | null, effort: TextEffort | null): TextEffort | undefined {
  return option?.agent && effort && option.info.efforts.includes(effort) ? effort : undefined;
}

/** `sentEffort` 写成请求里的那一项（没有时不出现）。 */
export function requestEffort(option: Pick<TextOption, 'agent' | 'info'> | null, effort: TextEffort | null): { effort?: TextEffort } {
  const sent = sentEffort(option, effort);
  return sent ? { effort: sent } : {};
}
