// Google Gemini 转写适配器（架构设计 §6.4）。2026-10-03 读过的文档：
//   https://ai.google.dev/gemini-api/docs/audio
//   https://ai.google.dev/gemini-api/docs/transcribe
//   https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe
//   https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026
//   https://ai.google.dev/gemini-api/docs/interactions/structured-output.md.txt
//   https://discuss.ai.google.dev/t/gemini-3-5-transcribe-documented-custom-vocabulary-diarization-timestamps-configuration-is-rejected-by-the-interactions-api/180240
// 文档确认的：`POST {base}/interactions`，请求头 `x-goog-api-key` 与 `Api-Revision: 2026-05-20`（密钥放请求头，不放查询串）；
// 输入 `{ type: 'audio', data（base64）, mime_type }`；整个请求 ≤ 20 MB；`response_format`（顶层）`{ type: 'text',
// mime_type: 'application/json', schema }`，结果在 `output_text`；gemini-3.5-transcribe 的
// `generation_config.transcription_config`：`language_codes`、`mode: { type: 'verbatim', timestamp_granularities: ['word'] }`，
// 词时间在 `steps[].content[].annotations[]` 的 `word_info`（`start_offset`/`end_offset` 形如 "0.100s"）；带时间戳时单次 ≤ 30 分钟；
// `custom_vocabulary` 与时间戳不能同用（所以 gemini-3.5-transcribe 不接受提示词）。
// 没能确认的：gemini-3.5-transcribe 是否接受内联的 `data`（文档的例子用 `uri`）；`steps[]` 里 `content` 的确切嵌套；
// 是否返回识别出的语言；400 `API_KEY_INVALID` 的错误体形状；`GET {base}/models` 用作密钥验证。
import fs from 'node:fs/promises';
import { ProviderFailure } from '@baocut/models';
import type { TranscribeModelInfo } from '@baocut/protocol';
import { CHUNK_FORMATS, type ChunkFormat } from '../audio/audio-prep.ts';
import {
  requestTimeoutMs,
  type AdapterConfig,
  type AdapterHttp,
  type ChunkRequest,
  type ChunkTranscript,
  type TranscribeAdapter,
} from '../adapter.ts';
import { providerFetch, type ProviderHttpOptions, type RejectionCode } from '../http/provider-fetch.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export const GOOGLE_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GOOGLE_API_REVISION = '2026-05-20';
const LABEL = 'Google Gemini';
/** 内联音频按 base64 膨胀 4/3，再留出请求其余部分的余量：原始字节不超过这个数，整个请求就在 20 MB 以内。 */
const MAX_INLINE_BYTES = 12_000_000;
const TIMELESS_CHUNK_SEC = 120;

export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const GENERAL_MODEL = 'gemini-3.8-flash';

const MODELS: TranscribeModelInfo[] = [
  {
    modelId: TRANSCRIBE_MODEL,
    label: 'Gemini 3.5 Transcribe',
    default: true,
    maxInputBytes: MAX_INLINE_BYTES,
    maxDurationSec: 1800,
    wordTimestamps: 'native',
    languages: 'any',
    acceptsHint: false,
    cost: 'unknown',
  },
  {
    modelId: GENERAL_MODEL,
    label: 'Gemini 3.8 Flash',
    maxInputBytes: MAX_INLINE_BYTES,
    maxDurationSec: null,
    wordTimestamps: 'none',
    languages: 'any',
    acceptsHint: true,
    cost: 'unknown',
  },
];

/** 通用模型的结构化输出：语言与带起止秒数的段。 */
const SEGMENTS_SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', description: 'BCP 47 tag of the spoken language' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'seconds from the beginning of the audio' },
          end: { type: 'number', description: 'seconds from the beginning of the audio' },
          text: { type: 'string' },
        },
        required: ['start', 'end', 'text'],
      },
    },
  },
  required: ['segments'],
};

export class GoogleAdapter implements TranscribeAdapter {
  readonly version = 'baocut-providers/google@1';

  models(_config: AdapterConfig): TranscribeModelInfo[] {
    return MODELS.map((m) => ({ ...m }));
  }

  chunkFormat(_model: TranscribeModelInfo): ChunkFormat {
    return 'flac';
  }

  preferredChunkSec(model: TranscribeModelInfo): number | null {
    return model.wordTimestamps === 'native' ? null : TIMELESS_CHUNK_SEC;
  }

  async transcribeChunk(request: ChunkRequest): Promise<ChunkTranscript> {
    const { config, model } = request;
    const audio = async () => ({
      type: 'audio',
      // 内联音频要整块读进内存：切片的上限（约 12 MB）保证它不大。
      data: (await fs.readFile(request.file)).toString('base64'),
      mime_type: CHUNK_FORMATS[request.format].mimeType,
    });
    const body =
      model.modelId === TRANSCRIBE_MODEL
        ? async () =>
            JSON.stringify({
              model: model.modelId,
              input: [await audio()],
              generation_config: {
                transcription_config: {
                  ...(request.language.mode === 'assert' ? { language_codes: [request.language.tag] } : {}),
                  mode: { type: 'verbatim', timestamp_granularities: ['word'] },
                },
              },
            })
        : async () =>
            JSON.stringify({
              model: model.modelId,
              input: [{ type: 'text', text: generalPrompt(request) }, await audio()],
              response_format: { type: 'text', mime_type: 'application/json', schema: SEGMENTS_SCHEMA },
            });
    const response = await providerFetch(googleHttpOptions(config, request.http), {
      method: 'POST',
      url: `${config.baseUrl}/interactions`,
      headers: { 'content-type': 'application/json', 'api-revision': GOOGLE_API_REVISION },
      auth: googleAuthOf(config),
      body,
      timeoutMs: requestTimeoutMs(request.durationSec, request.http),
      signal: request.signal,
      classify: classifyGoogle,
    });
    const value = response.json();
    return model.modelId === TRANSCRIBE_MODEL ? parseTranscribeInteraction(value) : parseGeneralInteraction(value);
  }

  async validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    await providerFetch(googleHttpOptions(config, { ...http, attempts: 1 }), {
      method: 'GET',
      url: `${config.baseUrl}/models`,
      auth: googleAuthOf(config),
      timeoutMs: http.timeoutMs ?? 15_000,
      signal,
      classify: classifyGoogle,
    });
  }
}

function generalPrompt(request: ChunkRequest): string {
  const lines = [
    'Transcribe all speech in this audio verbatim, in the language that is spoken.',
    'Split the transcript into short segments (one sentence or phrase each) in order.',
    'For each segment give start and end in seconds from the beginning of this audio, and the text.',
    'Also give the BCP 47 tag of the spoken language. If there is no speech, return an empty segments array.',
  ];
  if (request.language.mode === 'assert') lines.push(`The audio is in ${request.language.tag}.`);
  if (request.hint) lines.push(`Terms and names that may appear: ${request.hint}`);
  return lines.join('\n');
}

/** gemini-3.5-transcribe：词时间来自 `word_info` 标注；没有标注时整块一段（由组装按字符长度插值）。 */
export function parseTranscribeInteraction(value: unknown): ChunkTranscript {
  const interaction = interactionOf(value);
  const words: NonNullable<ChunkTranscript['words']> = [];
  const texts: string[] = [];
  for (const content of contentsOf(interaction)) {
    if (typeof content.text === 'string') texts.push(content.text);
    for (const annotation of arrayOf(content.annotations)) {
      if (annotation.type !== 'word_info' || typeof annotation.text !== 'string') continue;
      const start = offsetSec(annotation.start_offset);
      const end = offsetSec(annotation.end_offset);
      if (start === null || end === null) continue;
      words.push({ start, end, text: annotation.text });
    }
  }
  const text = typeof interaction.output_text === 'string' ? interaction.output_text : texts.join('');
  return {
    text,
    ...(words.length > 0 ? { words } : {}),
    ...(interaction.usage !== undefined ? { usage: interaction.usage } : {}),
  };
}

/** 通用模型：`output_text` 是结构化的 JSON；读不出段时整块一段（单段兜底）。 */
export function parseGeneralInteraction(value: unknown): ChunkTranscript {
  const interaction = interactionOf(value);
  const raw =
    typeof interaction.output_text === 'string'
      ? interaction.output_text
      : contentsOf(interaction)
          .map((c) => (typeof c.text === 'string' ? c.text : ''))
          .join('');
  const usage = interaction.usage !== undefined ? { usage: interaction.usage } : {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: raw.trim(), ...usage };
  }
  if (!isObject(parsed)) return { text: '', ...usage };
  const segments = arrayOf(parsed.segments).flatMap((s) =>
    typeof s.start === 'number' && typeof s.end === 'number' && typeof s.text === 'string'
      ? [{ start: s.start, end: s.end, text: s.text }]
      : [],
  );
  const language = typeof parsed.language === 'string' && parsed.language.trim() ? parsed.language.trim() : null;
  return {
    text: segments.map((s) => s.text.trim()).join(' '),
    ...(segments.length > 0 ? { segments } : {}),
    ...(language ? { language } : {}),
    ...usage,
  };
}

function interactionOf(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new ProviderFailure('protocol', PH.notObject({ label: LABEL }).text);
  if (value.status === 'failed' || value.status === 'cancelled') {
    throw new ProviderFailure('rejected', PH.transcribeIncomplete({ label: LABEL, status: String(value.status) }).text, { code: 'PROVIDER_REJECTED' });
  }
  if (typeof value.output_text !== 'string' && !Array.isArray(value.steps)) {
    throw new ProviderFailure('protocol', PH.missingTranscript({ label: LABEL }).text);
  }
  return value;
}

/** 所有 step 里的 content 项。 */
function contentsOf(interaction: Record<string, unknown>): Array<Record<string, unknown>> {
  return arrayOf(interaction.steps).flatMap((step) => arrayOf(step.content));
}

/** "1.250s" → 1.25。 */
export function offsetSec(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** 400 且错误体里是 `API_KEY_INVALID`：密钥不对，按认证失败处理。 */
export function classifyGoogle(status: number, body: string): RejectionCode | null {
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) return 'PROVIDER_AUTH_FAILED';
  return null;
}

export function googleAuthOf(config: AdapterConfig): { header: string; value: string } | null {
  return config.credential ? { header: 'x-goog-api-key', value: config.credential } : null;
}

export function googleHttpOptions(config: AdapterConfig, http: AdapterHttp): ProviderHttpOptions {
  return {
    label: LABEL,
    secrets: config.credential ? [config.credential] : [],
    ...(http.backoffMs ? { backoffMs: http.backoffMs } : {}),
    ...(http.attempts ? { attempts: http.attempts } : {}),
  };
}

function arrayOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
