// Anthropic 的文本模型（`generateText`，架构设计 §6.4）：Messages 原生适配器。2026-09-25 读过的文档：
//   https://platform.claude.com/docs/en/api/messages
//   https://platform.claude.com/docs/en/about-claude/models/overview
//   https://platform.claude.com/docs/en/about-claude/pricing
// 文档确认的：`POST {base}/v1/messages`（JSON；`x-api-key` 与 `anthropic-version: 2023-06-01` 请求头）；系统消息放顶层
// `system`；`max_tokens` 必须给出；结构化输出是 `output_config.format: { type: 'json_schema', schema }`，推理强度是
// `output_config.effort`（low / medium / high）；响应的 `content[]` 里 `text` 块是正文、`thinking` 块跳过；`stop_reason`
// 为 end_turn / stop_sequence / max_tokens / refusal；`usage.input_tokens` 不含缓存命中，另有 `cache_read_input_tokens`；
// 错误体 `{ error: { type, message } }`；`GET {base}/v1/models` 返回 `data[].id`。
// 模型：claude-opus-5-5 与 claude-sonnet-5-5 上下文 1M、单次输出至多 128K，不接受采样参数（temperature 等），推理强度默认
// 分别是 medium 与 high；claude-haiku-4-5 上下文 200K、输出 64K，不能调推理强度，接受 temperature。没有 `seed`。
// 取舍：请求不用流式，单次输出按 64K 声明（更长的输出不流式容易超过请求的期限）；不开 extended thinking。默认模型选均衡的
// claude-sonnet-5-5。模型 ID 不带日期后缀。
import { ProviderFailure, type TextReply } from '@baocut/models';
import type { TextFinishReason, TextModelInfo } from '@baocut/protocol';
import { textTimeoutMs, type AdapterConfig, type AdapterHttp, type ModelLister, type ProviderListing, type TextAdapter, type TextRequest } from '../adapter.ts';
import { providerFetch, type RejectionCode } from '../http/provider-fetch.ts';
import { httpOptions } from '../openai/openai-transcription.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
const LABEL = 'Anthropic';
const API_VERSION = '2023-06-01';

function model(modelId: string, label: string, extra: Partial<TextModelInfo>): TextModelInfo {
  return {
    modelId,
    label,
    contextTokens: 1_000_000,
    maxOutputTokens: 64_000,
    efforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    structuredOutput: true,
    acceptsTemperature: false,
    acceptsSeed: false,
    cost: 'unknown',
    ...extra,
  };
}

const MODELS: TextModelInfo[] = [
  model('claude-sonnet-5-5', 'Claude Sonnet 5.5', { default: true }),
  model('claude-opus-5-5', 'Claude Opus 5.5', { defaultEffort: 'medium' }),
  model('claude-haiku-4-5', 'Claude Haiku 4.5', { contextTokens: 200_000, efforts: [], defaultEffort: null, acceptsTemperature: true }),
];

export class AnthropicTextAdapter implements TextAdapter, ModelLister {
  readonly version = 'baocut-providers/anthropic-text@1';

  models(_config: AdapterConfig): TextModelInfo[] {
    return structuredClone(MODELS);
  }

  async generate(request: TextRequest): Promise<TextReply> {
    const { config } = request;
    const body = JSON.stringify(anthropicBody(request.model.modelId, request.parameters));
    const response = await providerFetch(httpOptions(LABEL, config, request.http), {
      method: 'POST',
      url: `${config.baseUrl}/v1/messages`,
      headers: { 'content-type': 'application/json', 'anthropic-version': API_VERSION },
      auth: authOf(config),
      body: () => body,
      timeoutMs: textTimeoutMs(request.http),
      signal: request.signal,
      classify: classifyAnthropic,
      onRetry: request.onRetry,
    });
    return parseAnthropicMessage(response.json(), this.version);
  }

  /** `GET {base}/v1/models`：`data[].id`。也用来验证密钥。 */
  async listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing> {
    const response = await providerFetch(httpOptions(LABEL, config, { ...http, attempts: 1 }), {
      method: 'GET',
      url: `${config.baseUrl}/v1/models?limit=1000`,
      headers: { 'anthropic-version': API_VERSION },
      auth: authOf(config),
      timeoutMs: http.timeoutMs ?? 15_000,
      signal,
      classify: classifyAnthropic,
    });
    const value = response.json<{ data?: unknown }>();
    if (!value || !Array.isArray(value.data)) throw new ProviderFailure('protocol', PH.listShape({ label: LABEL, shape: '{ data: [...] }' }).text);
    const models = value.data.flatMap((m) => (isObject(m) && typeof m.id === 'string' ? [m.id] : []));
    return { models: [...new Set(models)].sort() };
  }

  async validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    await this.listModels(config, signal, http);
  }
}

function authOf(config: AdapterConfig): { header: string; value: string } | null {
  return config.credential ? { header: 'x-api-key', value: config.credential } : null;
}

export function anthropicBody(modelId: string, parameters: TextRequest['parameters']): Record<string, unknown> {
  const system = parameters.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const format = parameters.responseFormat;
  const outputConfig = {
    ...(parameters.effort !== null ? { effort: parameters.effort === 'minimal' ? 'low' : parameters.effort } : {}),
    ...(format.type === 'json' ? { format: { type: 'json_schema', schema: format.schema } } : {}),
  };
  return {
    model: modelId,
    max_tokens: parameters.maxOutputTokens,
    ...(system ? { system } : {}),
    messages: parameters.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
    ...(parameters.temperature !== null ? { temperature: parameters.temperature } : {}),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  };
}

export function parseAnthropicMessage(value: unknown, version: string): TextReply {
  if (!isObject(value)) throw new ProviderFailure('protocol', PH.notObject({ label: LABEL }).text);
  if (!Array.isArray(value.content)) throw new ProviderFailure('protocol', PH.missingField({ label: LABEL, field: 'content' }).text);
  const text = value.content
    .filter((block): block is Record<string, unknown> => isObject(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  const usage = isObject(value.usage) ? usageOf(value.usage) : null;
  return {
    text,
    finishReason: finishOf(value.stop_reason),
    usage,
    modelVersion: typeof value.model === 'string' && value.model ? value.model : null,
    workerVersion: version,
  };
}

/** 输入换成「总数含缓存」：`input_tokens` 不含缓存的读与写。 */
function usageOf(usage: Record<string, unknown>): NonNullable<TextReply['usage']> {
  const input = countOf(usage.input_tokens);
  const cacheRead = countOf(usage.cache_read_input_tokens) ?? 0;
  const cacheWrite = countOf(usage.cache_creation_input_tokens) ?? 0;
  return {
    inputTokens: input === null ? null : input + cacheRead + cacheWrite,
    outputTokens: countOf(usage.output_tokens),
    ...(cacheRead > 0 ? { cachedTokens: cacheRead } : {}),
  };
}

function finishOf(value: unknown): TextFinishReason {
  if (value === 'end_turn' || value === 'stop_sequence' || value === null || value === undefined) return 'stop';
  if (value === 'max_tokens' || value === 'model_context_window_exceeded') return 'length';
  if (value === 'refusal') return 'content-filter';
  throw new ProviderFailure('protocol', PH.unexpectedFinish({ label: LABEL, reason: String(value).slice(0, 40) }).text);
}

/** 错误体 `{ error: { type, message } }`：提示过长 → `INPUT_TOO_LONG`；余额不足 → 额度用尽；模型不存在 → `model-not-found`。 */
export function classifyAnthropic(status: number, body: string): { code: RejectionCode; reason?: string } | null {
  let type: string | null = null;
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown; message?: unknown } };
    type = typeof parsed.error?.type === 'string' ? parsed.error.type : null;
    message = typeof parsed.error?.message === 'string' ? parsed.error.message : '';
  } catch {
    // 不是 JSON：按状态码。
  }
  if (type === 'authentication_error' || type === 'permission_error') return { code: 'PROVIDER_AUTH_FAILED' };
  if (/credit balance|billing/i.test(message)) return { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'insufficient-quota' };
  if (/prompt is too long|context window|too many tokens/i.test(message)) return { code: 'INPUT_TOO_LONG', reason: 'context-length' };
  if (type === 'not_found_error' && /model/i.test(message)) return { code: 'PROVIDER_REJECTED', reason: 'model-not-found' };
  if (type === 'rate_limit_error' || status === 429) return { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'rate-limited' };
  return null;
}

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
