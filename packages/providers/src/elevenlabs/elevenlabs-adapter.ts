// ElevenLabs 语音合成适配器（架构设计 §6.4）。2026-10-03 读过的文档：
//   https://elevenlabs.io/docs/api-reference/text-to-speech/convert
//   https://elevenlabs.io/docs/overview/models
//   https://elevenlabs.io/docs/api-reference/models/list
//   https://elevenlabs.io/docs/api-reference/voices/search
// 文档确认的：`POST {base}/text-to-speech/{voice_id}?output_format=…`，请求头 `xi-api-key`；JSON `text`、`model_id`
// （默认 eleven_multilingual_v2）、`language_code`（ISO 639-1，multilingual_v2 不支持）、`seed`（0–4294967295，尽力而为）；
// 200 的响应体就是音频文件；`output_format` 取 `codec_sampleRate_bitrate`，默认 `mp3_44100_128`，44.1 kHz 的 WAV 要 Pro 档，
// 所以 WAV 用 `wav_24000`；单次字符上限 eleven_v4 10,000、eleven_v3 5,000、eleven_multilingual_v2 10,000、
// eleven_flash_v2_5 40,000；multilingual_v2 支持 29 种语言、flash_v2_5 再加 hu、no、vi，v3 / v4 支持 70+ / 90+ 种；
// 音色属于账号（`GET /v1/voices` 列出），没有对所有账号都可用的内置音色表；`GET /v1/models` 列出模型。
// 没能确认的：`voice_settings.speed` 的取值范围（不开放 speed）；额度用尽时的状态码与错误体（按 401/429 默认分类，
// 错误体含 `quota_exceeded` 时按额度用尽）；eleven_v4_turbo 的字符上限（文档没列，不提供这个模型）。
import { ProviderFailure } from '@baocut/models';
import type { SpeechFormat, SpeechModelInfo } from '@baocut/protocol';
import {
  generationTimeoutMs,
  primaryLanguage,
  type AdapterConfig,
  type AdapterHttp,
  type ModelLister,
  type ProviderListing,
  type SpeechAdapter,
  type SpeechOutput,
  type SpeechRequest,
} from '../adapter.ts';
import { providerFetch, type ProviderHttpOptions, type RejectionCode } from '../http/provider-fetch.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export const ELEVENLABS_DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1';
export const ELEVENLABS_LABEL = 'ElevenLabs';
const LABEL = ELEVENLABS_LABEL;

/** 我们的格式 → `output_format`。 */
const OUTPUT_FORMATS: Partial<Record<SpeechFormat, string>> = { mp3: 'mp3_44100_128', wav: 'wav_24000' };

const V2_LANGUAGES = [
  'en',
  'ja',
  'zh',
  'de',
  'hi',
  'fr',
  'ko',
  'pt',
  'it',
  'es',
  'id',
  'nl',
  'tr',
  'fil',
  'pl',
  'sv',
  'bg',
  'ro',
  'ar',
  'cs',
  'el',
  'fi',
  'hr',
  'ms',
  'sk',
  'da',
  'ta',
  'uk',
  'ru',
];

/** 不支持 `language_code` 的模型：语言只在提交时检查，不发给供应商。 */
const NO_LANGUAGE_CODE = new Set(['eleven_multilingual_v2']);

const BASE = {
  // 音色属于账号：不列预置音色，必须指定 voice（账号里音色的 voice_id）。
  voices: [],
  defaultVoice: null,
  voiceModes: ['custom'],
  formats: ['mp3', 'wav'],
  defaultFormat: 'mp3',
  acceptsInstructions: false,
  speedRange: null,
  acceptsSeed: true,
  cost: 'unknown',
} satisfies Partial<SpeechModelInfo>;

const MODELS: SpeechModelInfo[] = [
  {
    ...BASE,
    modelId: 'eleven_multilingual_v2',
    label: 'Eleven Multilingual v2',
    default: true,
    languages: V2_LANGUAGES,
    maxInputChars: 10_000,
  },
  { ...BASE, modelId: 'eleven_v4', label: 'Eleven v4', languages: 'any', maxInputChars: 10_000 },
  { ...BASE, modelId: 'eleven_v3', label: 'Eleven v3', languages: 'any', maxInputChars: 5_000 },
  {
    ...BASE,
    modelId: 'eleven_flash_v2_5',
    label: 'Eleven Flash v2.5',
    languages: [...V2_LANGUAGES, 'hu', 'no', 'vi'],
    maxInputChars: 40_000,
  },
];

export class ElevenLabsAdapter implements SpeechAdapter, ModelLister {
  readonly version = 'baocut-providers/elevenlabs@1';

  models(_config: AdapterConfig): SpeechModelInfo[] {
    return structuredClone(MODELS);
  }

  async synthesize(request: SpeechRequest): Promise<SpeechOutput> {
    const { config, model, parameters } = request;
    const outputFormat = OUTPUT_FORMATS[parameters.format];
    if (!outputFormat) throw new ProviderFailure('rejected', PH.formatUnsupported({ label: LABEL, format: parameters.format }).text, { code: 'PROVIDER_REJECTED' });
    const body = {
      text: parameters.text,
      model_id: model.modelId,
      ...(parameters.language && !NO_LANGUAGE_CODE.has(model.modelId) ? { language_code: primaryLanguage(parameters.language) } : {}),
      ...(parameters.seed !== null ? { seed: parameters.seed } : {}),
    };
    const response = await providerFetch(httpOptions(config, request.http), {
      method: 'POST',
      url: `${config.baseUrl}/text-to-speech/${encodeURIComponent(parameters.voice)}?output_format=${outputFormat}`,
      headers: { 'content-type': 'application/json' },
      auth: authOf(config),
      body: () => JSON.stringify(body),
      timeoutMs: generationTimeoutMs(request.http),
      signal: request.signal,
      classify: classifyElevenLabs,
    });
    if (response.contentType?.startsWith('application/json')) {
      throw new ProviderFailure('protocol', PH.jsonNotAudio({ label: LABEL }).text);
    }
    if (response.bytes.length === 0) throw new ProviderFailure('protocol', PH.emptyAudio({ label: LABEL }).text);
    return { bytes: response.bytes };
  }

  async validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    await providerFetch(httpOptions(config, { ...http, attempts: 1 }), {
      method: 'GET',
      url: `${config.baseUrl}/models`,
      auth: authOf(config),
      timeoutMs: http.timeoutMs ?? 15_000,
      signal,
      classify: classifyElevenLabs,
    });
  }

  /**
   * `GET {base}/models`（`[{ model_id }]`）与 `GET {base}/voices`（`{ voices: [{ voice_id, name }] }`）：音色属于账号，
   * 取到的补进模型的预置音色（仍然没有默认音色，必须指定）。
   */
  async listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing> {
    const get = (resource: string) =>
      providerFetch(httpOptions(config, { ...http, attempts: 1 }), {
        method: 'GET',
        url: `${config.baseUrl}/${resource}`,
        auth: authOf(config),
        timeoutMs: http.timeoutMs ?? 15_000,
        signal,
        classify: classifyElevenLabs,
      });
    const models = (await get('models')).json<unknown>();
    if (!Array.isArray(models)) throw new ProviderFailure('protocol', PH.listNotArray({ label: LABEL }).text);
    const voices = (await get('voices')).json<{ voices?: unknown }>();
    if (!voices || !Array.isArray(voices.voices)) throw new ProviderFailure('protocol', PH.voicesShape({ label: LABEL }).text);
    return {
      models: [...new Set(models.flatMap((m) => (isRecord(m) && typeof m.model_id === 'string' && m.model_id ? [m.model_id] : [])))].sort(),
      voices: voices.voices.flatMap((v) =>
        isRecord(v) && typeof v.voice_id === 'string' && v.voice_id
          ? [{ voiceId: v.voice_id, label: typeof v.name === 'string' && v.name ? v.name : v.voice_id }]
          : [],
      ),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 错误体里是 `quota_exceeded`：额度用尽（不论 4xx 的具体状态码）。 */
export function classifyElevenLabs(status: number, body: string): RejectionCode | null {
  if (status >= 400 && status < 500 && /quota_exceeded/i.test(body)) return 'PROVIDER_QUOTA_EXCEEDED';
  return null;
}

export function authOf(config: AdapterConfig): { header: string; value: string } | null {
  return config.credential ? { header: 'xi-api-key', value: config.credential } : null;
}

export function httpOptions(config: AdapterConfig, http: AdapterHttp): ProviderHttpOptions {
  return {
    label: LABEL,
    secrets: config.credential ? [config.credential] : [],
    ...(http.backoffMs ? { backoffMs: http.backoffMs } : {}),
    ...(http.attempts ? { attempts: http.attempts } : {}),
  };
}
