// OpenAI 的转写接口形状（`openai` 与 `openai-compatible` 共用）。2026-10-03 读过的文档：
//   https://developers.openai.com/api/docs/guides/speech-to-text
//   https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
// 文档确认的：`POST {base}/audio/transcriptions`，multipart 字段 `file`、`model`、`response_format`、`language`（ISO-639-1）、
// `prompt`、`timestamp_granularities[]`（只配 `verbose_json`）；`verbose_json` 的 `language`（语言名，如 "english"）、
// `segments[].start/end/text`、`words[].word/start/end`、`usage`；`json` 的 `text` 与 `usage`；鉴权 `Authorization: Bearer`；
// 文件上限 25 MB。没能确认的：verbose_json 的 `language` 是否总是英文语言名（这里也接受 ISO 代码）。
import fs from 'node:fs';
import path from 'node:path';
import { ProviderFailure } from '@baocut/models';
import { CHUNK_FORMATS } from '../audio/audio-prep.ts';
import {
  primaryLanguage,
  requestTimeoutMs,
  type AdapterConfig,
  type AdapterHttp,
  type ChunkRequest,
  type ChunkTranscript,
} from '../adapter.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export interface OpenAiRequestStyle {
  label: string;
  /** 请求 `verbose_json` 与词、段的时间。 */
  verbose: boolean;
}

export async function openAiTranscribeChunk(request: ChunkRequest, style: OpenAiRequestStyle): Promise<ChunkTranscript> {
  const { config, model } = request;
  const format = CHUNK_FORMATS[request.format];
  const body = async () => {
    const form = new FormData();
    // `openAsBlob` 按需从磁盘读，不把文件整读进内存。
    const blob = await fs.openAsBlob(request.file, { type: format.mimeType });
    form.append('file', blob, `audio${path.extname(request.file)}`);
    form.append('model', model.modelId);
    if (style.verbose) {
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
    } else {
      form.append('response_format', 'json');
    }
    if (request.language.mode === 'assert') form.append('language', primaryLanguage(request.language.tag));
    if (request.hint && model.acceptsHint) form.append('prompt', request.hint);
    return form;
  };
  const response = await providerFetch(httpOptions(style.label, config, request.http), {
    method: 'POST',
    url: `${config.baseUrl}/audio/transcriptions`,
    auth: authOf(config),
    body,
    timeoutMs: requestTimeoutMs(request.durationSec, request.http),
    signal: request.signal,
  });
  return parseOpenAiTranscription(response.json(), style.label);
}

/** 读 `json` 或 `verbose_json` 的响应。 */
export function parseOpenAiTranscription(value: unknown, label: string): ChunkTranscript {
  if (!isObject(value) || typeof value.text !== 'string') throw new ProviderFailure('protocol', PH.missingText({ label }).text);
  const transcript: ChunkTranscript = { text: value.text };
  if (Array.isArray(value.segments)) {
    transcript.segments = value.segments
      .filter(isObject)
      .flatMap((s) =>
        typeof s.start === 'number' && typeof s.end === 'number' && typeof s.text === 'string'
          ? [{ start: s.start, end: s.end, text: s.text }]
          : [],
      );
  }
  if (Array.isArray(value.words)) {
    transcript.words = value.words
      .filter(isObject)
      .flatMap((w) =>
        typeof w.start === 'number' && typeof w.end === 'number' && typeof w.word === 'string'
          ? [{ start: w.start, end: w.end, text: w.word }]
          : [],
      );
  }
  if (typeof value.language === 'string') transcript.language = languageTagOf(value.language);
  if (value.usage !== undefined) transcript.usage = value.usage;
  return transcript;
}

/** `GET {base}/models`：只读，验证密钥与端点。 */
export async function openAiValidate(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp, label: string): Promise<void> {
  await providerFetch(httpOptions(label, config, { ...http, attempts: 1 }), {
    method: 'GET',
    url: `${config.baseUrl}/models`,
    auth: authOf(config),
    timeoutMs: http.timeoutMs ?? 15_000,
    signal,
  });
}

export function authOf(config: AdapterConfig): { header: string; value: string } | null {
  return config.credential ? { header: 'Authorization', value: `Bearer ${config.credential}` } : null;
}

export function httpOptions(label: string, config: AdapterConfig, http: AdapterHttp) {
  return {
    label,
    secrets: config.credential ? [config.credential] : [],
    ...(http.backoffMs ? { backoffMs: http.backoffMs } : {}),
    ...(http.attempts ? { attempts: http.attempts } : {}),
  };
}

/** whisper 的 `verbose_json` 报告语言名（"english"）；也接受 ISO 代码。认不出时 null。 */
export function languageTagOf(value: string): string | null {
  const lower = value.trim().toLowerCase();
  const named = LANGUAGE_NAMES[lower];
  if (named) return named;
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(lower) ? lower : null;
}

const LANGUAGE_NAMES: Record<string, string> = {
  afrikaans: 'af',
  arabic: 'ar',
  armenian: 'hy',
  azerbaijani: 'az',
  belarusian: 'be',
  bosnian: 'bs',
  bulgarian: 'bg',
  catalan: 'ca',
  chinese: 'zh',
  croatian: 'hr',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  estonian: 'et',
  finnish: 'fi',
  french: 'fr',
  galician: 'gl',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  icelandic: 'is',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  kannada: 'kn',
  kazakh: 'kk',
  korean: 'ko',
  latvian: 'lv',
  lithuanian: 'lt',
  macedonian: 'mk',
  malay: 'ms',
  marathi: 'mr',
  maori: 'mi',
  nepali: 'ne',
  norwegian: 'no',
  persian: 'fa',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  serbian: 'sr',
  slovak: 'sk',
  slovenian: 'sl',
  spanish: 'es',
  swahili: 'sw',
  swedish: 'sv',
  tagalog: 'tl',
  tamil: 'ta',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  urdu: 'ur',
  vietnamese: 'vi',
  welsh: 'cy',
  cantonese: 'yue',
};

/** OpenAI 语音合成支持的语言（TTS 指南：沿用 Whisper 的语言表；粤语不在其中）。 */
export const WHISPER_LANGUAGES: string[] = [...new Set(Object.values(LANGUAGE_NAMES))].filter((tag) => tag !== 'yue');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
