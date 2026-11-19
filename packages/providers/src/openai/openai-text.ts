// OpenAI text models (architecture §6.4). GPT-6.2 Sol and Astra support Chat Completions,
// structured output, and low / medium / high within BaoCut's effort range.
// https://developers.openai.com/api/docs/models/gpt-6.2-sol
// https://developers.openai.com/api/docs/models/gpt-6.2-astra
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
  model('gpt-6.2-sol', 'GPT-6.2 Sol', ['low', 'medium', 'high'], { default: true }),
  model('gpt-6.1-terra', 'GPT-6.1 Terra', ['low', 'medium', 'high']),
  model('gpt-6.2-astra', 'GPT-6.2 Astra', ['low', 'medium', 'high']),
  model('gpt-6-luna', 'GPT-6 Luna', ['minimal', 'low', 'medium', 'high']),
  model('gpt-6.1-sol', 'GPT-6.1 Sol', ['low', 'medium', 'high']),
  model('gpt-6-astra', 'GPT-6 Astra', ['minimal', 'low', 'medium', 'high']),
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
