// OpenAI Chat Completions（`generateText`，架构设计 §6.4）：OpenAI 与 OpenAI 兼容端点共用的请求与响应形状。
// 2026-10-03 读过的文档：
//   https://platform.openai.com/docs/api-reference/chat/create
//   https://platform.openai.com/docs/guides/structured-outputs
//   https://platform.openai.com/docs/guides/reasoning
//   https://platform.openai.com/docs/guides/error-codes
// 文档确认的：`POST {base}/chat/completions`（JSON，Bearer）；`messages[{ role, content }]`；`max_completion_tokens`
// （推理模型不再接受 `max_tokens`）；`reasoning_effort`；`response_format: { type: 'json_schema', json_schema: { name, schema,
// strict } }`；`seed`；`choices[0].message.content` / `.refusal`、`finish_reason`（`stop`、`length`、`content_filter`……）；
// `usage.prompt_tokens` / `completion_tokens`；`model` 是带日期的快照名；上下文过长是 400 `context_length_exceeded`，
// 模型不存在是 404 `model_not_found`，额度用尽是 429 `insufficient_quota`。
// 取舍：选 Chat Completions 而不是 Responses，兼容端点几乎都只实现它，两边共用一份代码。`strict` 发 false：严格模式只接受
// schema 的一个子集（全部字段必填、不许额外字段），任意的 schema 会在执行时被拒绝；不论供应商是否严格遵守，输出都在本地
// 按 schema 校验。兼容端点用 `max_tokens`（自建服务普遍只认它）。
import { ProviderFailure, type TextParameters, type TextReply } from '@baocut/models';
import type { TextFinishReason } from '@baocut/protocol';
import { textTimeoutMs, type TextRequest } from '../adapter.ts';
import { providerFetch, type RejectionCode } from '../http/provider-fetch.ts';
import { authOf, httpOptions } from './openai-transcription.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export interface ChatCompletionsStyle {
  label: string;
  version: string;
  /** 输出上限的字段名。 */
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  /**
   * 结构化输出的写法：`json_schema`（默认）发 schema；`json_object` 给只支持 JSON 模式的服务商——要 JSON 对象，并把 schema
   * 写进一条系统消息。两种写法的输出都在本地按 schema 校验。
   */
  jsonMode?: 'json_schema' | 'json_object';
}

export function chatCompletionsBody(modelId: string, parameters: TextParameters, style: ChatCompletionsStyle): Record<string, unknown> {
  const format = parameters.responseFormat;
  const jsonObject = format.type === 'json' && style.jsonMode === 'json_object';
  const messages = parameters.messages.map((m) => ({ role: m.role, content: m.content }));
  if (jsonObject) {
    messages.unshift({
      role: 'system',
      content: `Reply with a single JSON object that conforms to this JSON Schema:\n${JSON.stringify(format.schema)}`,
    });
  }
  return {
    model: modelId,
    messages,
    [style.maxTokensField]: parameters.maxOutputTokens,
    ...(parameters.effort !== null ? { reasoning_effort: parameters.effort } : {}),
    ...(parameters.temperature !== null ? { temperature: parameters.temperature } : {}),
    ...(parameters.seed !== null ? { seed: parameters.seed } : {}),
    ...(jsonObject ? { response_format: { type: 'json_object' } } : {}),
    ...(format.type === 'json' && !jsonObject
      ? { response_format: { type: 'json_schema', json_schema: { name: format.name ?? 'output', schema: format.schema, strict: false } } }
      : {}),
  };
}

export async function chatCompletions(request: TextRequest, style: ChatCompletionsStyle): Promise<TextReply> {
  const { config } = request;
  const body = JSON.stringify(chatCompletionsBody(request.model.modelId, request.parameters, style));
  const response = await providerFetch(httpOptions(style.label, config, request.http), {
    method: 'POST',
    url: `${config.baseUrl}/chat/completions`,
    headers: { 'content-type': 'application/json' },
    auth: authOf(config),
    body: () => body,
    timeoutMs: textTimeoutMs(request.http),
    signal: request.signal,
    classify: classifyChatCompletions,
    onRetry: request.onRetry,
  });
  return parseChatCompletion(response.json(), style);
}

export function parseChatCompletion(value: unknown, style: Pick<ChatCompletionsStyle, 'label' | 'version'>): TextReply {
  if (!isObject(value)) throw new ProviderFailure('protocol', PH.notObject({ label: style.label }).text);
  const choice = Array.isArray(value.choices) ? value.choices.find(isObject) : undefined;
  if (!choice) throw new ProviderFailure('protocol', PH.missingField({ label: style.label, field: 'choices' }).text);
  const message = isObject(choice.message) ? choice.message : {};
  // 结构化输出时模型拒绝回答（`refusal`）：按内容过滤处理。
  const refused = typeof message.refusal === 'string' && message.refusal.trim().length > 0;
  const text = typeof message.content === 'string' ? message.content : '';
  const finishReason: TextFinishReason = refused ? 'content-filter' : finishOf(choice.finish_reason, style.label);
  const usage = isObject(value.usage) ? usageOf(value.usage) : null;
  return {
    text,
    finishReason,
    usage,
    modelVersion: typeof value.model === 'string' && value.model ? value.model : null,
    workerVersion: style.version,
  };
}

/** `prompt_tokens` 已含缓存命中；命中数在 `prompt_tokens_details.cached_tokens`，有的服务商写 `prompt_cache_hit_tokens`。 */
function usageOf(usage: Record<string, unknown>): NonNullable<TextReply['usage']> {
  const details = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const cached = countOf(details.cached_tokens) ?? countOf(usage.prompt_cache_hit_tokens);
  return {
    inputTokens: countOf(usage.prompt_tokens),
    outputTokens: countOf(usage.completion_tokens),
    ...(cached !== null && cached > 0 ? { cachedTokens: cached } : {}),
  };
}

function finishOf(value: unknown, label: string): TextFinishReason {
  // 有的兼容端点不给 `finish_reason`：当作正常结束。
  if (value === 'stop' || value === null || value === undefined) return 'stop';
  if (value === 'length') return 'length';
  if (value === 'content_filter') return 'content-filter';
  throw new ProviderFailure('protocol', PH.unexpectedFinish({ label, reason: String(value).slice(0, 40) }).text);
}

/** 上下文过长 → `INPUT_TOO_LONG`；模型不存在 → `PROVIDER_REJECTED`（`model-not-found`）；输入被内容过滤 → `content-filter`。 */
export function classifyChatCompletions(status: number, body: string): { code: RejectionCode; reason?: string } | null {
  const code = errorCode(body);
  if (code === 'context_length_exceeded' || (status === 400 && /maximum context length|context length|too many tokens/i.test(body))) {
    return { code: 'INPUT_TOO_LONG', reason: 'context-length' };
  }
  if (code === 'model_not_found' || (status === 404 && /model/i.test(body)))
    return { code: 'PROVIDER_REJECTED', reason: 'model-not-found' };
  if (code === 'content_filter' || code === 'content_policy_violation') return { code: 'PROVIDER_REJECTED', reason: 'content-filter' };
  if (code === 'insufficient_quota') return { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'insufficient-quota' };
  if (status === 429) return { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'rate-limited' };
  return null;
}

function errorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; type?: unknown } };
    const code = parsed.error?.code ?? parsed.error?.type;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
