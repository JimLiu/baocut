// 目录里的 OpenAI 兼容文本服务商（`generateText`，架构设计 §6.4）：与 `custom:<名字>` 同一个 Chat Completions 端点
// （`POST {base}/chat/completions`，Bearer，输出上限用 `max_tokens`），只差基址与内置模型表（`vendor-catalog.ts`）。
// 结构化输出按服务商的写法：支持 JSON Schema 的发 `json_schema`，只支持 JSON 模式的发 `json_object` 并把 schema 写进系统
// 消息；输出都在本地按 schema 校验。推理强度、`seed` 只在模型表声明支持时发出，推理档位按目录的映射换算。
import type { TextReply } from '@baocut/models';
import type { TextModelInfo } from '@baocut/protocol';
import type { AdapterConfig, AdapterHttp, ModelLister, ProviderListing, TextAdapter, TextRequest } from '../adapter.ts';
import { chatCompletions } from '../openai/chat-completions.ts';
import { declaredTextInfo } from './compatible-text.ts';
import { declaredOf } from './compatible-adapter.ts';
import { openAiListModels } from '../openai/openai-text.ts';

export interface VendorTextOptions {
  label: string;
  models: readonly TextModelInfo[];
  jsonMode: 'json_schema' | 'json_object';
  effortMap?: Partial<Record<TextModelInfo['efforts'][number], string>>;
  bodyWithoutEffort?: Record<string, unknown>;
}

export class VendorTextAdapter implements TextAdapter, ModelLister {
  readonly version = 'baocut-providers/openai-compatible-text@1';
  readonly #options: VendorTextOptions;

  constructor(options: VendorTextOptions) {
    this.#options = options;
  }

  models(config: AdapterConfig): TextModelInfo[] {
    const builtins = structuredClone([...this.#options.models]);
    const extra = config.providerId === 'qwen' ? declaredOf(config, 'generateText') : [];
    return [...builtins, ...extra.filter((m) => !builtins.some((b) => b.modelId === m.modelId)).map((m) => declaredTextInfo(m, false))];
  }

  generate(request: TextRequest): Promise<TextReply> {
    return chatCompletions(request, {
      label: this.#options.label,
      version: this.version,
      maxTokensField: 'max_tokens',
      jsonMode: this.#options.jsonMode,
      effortMap: this.#options.effortMap,
      bodyWithoutEffort: this.#options.bodyWithoutEffort,
    });
  }

  listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing> {
    return openAiListModels(config, signal, http, this.#options.label);
  }

  /** 验证密钥：列模型（`GET {base}/models`）。 */
  async validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    await this.listModels(config, signal, http);
  }
}
