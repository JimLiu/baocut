import { localizeText, type ModelCapabilitiesView, type ModelInfoBase, type ModelRef } from '@baocut/protocol';
import { addedProviderIds } from './api-providers.ts';
import { defaultKey, isCustomProvider } from './models-cloud.ts';
import type { ModelCategory } from './settings-nav.ts';
import { imageModelOptions } from './tools-image.ts';
import { cloudModelOptions, localModelOptions, type ToolModelOption } from './tools-models.ts';

/**
 * 每种能力一个默认模型（产品设计 §7.6「每种能力一个默认模型」，2026-10-12 用户裁决）：同时有本机与云端模型的能力
 * （语音识别、语音合成、图像生成）在能力页顶上、本地 / 云端页签之上放一个选择器，本机、局域网节点、云端与智能体的模型
 * 都在一个菜单里，按出厂顺序分组，不能用的置灰写原因。它写的就是 Runtime 的那一个默认值（`models.setDefault`），
 * 工具页、编辑器、命令行与 Agent 不指定模型时都用它。只有本机或只有云端的能力仍在各自页里设。
 */

export type DefaultCapability = 'transcribe' | 'synthesizeSpeech' | 'generateImage';

/** 有统一默认选择器的能力分类。 */
export const UNIFIED_DEFAULT: Partial<Record<ModelCategory, DefaultCapability>> = {
  asr: 'transcribe',
  tts: 'synthesizeSpeech',
  image: 'generateImage',
};

export function unifiedDefaultCapability(category: ModelCategory): DefaultCapability | null {
  return UNIFIED_DEFAULT[category] ?? null;
}

/** 菜单第一项的键：清掉默认（语音识别、图像生成是「自动」，语音合成是「未设置」）。 */
export const AUTO_KEY = 'auto';

export type DefaultModelOption = ToolModelOption<ModelInfoBase>;

export interface DefaultGroup {
  key: string;
  /** 分组标题：服务商名；本机一组由页面写「这台电脑」。 */
  title: string;
  local: boolean;
  options: DefaultModelOption[];
}

export interface CapabilityDefaultPicker {
  /** 勾着的项：没设默认时 `AUTO_KEY`。 */
  selectedKey: string;
  /** 清掉默认时怎样：`auto` 按出厂顺序挑（语音识别、图像生成），`unset` 每次自己选（语音合成）。 */
  clear: 'auto' | 'unset';
  /** 「自动」此刻会用哪只（服务商 · 模型）；没有能用的、或这种能力没有自动时 null。 */
  autoUses: string | null;
  groups: DefaultGroup[];
  /** 默认指向的模型已不在菜单里（服务商删了、模型下架）：单列一项、勾着，名字照存的写。 */
  missing: { key: string; label: string } | null;
}

/** 局域网节点（`kind: 'node'`）的模型：在线的才能用。 */
function nodeModelOptions(view: ModelCapabilitiesView, capability: DefaultCapability): DefaultModelOption[] {
  return view[capability].providers
    .filter((p) => p.kind === 'node')
    .flatMap((p) =>
      (p.models as ModelInfoBase[]).map((info) => {
        const why = !p.available
          ? (localizeText(p.detail, p.detailRef) ?? p.unavailableReason ?? null)
          : info.available === false
            ? (localizeText(info.detail, info.detailRef) ?? null)
            : null;
        return {
          key: defaultKey({ providerId: p.providerId, modelId: info.modelId }),
          providerId: p.providerId,
          provider: p.label,
          modelId: info.modelId,
          label: info.label || info.modelId,
          connected: true,
          usable: why === null && p.available && info.available !== false,
          why,
          info,
        };
      }),
    );
}

/**
 * 菜单里的模型，按这种能力的出厂顺序（架构设计 §6.2）：图像生成是能画的 Codex › 本机 › 云端（不能画的 Codex 在最后）；
 * 语音识别是本机 › 局域网节点 › 云端；语音合成是本机 › 云端。云端只列已添加的 API 提供方（设计稿 settings-capability.jsx ①：
 * 目录里没添加的在下面的「API 提供方」一节里配置）：已连接的列全部模型，没连上的列它的第一只、写「未连接」。
 */
export function defaultModelOptions(view: ModelCapabilitiesView, capability: DefaultCapability): DefaultModelOption[] {
  const added = addedProviderIds(view);
  const listed = (o: DefaultModelOption) => !!o.local || !!o.agent || o.providerId.startsWith('node:') || isCustomProvider(o.providerId) || added.has(o.providerId);
  if (capability === 'generateImage') return (imageModelOptions(view) as DefaultModelOption[]).filter(listed);
  return [
    ...(localModelOptions(view, capability) as DefaultModelOption[]),
    ...(capability === 'transcribe' ? nodeModelOptions(view, capability) : []),
    ...(cloudModelOptions(view, capability) as DefaultModelOption[]).filter(listed),
  ];
}

/** 一只模型在摘要里的名字：本机与智能体写模型名，其余写「服务商 · 模型」。 */
export function defaultOptionName(option: Pick<DefaultModelOption, 'local' | 'agent' | 'provider' | 'label' | 'modelId'>): string {
  return option.local || option.agent ? option.label : `${option.provider} · ${option.modelId}`;
}

function autoTarget(view: ModelCapabilitiesView, capability: DefaultCapability, options: readonly DefaultModelOption[]): DefaultModelOption | null {
  const effective = view[capability].effective;
  if (effective?.source === 'factory-default') {
    const key = defaultKey(effective);
    const hit = options.find((o) => o.key === key);
    if (hit) return hit;
  }
  // 有用户默认时 Runtime 不报「自动」会用谁：按同一个顺序推一遍（图像生成跳过要提醒的 Codex，语音识别只取本机）。
  if (capability === 'generateImage') return options.find((o) => o.usable && !o.caution) ?? null;
  if (capability === 'transcribe') return options.find((o) => o.local && o.usable) ?? null;
  return null;
}

export function capabilityDefaultPicker(view: ModelCapabilitiesView, capability: DefaultCapability): CapabilityDefaultPicker {
  const options = defaultModelOptions(view, capability);
  const clear = capability === 'synthesizeSpeech' ? 'unset' : 'auto';
  const auto = clear === 'auto' ? autoTarget(view, capability, options) : null;
  const groups: DefaultGroup[] = [];
  for (const o of options) {
    const key = o.local ? 'local' : o.providerId;
    const g = groups.find((x) => x.key === key);
    if (g) g.options.push(o);
    else groups.push({ key, title: o.provider, local: !!o.local, options: [o] });
  }
  const current: ModelRef | null = view[capability].default;
  const selectedKey = current ? defaultKey(current) : AUTO_KEY;
  const missing =
    current && !options.some((o) => o.key === selectedKey)
      ? {
          key: selectedKey,
          label: `${view[capability].providers.find((p) => p.providerId === current.providerId)?.label ?? current.providerId} · ${current.modelId}`,
        }
      : null;
  return { selectedKey, clear, autoUses: auto ? defaultOptionName(auto) : null, groups, missing };
}
