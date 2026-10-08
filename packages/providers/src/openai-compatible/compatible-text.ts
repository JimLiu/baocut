// OpenAI 兼容端点的文本模型（`generateText`，架构设计 §6.4）：用户声明 `capability` 为 `generateText` 的模型，请求形状同
// OpenAI 的 Chat Completions（见 openai/chat-completions.ts），输出上限用 `max_tokens`。都是假定，没有逐家确认：端点接受
// `response_format: { type: 'json_schema' }`（不接受的会忽略或拒绝；输出照样在本地按 schema 校验）；声明了 `efforts` 时才发
// `reasoning_effort`。没声明的限制取保守值：上下文 32768 token、单次输出 4096 token。
import type { TextReply } from '@baocut/models';
import type { DeclaredModel, TextModelInfo } from '@baocut/protocol';
import type { AdapterConfig, AdapterHttp, ModelLister, ProviderListing, TextAdapter, TextRequest } from '../adapter.ts';
import { chatCompletions } from '../openai/chat-completions.ts';
import { openAiListModels } from '../openai/openai-text.ts';
import { declaredOf } from './compatible-adapter.ts';

export class CompatibleTextAdapter implements TextAdapter, ModelLister {
  readonly version = 'baocut-providers/openai-compatible-text@1';
  readonly #label: () => string;

  constructor(label: () => string) {
    this.#label = label;
  }

  models(config: AdapterConfig): TextModelInfo[] {
    return declaredOf(config, 'generateText').map((m, i) => declaredTextInfo(m, i === 0));
  }

  generate(request: TextRequest): Promise<TextReply> {
    return chatCompletions(request, { label: this.#label(), version: this.version, maxTokensField: 'max_tokens' });
  }

  listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing> {
    return openAiListModels(config, signal, http, this.#label());
  }
}

export function declaredTextInfo(model: DeclaredModel, isDefault: boolean): TextModelInfo {
  const efforts = [...(model.efforts ?? [])];
  return {
    modelId: model.modelId,
    label: model.label ?? model.modelId,
    ...(isDefault ? { default: true } : {}),
    declared: true,
    contextTokens: model.contextTokens ?? 32_768,
    maxOutputTokens: model.maxOutputTokens ?? 4096,
    efforts,
    // 声明了推理强度时不知道端点的默认是哪一档。
    defaultEffort: null,
    structuredOutput: model.structuredOutput ?? true,
    acceptsTemperature: true,
    acceptsSeed: false,
    cost: 'unknown',
  };
}
