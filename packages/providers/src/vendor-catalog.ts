import type { ProviderVendorInfo, TextModelInfo } from '@baocut/protocol';
import { ProvidersConfig as PC } from '@baocut/protocol/messages/providers';

/**
 * 服务商目录里的 OpenAI 兼容文本服务商（架构设计 §6.4 的目录表）：显示名、`kind`、官网、图标、基址（有国际与中国两个基址的
 * 按账号的 `region` 取）与内置模型表。只列已经实现的能力（`generateText`）；目录里标 P1 的语音、转写与生图不在这里声明。
 *
 * 模型表取自各家 2026-10 的模型列表，每家 2–4 个当前主力模型，第一个是默认。限制没有逐个核对，取保守值：上下文
 * 128K token、单次输出 8192 token（请求的上限超过时在提交时拒绝，不会被供应商截断）；推理强度不声明（不发
 * `reasoning_effort`）；`temperature` 照发，`seed` 不发。费用按 `unknown`。`models.refreshProvider` 取到的列表里没有的
 * 模型会标为不可用，不需要猜错的 ID 继续占着默认值。
 */

export const COMPAT_VENDOR_IDS = [
  'deepseek',
  'moonshot',
  'qwen',
  'zhipu',
  'minimax',
  'volcengine',
  'xai',
  'mistral',
  'groq',
  'openrouter',
  'siliconflow',
] as const;
export type CompatVendorId = (typeof COMPAT_VENDOR_IDS)[number];

export interface CompatVendor {
  label: string;
  vendor: ProviderVendorInfo;
  /** 地区 → 基址；第一个是缺省的地区。 */
  regions: Record<string, string>;
  jsonMode: 'json_schema' | 'json_object';
  models: TextModelInfo[];
}

function text(modelId: string, label: string, isDefault = false): TextModelInfo {
  return {
    modelId,
    label,
    ...(isDefault ? { default: true } : {}),
    contextTokens: 128_000,
    maxOutputTokens: 8192,
    efforts: [],
    defaultEffort: null,
    structuredOutput: true,
    acceptsTemperature: true,
    acceptsSeed: false,
    cost: 'unknown',
  };
}

const GLOBAL_CN = ['global', 'cn'];

export const COMPAT_VENDORS: Record<CompatVendorId, CompatVendor> = {
  deepseek: {
    label: 'DeepSeek',
    vendor: { kind: 'vendor', website: 'https://platform.deepseek.com', icon: 'deepseek' },
    regions: { global: 'https://api.deepseek.com/v1' },
    jsonMode: 'json_object',
    models: [text('deepseek-v4-pro', 'DeepSeek V4 Pro', true), text('deepseek-v4.1-flash', 'DeepSeek V4.1 Flash')],
  },
  moonshot: {
    get label() {
      return PC.vendorKimi().text;
    },
    vendor: { kind: 'vendor', regions: GLOBAL_CN, website: 'https://platform.moonshot.ai', icon: 'moonshot' },
    regions: { global: 'https://api.moonshot.ai/v1', cn: 'https://api.moonshot.cn/v1' },
    jsonMode: 'json_object',
    models: [text('kimi-k3', 'Kimi K3', true), text('kimi-k2.6', 'Kimi K2.6')],
  },
  qwen: {
    get label() {
      return PC.vendorQwen().text;
    },
    vendor: { kind: 'vendor', regions: GLOBAL_CN, website: 'https://bailian.console.aliyun.com', icon: 'qwen' },
    regions: {
      global: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      cn: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    jsonMode: 'json_object',
    models: [text('qwen3.8-max', 'Qwen3.8 Max', true), text('qwen3.8-flash', 'Qwen3.8 Flash'), text('qwen3.7-plus', 'Qwen3.7 Plus')],
  },
  zhipu: {
    get label() {
      return PC.vendorZhipu().text;
    },
    vendor: { kind: 'vendor', regions: GLOBAL_CN, website: 'https://z.ai', icon: 'zhipu' },
    regions: { global: 'https://api.z.ai/api/paas/v4', cn: 'https://open.bigmodel.cn/api/paas/v4' },
    jsonMode: 'json_object',
    models: [text('glm-5.3', 'GLM-5.3', true), text('glm-5.3-flash', 'GLM-5.3 Flash')],
  },
  minimax: {
    label: 'MiniMax',
    vendor: { kind: 'vendor', regions: GLOBAL_CN, website: 'https://platform.minimax.io', icon: 'minimax' },
    regions: { global: 'https://api.minimax.io/v1', cn: 'https://api.minimaxi.com/v1' },
    jsonMode: 'json_object',
    models: [text('MiniMax-M3', 'MiniMax M3', true), text('MiniMax-M2.7', 'MiniMax M2.7')],
  },
  volcengine: {
    get label() {
      return PC.vendorVolcengine().text;
    },
    vendor: { kind: 'vendor', website: 'https://www.volcengine.com/product/ark', icon: 'volcengine' },
    regions: { cn: 'https://ark.cn-beijing.volces.com/api/v3' },
    jsonMode: 'json_object',
    models: [text('doubao-seed-2.1-pro', 'Doubao Seed 2.1 Pro', true), text('doubao-seed-2.1-lite', 'Doubao Seed 2.1 Lite')],
  },
  xai: {
    get label() {
      return PC.vendorXai().text;
    },
    vendor: { kind: 'vendor', website: 'https://console.x.ai', icon: 'xai' },
    regions: { global: 'https://api.x.ai/v1' },
    jsonMode: 'json_schema',
    models: [text('grok-4.7', 'Grok 4.7', true), text('grok-4.7-mini', 'Grok 4.7 Mini')],
  },
  mistral: {
    label: 'Mistral',
    vendor: { kind: 'vendor', website: 'https://console.mistral.ai', icon: 'mistral' },
    regions: { global: 'https://api.mistral.ai/v1' },
    jsonMode: 'json_schema',
    models: [
      text('mistral-large-latest', 'Mistral Large', true),
      text('mistral-medium-latest', 'Mistral Medium'),
      text('mistral-small-latest', 'Mistral Small'),
    ],
  },
  groq: {
    label: 'Groq',
    vendor: { kind: 'vendor', website: 'https://console.groq.com', icon: 'groq' },
    regions: { global: 'https://api.groq.com/openai/v1' },
    jsonMode: 'json_schema',
    models: [text('openai/gpt-oss-120b', 'GPT-OSS 120B', true), text('llama-3.3-70b-versatile', 'Llama 3.3 70B')],
  },
  openrouter: {
    label: 'OpenRouter',
    vendor: { kind: 'relay', website: 'https://openrouter.ai', icon: 'openrouter' },
    regions: { global: 'https://openrouter.ai/api/v1' },
    jsonMode: 'json_schema',
    models: [
      text('anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', true),
      text('openai/gpt-5.5', 'GPT-5.5'),
      text('google/gemini-3.8-flash', 'Gemini 3.8 Flash'),
    ],
  },
  siliconflow: {
    get label() {
      return PC.vendorSiliconflow().text;
    },
    vendor: { kind: 'relay', website: 'https://cloud.siliconflow.cn', icon: 'siliconflow' },
    regions: { cn: 'https://api.siliconflow.cn/v1' },
    jsonMode: 'json_object',
    models: [text('zai-org/GLM-5.3', 'GLM-5.3', true), text('moonshotai/Kimi-K3', 'Kimi K3'), text('Qwen/Qwen3.7-Max', 'Qwen3.7 Max')],
  },
};
