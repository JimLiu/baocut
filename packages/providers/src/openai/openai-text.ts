// OpenAI 文本模型（`generateText`，架构设计 §6.4）。2026-10-03 读过的文档：
//   https://platform.openai.com/docs/models
//   https://platform.openai.com/docs/models/gpt-6-astra
//   https://platform.openai.com/docs/models/gpt-6.1-sol
//   https://platform.openai.com/docs/models/gpt-6-luna
//   https://platform.openai.com/docs/guides/reasoning
// 文档确认的：三个旗舰文本模型 gpt-6-astra（最强）、gpt-6.1-sol（均衡）、gpt-6-luna（高效），上下文 1,050,000 token、
// 单次输出 128,000 token；`reasoning_effort` 取 none / minimal / low / medium / high / xhigh / max，默认 medium；astra 不接受
// none，sol 不接受 none 与 minimal。我们的四档（minimal–high）按此声明。
// 没能确认的：这几个推理模型是否接受 `temperature` 与 `seed`（旧的推理模型只接受默认的 temperature），按不接受声明；
// 费用按 `unknown`。默认模型选均衡的 gpt-6.1-sol。
import { ProviderFailure, type TextReply } from '@baocut/models';
import type { TextModelInfo } from '@baocut/protocol';
import type { AdapterConfig, AdapterHttp, ModelLister, ProviderListing, TextAdapter, TextRequest } from '../adapter.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { chatCompletions } from './chat-completions.ts';
import { authOf, httpOptions } from './openai-transcription.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

const LABEL = 'OpenAI';

function model(modelId: string, label: string, efforts: TextModelInfo['efforts'], extra: Partial<TextModelInfo> = {}): TextModelInfo {
  return {
    modelId,
    label,
    contextTokens: 1_050_000,
    maxOutputTokens: 128_000,
    efforts,
    defaultEffort: 'medium',
    structuredOutput: true,
    acceptsTemperature: false,
    acceptsSeed: false,
    cost: 'unknown',
    ...extra,
  };
}

const MODELS: TextModelInfo[] = [
  model('gpt-6.1-sol', 'GPT-6.1 Sol', ['low', 'medium', 'high'], { default: true }),
  model('gpt-6-astra', 'GPT-6 Astra', ['minimal', 'low', 'medium', 'high']),
  model('gpt-6-luna', 'GPT-6 Luna', ['minimal', 'low', 'medium', 'high']),
];

export class OpenAiTextAdapter implements TextAdapter, ModelLister {
  readonly version = 'baocut-providers/openai-text@1';

  models(_config: AdapterConfig): TextModelInfo[] {
    return structuredClone(MODELS);
  }

  generate(request: TextRequest): Promise<TextReply> {
    return chatCompletions(request, { label: LABEL, version: this.version, maxTokensField: 'max_completion_tokens' });
  }

  listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing> {
    return openAiListModels(config, signal, http, LABEL);
  }
}

/** `GET {base}/models`：`data[].id`。OpenAI 与兼容端点相同。 */
export async function openAiListModels(
  config: AdapterConfig,
  signal: AbortSignal,
  http: AdapterHttp,
  label: string,
): Promise<ProviderListing> {
  const response = await providerFetch(httpOptions(label, config, { ...http, attempts: 1 }), {
    method: 'GET',
    url: `${config.baseUrl}/models`,
    auth: authOf(config),
    timeoutMs: http.timeoutMs ?? 15_000,
    signal,
  });
  const value = response.json<{ data?: unknown }>();
  if (!value || !Array.isArray(value.data)) throw new ProviderFailure('protocol', PH.listShape({ label, shape: '{ data: [...] }' }).text);
  const models = value.data.flatMap((m) =>
    typeof m === 'object' && m !== null && typeof (m as { id?: unknown }).id === 'string' ? [(m as { id: string }).id] : [],
  );
  return { models: [...new Set(models)].sort() };
}
