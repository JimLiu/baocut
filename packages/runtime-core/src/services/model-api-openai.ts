import {
  IMAGE_FORMATS,
  SPEECH_FORMATS,
  TEXT_EFFORTS,
  type GenerateImageRequest,
  type GenerateTextRequest,
  type ImageFormat,
  type LanguageRequest,
  type SpeechFormat,
  type SynthesizeSpeechRequest,
  type TextEffort,
  type TextFinishReason,
  type TextMessage,
  type TextResponseFormat,
  type Localized,
} from '@baocut/protocol';
import { RcModelApi } from '@baocut/protocol/messages/runtime-core';
import type { AsrResult } from '@baocut/models';
import { LIBRARY_VOICE_PREFIX } from '@baocut/runtime-storage/library';
import { ApiError } from './model-api-errors.ts';

/**
 * OpenAI 形状的请求与响应（架构设计 §4.8 的模型接口服务）。请求字段只认这里列出的；不认识的字段忽略（OpenAI 的客户端
 * 常带 `user` 之类），认识但不支持的（流式语音、`url` 形式的图片、工具调用……）回答 400 `UNSUPPORTED_PARAMETER`。
 * 模型名的解析不在这里（`model-api-routing.ts`）。
 */

type Json = Record<string, unknown>;

export const TRANSCRIPTION_FORMATS = ['json', 'text', 'srt', 'vtt', 'verbose_json'] as const;
export type TranscriptionFormat = (typeof TRANSCRIPTION_FORMATS)[number];

function invalid(message: Localized): ApiError {
  return new ApiError(400, 'INVALID_REQUEST', message);
}

function unsupported(message: Localized): ApiError {
  return new ApiError(400, 'UNSUPPORTED_PARAMETER', message);
}

/** `field 只支持 a、b、c`：取值按当前语言的列表分隔符连起来。 */
function onlySupports(field: string, values: readonly string[]): ApiError {
  return unsupported(RcModelApi.onlySupports({ field, values: values.join(RcModelApi.listSeparator().text) }));
}

function string(body: Json, key: string, required: true): string;
function string(body: Json, key: string, required?: false): string | undefined;
function string(body: Json, key: string, required = false): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) throw invalid(RcModelApi.fieldMissing({ key }));
    return undefined;
  }
  if (typeof value !== 'string') throw invalid(RcModelApi.fieldNotString({ key }));
  if (required && value.trim() === '') throw invalid(RcModelApi.fieldEmpty({ key }));
  return value;
}

function number(body: Json, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(RcModelApi.fieldNotNumber({ key }));
  return value;
}

function integer(body: Json, key: string, min: number): number | undefined {
  const value = number(body, key);
  if (value !== undefined && (!Number.isSafeInteger(value) || value < min)) throw invalid(RcModelApi.fieldNotInteger({ key, min }));
  return value;
}

/** JSON 请求体必须是一个对象。 */
export function jsonObject(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(RcModelApi.bodyNotObject());
  return value as Json;
}

/** 每种请求都要的 `model`。 */
export function modelName(body: Json): string {
  return string(body, 'model', true).trim();
}

// ---- 语音合成：POST /v1/audio/speech ----

export function speechRequest(body: Json): SynthesizeSpeechRequest {
  const input = string(body, 'input', true);
  const voice = string(body, 'voice');
  const instructions = string(body, 'instructions');
  const speed = number(body, 'speed');
  const format = string(body, 'response_format');
  if (format !== undefined && !(SPEECH_FORMATS as readonly string[]).includes(format)) {
    throw onlySupports('response_format', SPEECH_FORMATS);
  }
  const streamFormat = string(body, 'stream_format');
  if (streamFormat !== undefined && streamFormat !== 'audio') throw unsupported(RcModelApi.speechStreamUnsupported());
  // 用户库的音色（`library:<id>`）不对外部程序开放（架构设计 §5.9）：在审批之前就拒绝。
  if (voice !== undefined && voice.trim().startsWith(LIBRARY_VOICE_PREFIX)) {
    throw invalid(RcModelApi.libraryVoiceUnsupported());
  }
  return {
    text: input,
    ...(voice !== undefined && voice.trim() !== '' ? { voice: voice.trim() } : {}),
    ...(format !== undefined ? { format: format as SpeechFormat } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(instructions !== undefined && instructions.trim() !== '' ? { instructions } : {}),
  };
}

// ---- 图片：POST /v1/images/generations ----

export function imageRequest(body: Json): GenerateImageRequest {
  const prompt = string(body, 'prompt', true);
  const count = integer(body, 'n', 1);
  const size = string(body, 'size');
  const responseFormat = string(body, 'response_format');
  if (responseFormat !== undefined && responseFormat !== 'b64_json') {
    throw unsupported(RcModelApi.imageUrlUnsupported());
  }
  const format = string(body, 'output_format');
  if (format !== undefined && !(IMAGE_FORMATS as readonly string[]).includes(format)) {
    throw onlySupports('output_format', IMAGE_FORMATS);
  }
  if (body.stream === true) throw unsupported(RcModelApi.imageStreamUnsupported());
  return {
    prompt,
    ...(count !== undefined ? { count } : {}),
    ...(size !== undefined && size !== 'auto' ? { size } : {}),
    ...(format !== undefined ? { format: format as ImageFormat } : {}),
  };
}

// ---- 聊天：POST /v1/chat/completions ----

export interface ChatRequest {
  request: GenerateTextRequest;
  stream: boolean;
  includeUsage: boolean;
}

export function chatRequest(body: Json): ChatRequest {
  if (!Array.isArray(body.messages) || body.messages.length === 0) throw invalid(RcModelApi.messagesNotArray());
  const messages = body.messages.map((m, i) => chatMessage(m, i));
  for (const key of ['tools', 'functions', 'tool_choice', 'function_call', 'audio', 'prediction']) {
    const value = body[key];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && value !== 'none') {
      throw unsupported(RcModelApi.textOnlyChat({ key }));
    }
  }
  const n = integer(body, 'n', 1);
  if (n !== undefined && n !== 1) throw unsupported(RcModelApi.nOnlyOne());
  if (body.logprobs === true) throw unsupported(RcModelApi.logprobsUnsupported());
  const temperature = number(body, 'temperature');
  // 两个都给时以新的 max_completion_tokens 为准。
  const maxOutputTokens = integer(body, 'max_completion_tokens', 1) ?? integer(body, 'max_tokens', 1);
  const seed = integer(body, 'seed', 0);
  const effort = string(body, 'reasoning_effort');
  if (effort !== undefined && !(TEXT_EFFORTS as readonly string[]).includes(effort)) {
    throw onlySupports('reasoning_effort', TEXT_EFFORTS);
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw invalid(RcModelApi.streamNotBoolean());
  const streamOptions = body.stream_options as { include_usage?: unknown } | undefined | null;
  const responseFormat = chatResponseFormat(body.response_format);
  return {
    request: {
      messages,
      ...(responseFormat ? { responseFormat } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(effort !== undefined ? { effort: effort as TextEffort } : {}),
      ...(seed !== undefined ? { seed } : {}),
    },
    stream: body.stream === true,
    includeUsage: Boolean(streamOptions && typeof streamOptions === 'object' && streamOptions.include_usage === true),
  };
}

function chatMessage(value: unknown, index: number): TextMessage {
  const message = value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
  if (!message) throw invalid(RcModelApi.messageNotObject({ index }));
  const role = message.role === 'developer' ? 'system' : message.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant') {
    throw unsupported(RcModelApi.roleUnsupported({ index }));
  }
  if (message.tool_calls !== undefined && message.tool_calls !== null) throw unsupported(RcModelApi.toolCallsUnsupported());
  const content = message.content;
  if (typeof content === 'string') return { role, content };
  if (Array.isArray(content)) {
    const parts = content.map((part) => {
      const p = part as Json | null;
      if (!p || p.type !== 'text' || typeof p.text !== 'string') throw unsupported(RcModelApi.textContentOnly({ index }));
      return p.text;
    });
    return { role, content: parts.join('') };
  }
  throw invalid(RcModelApi.contentInvalid({ index }));
}

function chatResponseFormat(value: unknown): TextResponseFormat | null {
  if (value === undefined || value === null) return null;
  const format = value as Json;
  if (typeof format !== 'object' || Array.isArray(format)) throw invalid(RcModelApi.responseFormatNotObject());
  if (format.type === 'text') return { type: 'text' };
  if (format.type === 'json_object') return { type: 'json', schema: { type: 'object' } };
  if (format.type === 'json_schema') {
    const spec = format.json_schema as Json | undefined;
    const schema = spec?.schema;
    if (!spec || typeof spec !== 'object' || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw invalid(RcModelApi.jsonSchemaInvalid());
    }
    return { type: 'json', schema: schema as Record<string, unknown>, ...(typeof spec.name === 'string' ? { name: spec.name } : {}) };
  }
  throw unsupported(RcModelApi.responseFormatTypeUnsupported());
}

const FINISH_REASONS: Record<TextFinishReason, string> = { stop: 'stop', length: 'length', 'content-filter': 'content_filter' };

export interface ChatOutcome {
  id: string;
  model: string;
  created: number;
  content: string;
  finishReason: TextFinishReason;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  baocut: Record<string, unknown>;
}

function usageOf(outcome: ChatOutcome): Json | null {
  if (!outcome.usage) return null;
  const prompt = outcome.usage.inputTokens ?? 0;
  const completion = outcome.usage.outputTokens ?? 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

export function chatCompletion(outcome: ChatOutcome): Json {
  return {
    id: outcome.id,
    object: 'chat.completion',
    created: outcome.created,
    model: outcome.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: outcome.content, refusal: null },
        logprobs: null,
        finish_reason: FINISH_REASONS[outcome.finishReason],
      },
    ],
    usage: usageOf(outcome),
    system_fingerprint: null,
    baocut: outcome.baocut,
  };
}

/** `stream: true`：首版不做真正的增量，整段结果以一个内容块的 SSE 返回（然后是结束块与 `[DONE]`）。 */
export function chatCompletionStream(outcome: ChatOutcome, includeUsage: boolean): string {
  const base = {
    id: outcome.id,
    object: 'chat.completion.chunk',
    created: outcome.created,
    model: outcome.model,
    system_fingerprint: null,
  };
  const chunks: Json[] = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: outcome.content }, logprobs: null, finish_reason: null }] },
    {
      ...base,
      choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: FINISH_REASONS[outcome.finishReason] }],
      baocut: outcome.baocut,
    },
  ];
  if (includeUsage) chunks.push({ ...base, choices: [], usage: usageOf(outcome) });
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

// ---- 转写：POST /v1/audio/transcriptions ----

export interface TranscriptionOptions {
  format: TranscriptionFormat;
  language?: LanguageRequest;
  hint?: string;
  words: boolean;
  segments: boolean;
}

/** multipart 的文本字段 → 转写选项。 */
export function transcriptionOptions(fields: Map<string, string[]>): TranscriptionOptions {
  const one = (key: string) => fields.get(key)?.[0];
  const format = (one('response_format') ?? 'json') as TranscriptionFormat;
  if (!(TRANSCRIPTION_FORMATS as readonly string[]).includes(format)) {
    throw onlySupports('response_format', TRANSCRIPTION_FORMATS);
  }
  if (one('stream') === 'true') throw unsupported(RcModelApi.transcriptionStreamUnsupported());
  const granularities = [...(fields.get('timestamp_granularities[]') ?? []), ...(fields.get('timestamp_granularities') ?? [])].flatMap(
    (v) => v.split(',').map((s) => s.trim()),
  );
  for (const g of granularities) if (g !== 'word' && g !== 'segment') throw invalid(RcModelApi.granularitiesInvalid());
  const language = one('language')?.trim();
  const prompt = one('prompt')?.trim();
  return {
    format,
    // 调用方给的是音频的语言：按断言处理（模型不得更改）。
    ...(language ? { language: { mode: 'assert', tag: language } as LanguageRequest } : {}),
    ...(prompt ? { hint: prompt } : {}),
    words: granularities.includes('word'),
    segments: granularities.length === 0 || granularities.includes('segment'),
  };
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿＀-￯]/;

/** 段落连成全文：两边都不是中日文时用空格隔开。 */
export function transcriptText(result: AsrResult): string {
  let text = '';
  for (const segment of result.segments) {
    const piece = segment.text.trim();
    if (!piece) continue;
    if (text && !(CJK.test(text.at(-1)!) || CJK.test(piece[0]!))) text += ' ';
    text += piece;
  }
  return text;
}

function seconds(ticks: number, timescale: number): number {
  return Math.round((ticks / timescale) * 1000) / 1000;
}

function clock(ticks: number, timescale: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round((ticks / timescale) * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`;
}

/** 按 `response_format` 写出转写结果：正文与媒体类型。 */
export function transcriptionBody(
  result: AsrResult,
  options: TranscriptionOptions,
  baocut: Record<string, unknown>,
): { body: string; contentType: string } {
  const { timescale } = result;
  const segments = result.segments.filter((s) => s.text.trim() !== '');
  const text = transcriptText(result);
  switch (options.format) {
    case 'text':
      return { body: `${text}\n`, contentType: 'text/plain; charset=utf-8' };
    case 'srt':
      return {
        body: segments
          .map((s, i) => `${i + 1}\n${clock(s.start, timescale, ',')} --> ${clock(s.end, timescale, ',')}\n${s.text.trim()}\n`)
          .join('\n'),
        contentType: 'application/x-subrip; charset=utf-8',
      };
    case 'vtt':
      return {
        body: `WEBVTT\n\n${segments.map((s) => `${clock(s.start, timescale, '.')} --> ${clock(s.end, timescale, '.')}\n${s.text.trim()}\n`).join('\n')}`,
        contentType: 'text/vtt; charset=utf-8',
      };
    case 'verbose_json':
      return {
        body: JSON.stringify({
          task: 'transcribe',
          language: result.language.tag,
          duration: seconds(result.duration, timescale),
          text,
          ...(options.segments
            ? {
                segments: segments.map((s, i) => ({
                  id: i,
                  seek: 0,
                  start: seconds(s.start, timescale),
                  end: seconds(s.end, timescale),
                  text: s.text.trim(),
                  tokens: [],
                  temperature: 0,
                  avg_logprob: 0,
                  compression_ratio: 0,
                  no_speech_prob: 0,
                })),
              }
            : {}),
          ...(options.words
            ? {
                words: segments.flatMap((s) =>
                  s.words.map((w) => ({ word: w.text, start: seconds(w.start, timescale), end: seconds(w.end, timescale) })),
                ),
              }
            : {}),
          baocut,
        }),
        contentType: 'application/json; charset=utf-8',
      };
    case 'json':
      return { body: JSON.stringify({ text, baocut }), contentType: 'application/json; charset=utf-8' };
  }
}
