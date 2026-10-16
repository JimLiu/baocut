// Google Gemini 文本模型（`generateText`，架构设计 §6.4）。2026-10-16 核对模型目录：
//   https://ai.google.dev/api/generate-content
//   https://ai.google.dev/gemini-api/docs/models
//   https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
//   https://ai.google.dev/gemini-api/docs/structured-output
//   https://ai.google.dev/gemini-api/docs/thinking
//   https://ai.google.dev/api/models#method:-models.list
// 文档确认的：`POST {base}/models/{model}:generateContent`（`x-goog-api-key` 请求头）；`contents[{ role: 'user' | 'model',
// parts: [{ text }] }]`、`systemInstruction`；`generationConfig` 的 `maxOutputTokens`、`temperature`、`seed`、
// `responseMimeType: 'application/json'` 与 `responseJsonSchema`、`thinkingConfig.thinkingLevel`；响应的
// `candidates[].finishReason`（`STOP`、`MAX_TOKENS`、`SAFETY`、`RECITATION`、`BLOCKLIST`、`PROHIBITED_CONTENT`、`SPII`……）、
// `content.parts[].thought`（思考摘要，不取）、`promptFeedback.blockReason`、`usageMetadata`（`promptTokenCount`、
// `candidatesTokenCount`、`thoughtsTokenCount`）、`modelVersion`。稳定的文本模型：gemini-3.8-flash（推荐）、3.7-flash、
// 3.6-flash、3.5-flash、3.5-flash-lite、3.1-flash-lite；3.8 与 3.7 的思考档位是 low / medium / high（API 默认 medium），
// 3.6 与 3.5-flash-lite 是 minimal–high（3.5-flash-lite 的 API 默认 minimal）。`GET {base}/models` 分页列出模型（`models[].name`
// 是 `models/<id>`，`nextPageToken`）。BaoCut 不用 API 默认档：没指定推理强度时下发模型表的 `defaultEffort`，取最低一档。
// 没能确认的：3.5-flash 与 3.1-flash-lite 的思考档位（按 minimal–high 声明）；各模型的
// 输出上限（按 65,536 token 声明）与上下文（按 1,048,576 token 声明）；上下文过长时的错误形状（按 400 正文里提到 token
// 上限的识别为 `INPUT_TOO_LONG`）。费用按 `unknown`。
// Gemini 4 Argon 使用统一的 1,048,576 token 窗口，同步输出上限 65,536，支持 low / medium / high；
// 不声明采样参数。保留 3.8 Flash 为均衡默认，不启用需要续传的 long decode。
import { ProviderFailure, type TextReply } from '@baocut/models';
import type { TextEffort, TextFinishReason, TextModelInfo } from '@baocut/protocol';
import {
  textTimeoutMs,
  type AdapterConfig,
  type AdapterHttp,
  type ModelLister,
  type ProviderListing,
  type TextAdapter,
  type TextRequest,
} from '../adapter.ts';
import { providerFetch, type RejectionCode } from '../http/provider-fetch.ts';
import { classifyGoogle, googleAuthOf, googleHttpOptions } from './google-adapter.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

const LABEL = 'Google Gemini';
const ALL: TextEffort[] = ['minimal', 'low', 'medium', 'high'];

function model(
  modelId: string,
  label: string,
  efforts: TextEffort[],
  defaultEffort: TextEffort,
  extra: Partial<TextModelInfo> = {},
): TextModelInfo {
  return {
    modelId,
    label,
    contextTokens: 1_048_576,
    maxOutputTokens: 65_536,
    efforts,
    defaultEffort,
    structuredOutput: true,
    acceptsTemperature: true,
    acceptsSeed: true,
    cost: 'unknown',
    ...extra,
  };
}

const MODELS: TextModelInfo[] = [
  model('gemini-3.8-flash', 'Gemini 3.8 Flash', ['low', 'medium', 'high'], 'low', { default: true }),
  model('gemini-4-argon', 'Gemini 4 Argon', ['low', 'medium', 'high'], 'low', { acceptsTemperature: false, acceptsSeed: false }),
  model('gemini-3.7-flash', 'Gemini 3.7 Flash', ['low', 'medium', 'high'], 'low'),
  model('gemini-3.6-flash', 'Gemini 3.6 Flash', ALL, 'minimal'),
  model('gemini-3.5-flash', 'Gemini 3.5 Flash', ALL, 'minimal'),
  model('gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', ALL, 'minimal'),
  model('gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', ALL, 'minimal'),
];

/** 内容过滤类的结束原因。 */
const FILTERED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);
/** 列模型至多翻这么多页。 */
const MAX_PAGES = 10;

export class GoogleTextAdapter implements TextAdapter, ModelLister {
  readonly version = 'baocut-providers/google-text@1';

  models(_config: AdapterConfig): TextModelInfo[] {
    return structuredClone(MODELS);
  }

  async generate(request: TextRequest): Promise<TextReply> {
    const { config, parameters } = request;
    const system = parameters.messages.filter((m) => m.role === 'system');
    const format = parameters.responseFormat;
    // 没指定推理强度时不下发 `thinkingConfig` 等于按 API 的默认档思考，而思考计入 `maxOutputTokens`：整页回写会被思考
    // 吃光输出上限、正文截断（AI 管线 §10.2）。所以下发模型表的 `defaultEffort`，都是模型最低的一档。
    const thinkingLevel = parameters.effort ?? request.model.defaultEffort;
    const body = JSON.stringify({
      contents: parameters.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      ...(system.length > 0 ? { systemInstruction: { parts: system.map((m) => ({ text: m.content })) } } : {}),
      generationConfig: {
        maxOutputTokens: parameters.maxOutputTokens,
        ...(parameters.temperature !== null ? { temperature: parameters.temperature } : {}),
        ...(parameters.seed !== null ? { seed: parameters.seed } : {}),
        ...(format.type === 'json' ? { responseMimeType: 'application/json', responseJsonSchema: format.schema } : {}),
        ...(thinkingLevel !== null ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    });
    const response = await providerFetch(googleHttpOptions(config, request.http), {
      method: 'POST',
      url: `${config.baseUrl}/models/${encodeURIComponent(request.model.modelId)}:generateContent`,
      headers: { 'content-type': 'application/json' },
      auth: googleAuthOf(config),
      body: () => body,
      timeoutMs: textTimeoutMs(request.http),
      signal: request.signal,
      classify: classifyGoogleText,
      onRetry: request.onRetry,
    });
    return parseGenerateContent(response.json(), this.version);
  }

  async listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing> {
    const models = new Set<string>();
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const response = await providerFetch(googleHttpOptions(config, { ...http, attempts: 1 }), {
        method: 'GET',
        url: `${config.baseUrl}/models?${query}`,
        auth: googleAuthOf(config),
        timeoutMs: http.timeoutMs ?? 15_000,
        signal,
        classify: classifyGoogle,
      });
      const value = response.json<{ models?: unknown; nextPageToken?: unknown }>();
      if (!value || !Array.isArray(value.models)) throw new ProviderFailure('protocol', PH.listShape({ label: LABEL, shape: '{ models: [...] }' }).text);
      for (const m of value.models) {
        const name = typeof m === 'object' && m !== null ? (m as { name?: unknown }).name : undefined;
        if (typeof name === 'string' && name) models.add(name.replace(/^models\//, ''));
      }
      pageToken = typeof value.nextPageToken === 'string' && value.nextPageToken ? value.nextPageToken : null;
      if (!pageToken) break;
    }
    return { models: [...models].sort() };
  }
}

export function parseGenerateContent(value: unknown, version: string): TextReply {
  if (!isObject(value)) throw new ProviderFailure('protocol', PH.notObject({ label: LABEL }).text);
  const modelVersion = typeof value.modelVersion === 'string' && value.modelVersion ? value.modelVersion : null;
  const usage = isObject(value.usageMetadata)
    ? {
        inputTokens: countOf(value.usageMetadata.promptTokenCount),
        outputTokens: sumCounts(value.usageMetadata.candidatesTokenCount, value.usageMetadata.thoughtsTokenCount),
      }
    : null;
  const candidate = Array.isArray(value.candidates) ? value.candidates.find(isObject) : undefined;
  if (!candidate) {
    // 输入被拦下：没有候选，`promptFeedback.blockReason` 说明原因。
    if (isObject(value.promptFeedback) && typeof value.promptFeedback.blockReason === 'string') {
      return { text: '', finishReason: 'content-filter', usage, modelVersion, workerVersion: version };
    }
    throw new ProviderFailure('protocol', PH.missingField({ label: LABEL, field: 'candidates' }).text);
  }
  const parts = isObject(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts.filter(isObject) : [];
  const text = parts
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  return { text, finishReason: finishOf(candidate.finishReason), usage, modelVersion, workerVersion: version };
}

function finishOf(value: unknown): TextFinishReason {
  if (value === 'STOP' || value === undefined || value === null) return 'stop';
  if (value === 'MAX_TOKENS') return 'length';
  if (typeof value === 'string' && FILTERED.has(value)) return 'content-filter';
  throw new ProviderFailure('rejected', PH.generateIncomplete({ label: LABEL, status: String(value).slice(0, 40) }).text, {
    code: 'PROVIDER_REJECTED',
    reason: 'other',
    finishReason: String(value).slice(0, 40),
  });
}

/** 认证失败（同转写）；上下文过长 → `INPUT_TOO_LONG`；404 → 模型不存在。 */
export function classifyGoogleText(status: number, body: string): RejectionCode | { code: RejectionCode; reason?: string } | null {
  const auth = classifyGoogle(status, body);
  if (auth) return auth;
  if (status === 400 && /exceeds the maximum number of tokens|input token count|context (window|length)|too long/i.test(body)) {
    return { code: 'INPUT_TOO_LONG', reason: 'context-length' };
  }
  if (status === 404) return { code: 'PROVIDER_REJECTED', reason: 'model-not-found' };
  if (status === 429) return { code: 'PROVIDER_QUOTA_EXCEEDED', reason: 'rate-limited' };
  return null;
}

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sumCounts(...values: unknown[]): number | null {
  const counts = values.map(countOf).filter((v): v is number => v !== null);
  return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
