import type { ProviderVendorInfo, TextModelInfo } from '@baocut/protocol';
import { ProvidersConfig as PC } from '@baocut/protocol/messages/providers';

/**
 * 服务商目录里的 OpenAI 兼容文本服务商（架构设计 §6.4 的目录表）：显示名、`kind`、官网、图标、基址（有国际与中国两个基址的
 * 按账号的 `region` 取）与内置模型表。只实现了 `generateText`；目录里标 P1 的语音、转写与生图只写进 `vendor.planned`，
 * 界面据此标「尚未接入」，不作为能力报告。
 *
 * 模型表按各家的官方目录维护，2026-10-16 核对；每家保留少量主力模型，第一个是默认。未逐个核对的限制取保守值：上下文
 * 128K token、单次输出 8192 token；已核对的按模型覆盖。推理强度只声明已核对的档位，适配器按服务商换算；
 * `temperature` 按模型声明，`seed` 不发。费用按 `unknown`。`models.refreshProvider` 取到的列表里没有的
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
  /** 产品的推理强度 → 服务商的参数值；未指定时原样发送。 */
  effortMap?: Partial<Record<TextModelInfo['efforts'][number], string>>;
  /** 没指定推理强度时并进请求体的字段。 */
  bodyWithoutEffort?: Record<string, unknown>;
  models: TextModelInfo[];
}

function text(modelId: string, label: string, isDefault = false, extra: Partial<TextModelInfo> = {}): TextModelInfo {
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
    ...extra,
  };
}

const GLOBAL_CN = ['global', 'cn'];

export const COMPAT_VENDORS: Record<CompatVendorId, CompatVendor> = {
  deepseek: {
    label: 'DeepSeek',
    vendor: { kind: 'vendor', website: 'https://platform.deepseek.com', icon: 'deepseek' },
    regions: { global: 'https://api.deepseek.com/v1' },
    jsonMode: 'json_object',
    // V4 thinks by default and max_tokens covers reasoning and answer together, so a whole-page rewrite can spend the
    // limit on reasoning and come back as HTTP 200 with empty content. No effort is declared, so thinking is always off.
    bodyWithoutEffort: { thinking: { type: 'disabled' } },
    // V4.1 is the model version; the API id remains deepseek-flash.
    // https://api-docs.deepseek.com/quick_start/pricing/
    models: [text('deepseek-v4-pro', 'DeepSeek V4 Pro', true), text('deepseek-flash', 'DeepSeek V4.1 Flash')],
  },
  moonshot: {
    get label() {
      return PC.vendorKimi().text;
    },
    vendor: { kind: 'vendor', regions: GLOBAL_CN, website: 'https://platform.moonshot.ai', icon: 'moonshot' },
    regions: { global: 'https://api.moonshot.ai/v1', cn: 'https://api.moonshot.cn/v1' },
    jsonMode: 'json_object',
    // https://platform.kimi.ai/docs/models
    models: [text('kimi-k3', 'Kimi K3', true), text('kimi-k2.7-code', 'Kimi K2.7 Code'), text('kimi-k2.6', 'Kimi K2.6')],
  },
  qwen: {
    get label() {
      return PC.vendorQwen().text;
    },
    vendor: { kind: 'vendor', regions: GLOBAL_CN, website: 'https://bailian.console.aliyun.com', icon: 'qwen', planned: ['synthesizeSpeech', 'transcribe'] },
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
    // GLM-5.3 / Flash always think. Our low / medium / high map to low / high / max.
    // https://docs.z.ai/guides/llm/glm-5.3
    // https://docs.z.ai/guides/vlm/glm-5.3-flash
    // https://docs.bigmodel.cn/cn/guide/capabilities/thinking
    effortMap: { low: 'low', medium: 'high', high: 'max' },
    models: ['glm-5.3', 'glm-5.3-flash'].map((id, index) =>
      text(id, index === 0 ? 'GLM-5.3' : 'GLM-5.3 Flash', index === 0, {
        contextTokens: 1_048_576,
        maxOutputTokens: 131_072,
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'high',
      }),
    ),
  },
  minimax: {
    label: 'MiniMax',
    vendor: { kind: 'vendor', regions: GLOBAL_CN, website: 'https://platform.minimax.io', icon: 'minimax', planned: ['synthesizeSpeech'] },
    regions: { global: 'https://api.minimax.io/v1', cn: 'https://api.minimaxi.com/v1' },
    jsonMode: 'json_object',
    // https://platform.minimax.io/docs/guides/models-intro
    // M3.1 Flash Preview is M Plan / MiniMax Code only. M2.7 remains available until 2026-11-18.
    models: [text('MiniMax-M3', 'MiniMax M3', true), text('MiniMax-M2.7', 'MiniMax M2.7')],
  },
  volcengine: {
    get label() {
      return PC.vendorVolcengine().text;
    },
    vendor: { kind: 'vendor', website: 'https://www.volcengine.com/product/ark', icon: 'volcengine', planned: ['generateImage'] },
    regions: { cn: 'https://ark.cn-beijing.volces.com/api/v3' },
    jsonMode: 'json_object',
    // Ark model ids include hyphenated versions and the release date.
    // https://docs.volcengine.com/docs/ark/responses-api-deep-thinking?lang=zh
    models: [text('doubao-seed-2-1-pro-260915', 'Doubao Seed 2.1 Pro', true), text('doubao-seed-2-1-lite-260915', 'Doubao Seed 2.1 Lite')],
  },
  xai: {
    get label() {
      return PC.vendorXai().text;
    },
    vendor: { kind: 'vendor', website: 'https://console.x.ai', icon: 'xai', planned: ['generateImage'] },
    regions: { global: 'https://api.x.ai/v1' },
    jsonMode: 'json_schema',
    // https://docs.x.ai/developers/models — no published grok-4.7-mini.
    models: [text('grok-4.7', 'Grok 4.7', true, { contextTokens: 500_000, efforts: ['low', 'medium', 'high'], defaultEffort: 'high' })],
  },
  mistral: {
    label: 'Mistral',
    vendor: { kind: 'vendor', website: 'https://console.mistral.ai', icon: 'mistral' },
    regions: { global: 'https://api.mistral.ai/v1' },
    jsonMode: 'json_schema',
    models: [
      text('mistral-large-latest', 'Mistral Large', true),
      // https://docs.mistral.ai/models/mistral-large-4-0 — public preview; keep the existing alias as default.
      text('mistral-large-4', 'Mistral Large 4', false, { contextTokens: 1_000_000 }),
      text('mistral-medium-latest', 'Mistral Medium'),
      text('mistral-small-latest', 'Mistral Small'),
    ],
  },
  groq: {
    label: 'Groq',
    vendor: { kind: 'vendor', website: 'https://console.groq.com', icon: 'groq', planned: ['transcribe'] },
    regions: { global: 'https://api.groq.com/openai/v1' },
    jsonMode: 'json_schema',
    // https://console.groq.com/docs/models — Llama 3.3 is now enterprise-only; GPT-OSS 20B is the fast public option.
    models: [text('openai/gpt-oss-120b', 'GPT-OSS 120B', true), text('openai/gpt-oss-20b', 'GPT-OSS 20B'), text('llama-3.3-70b-versatile', 'Llama 3.3 70B')],
  },
  openrouter: {
    label: 'OpenRouter',
    vendor: { kind: 'relay', website: 'https://openrouter.ai', icon: 'openrouter' },
    regions: { global: 'https://openrouter.ai/api/v1' },
    jsonMode: 'json_schema',
    models: [
      // IDs and sampling support verified against https://openrouter.ai/api/v1/models on 2026-10-16.
      text('anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', true, { acceptsTemperature: false }),
      text('openai/gpt-6.1-sol', 'GPT-6.1 Sol', false, { acceptsTemperature: false }),
      text('google/gemini-4-argon', 'Gemini 4 Argon', false, { acceptsTemperature: false }),
      text('google/gemini-3.8-flash', 'Gemini 3.8 Flash'),
    ],
  },
  siliconflow: {
    get label() {
      return PC.vendorSiliconflow().text;
    },
    vendor: { kind: 'relay', website: 'https://cloud.siliconflow.cn', icon: 'siliconflow', planned: ['synthesizeSpeech', 'transcribe'] },
    regions: { cn: 'https://api.siliconflow.cn/v1' },
    jsonMode: 'json_object',
    // Full listing requires a key (GET /models returns 401); retain existing IDs until an account refresh confirms changes.
    models: [text('zai-org/GLM-5.3', 'GLM-5.3', true), text('moonshotai/Kimi-K3', 'Kimi K3'), text('Qwen/Qwen3.7-Max', 'Qwen3.7 Max')],
  },
};
