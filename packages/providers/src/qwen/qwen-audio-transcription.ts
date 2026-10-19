// Qwen-Audio 3.0/3.1 ASR uses DashScope, not the Qwen3-ASR Chat Completions API.
// https://www.alibabacloud.com/help/en/model-studio/fun-asr-flash-recorded-speech-recognition-http-api
// Request/response contract checked 2026-10-19; no live provider call was made.
import fs from 'node:fs/promises';
import { ProviderFailure } from '@baocut/models';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';
import { primaryLanguage, requestTimeoutMs, type ChunkRequest, type ChunkTranscript } from '../adapter.ts';
import { CHUNK_FORMATS } from '../audio/audio-prep.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { authOf, httpOptions } from '../openai/openai-transcription.ts';

export async function qwenAudioTranscribeChunk(request: ChunkRequest, label: string): Promise<ChunkTranscript> {
  const { config, model } = request;
  // Preserve the configured origin and any proxy prefix; only translate the API suffix.
  const url = new URL(config.baseUrl);
  const prefix = url.pathname.replace(/\/+$/, '').replace(/\/(?:compatible-mode\/v1|api\/v1)$/, '');
  url.pathname = `${prefix}/api/v1/services/aigc/multimodal-generation/generation`;
  const response = await providerFetch(httpOptions(label, config, request.http), {
    method: 'POST',
    url: url.href,
    headers: { 'Content-Type': 'application/json', 'X-DashScope-SSE': 'disable' },
    auth: authOf(config),
    timeoutMs: requestTimeoutMs(request.durationSec, request.http),
    signal: request.signal,
    body: async () => JSON.stringify({
      model: model.modelId,
      input: {
        messages: [
          ...(request.hint && model.acceptsHint ? [{
            role: 'user',
            content: [{ type: 'input_text', text: Array.from(request.hint).slice(0, 400).join('') }],
          }] : []),
          {
            role: 'user',
            content: [{
              type: 'input_audio',
              input_audio: { data: `data:${CHUNK_FORMATS[request.format].mimeType};base64,${(await fs.readFile(request.file)).toString('base64')}` },
            }],
          },
        ],
      },
      parameters: {
        format: request.format,
        sample_rate: '16000',
        ...(request.language.mode === 'assert' ? { language_hints: [primaryLanguage(request.language.tag)] } : {}),
      },
    }),
  });
  const value = response.json<unknown>();
  if (!isObject(value)) throw new ProviderFailure('protocol', PH.notObject({ label }));
  const output = value.output;
  if (!isObject(output) || typeof output.text !== 'string') {
    throw new ProviderFailure('protocol', PH.missingText({ label }));
  }
  const text = output.text;
  const sentence = isObject(output.sentence) ? output.sentence : null;
  if (sentence && sentence.sentence_end !== true) {
    throw new ProviderFailure('protocol', PH.unexpectedFinish({ label, reason: 'output.sentence.sentence_end is not true' }));
  }
  const transcript: ChunkTranscript = { text, ...(value.usage !== undefined ? { usage: value.usage } : {}) };
  if (!sentence || !Array.isArray(sentence.words) || sentence.words.length === 0) return transcript;
  const words: NonNullable<ChunkTranscript['words']> = [];
  for (const word of sentence.words) {
    if (!isObject(word) || word.fixed !== true || typeof word.text !== 'string' ||
        !isMillis(word.begin_time) || !isMillis(word.end_time) || word.end_time <= word.begin_time ||
        typeof word.punctuation !== 'string') return transcript;
    words.push({ start: word.begin_time / 1000, end: word.end_time / 1000, text: word.text + word.punctuation });
  }
  // output.text is cumulative, while output.sentence may describe only its last sentence.
  // Partial/unstable word lists must never replace the full transcript in buildAsrResult.
  if (withoutSpaces(words.map((w) => w.text).join('')) === withoutSpaces(text)) transcript.words = words;
  return transcript;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMillis(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function withoutSpaces(text: string): string {
  return text.replace(/\s/gu, '');
}
