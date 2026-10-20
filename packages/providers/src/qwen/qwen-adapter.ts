// Qwen synchronous ASR: https://www.alibabacloud.com/help/en/model-studio/qwen-asr-api-reference
// Verified 2026-10-19: Chat Completions with input_audio Data URLs, optional system context and asr_options.
// Qwen-Audio 3.x uses DashScope instead; see qwen-audio-transcription.ts. Filetrans (asynchronous) remains unsupported.
import fs from 'node:fs/promises';
import { modelDetail, ProviderFailure } from '@baocut/models';
import type { TranscribeModelInfo } from '@baocut/protocol';
import { ProvidersConfig as PC, ProvidersHttp as PH } from '@baocut/protocol/messages/providers';
import {
  primaryLanguage,
  requestTimeoutMs,
  type AdapterConfig,
  type AdapterHttp,
  type ChunkRequest,
  type ChunkTranscript,
  type TranscribeAdapter,
} from '../adapter.ts';
import { CHUNK_FORMATS, type ChunkFormat } from '../audio/audio-prep.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { authOf, httpOptions, openAiValidate } from '../openai/openai-transcription.ts';
import { qwenAudioTranscribeChunk } from './qwen-audio-transcription.ts';

/** Base64 expands by 4/3: leave room below the documented 10 MB inline limit. */
const MAX_INLINE_BYTES = 7_000_000;
const MAX_DURATION_SEC = 300;
const MODEL = /^qwen(?:3|-audio-3\.[01])-asr-flash(?:-filetrans)?(?:-(?:latest|\d{4}-\d{2}-\d{2}))?$/;
const BUILTIN_MODELS = ['qwen-audio-3.0-asr-flash', 'qwen-audio-3.1-asr-flash', 'qwen3-asr-flash'];

type AsrEntry = Pick<TranscribeModelInfo, 'modelId' | 'label'> & Partial<Pick<TranscribeModelInfo, 'default' | 'declared' | 'acceptsHint'>>;

function asrInfo(model: AsrEntry): TranscribeModelInfo {
  return qwenAsrModelInfo({
    acceptsHint: true,
    ...model,
    maxInputBytes: MAX_INLINE_BYTES,
    maxDurationSec: MAX_DURATION_SEC,
    wordTimestamps: 'none',
    languages: 'any',
    cost: 'unknown',
  });
}

/** Only official Alibaba endpoints opt into this protocol; arbitrary compatible servers retain multipart ASR. */
export function usesQwenAsr(config: AdapterConfig, modelId: string): boolean {
  if (!MODEL.test(modelId)) return false;
  try {
    const host = new URL(config.baseUrl).hostname;
    return host === 'dashscope.aliyuncs.com' || host === 'dashscope-intl.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com');
  } catch {
    return false;
  }
}

export function qwenAsrModelInfo(model: TranscribeModelInfo): TranscribeModelInfo {
  if (model.modelId.includes('-filetrans')) {
    return {
      ...model,
      available: false,
      unavailableReason: 'unsupported',
      ...modelDetail(PC.asyncTranscriptionUnsupported()),
    };
  }
  return {
    ...model,
    maxInputBytes: Math.min(model.maxInputBytes ?? MAX_INLINE_BYTES, MAX_INLINE_BYTES),
    maxDurationSec: Math.min(model.maxDurationSec ?? MAX_DURATION_SEC, MAX_DURATION_SEC),
    wordTimestamps: model.modelId.startsWith('qwen-audio-') ? 'native' : 'none',
  };
}

export class QwenAdapter implements TranscribeAdapter {
  readonly version = 'baocut-providers/qwen-asr@2';

  /** 内置的三只在前（第一只是默认），用户手动添加的（`vendor.declarable`）跟在后面，限制按同一协议取。 */
  models(config: AdapterConfig): TranscribeModelInfo[] {
    const builtin = BUILTIN_MODELS.map((modelId, i) => asrInfo({ modelId, label: modelId, ...(i === 0 ? { default: true } : {}) }));
    const declared = config.declared
      .filter((m) => (m.capability ?? 'transcribe') === 'transcribe')
      .map((m) => asrInfo({ modelId: m.modelId, label: m.label ?? m.modelId, declared: true, acceptsHint: m.acceptsHint ?? true }));
    return [...builtin, ...declared];
  }

  chunkFormat(_model: TranscribeModelInfo): ChunkFormat {
    return 'wav';
  }

  preferredChunkSec(_model: TranscribeModelInfo): number {
    return 120;
  }

  transcribeChunk(request: ChunkRequest): Promise<ChunkTranscript> {
    return qwenTranscribeChunk(request, PC.vendorQwen().text);
  }

  validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    return openAiValidate(config, signal, http, PC.vendorQwen().text);
  }
}

export async function qwenTranscribeChunk(request: ChunkRequest, label: string): Promise<ChunkTranscript> {
  const { config, model } = request;
  if (model.modelId.includes('-filetrans')) {
    throw new ProviderFailure('unavailable', PC.asyncTranscriptionUnsupported());
  }
  if (model.modelId.startsWith('qwen-audio-')) return qwenAudioTranscribeChunk(request, label);
  const response = await providerFetch(httpOptions(label, config, request.http), {
    method: 'POST',
    url: `${config.baseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json' },
    auth: authOf(config),
    timeoutMs: requestTimeoutMs(request.durationSec, request.http),
    signal: request.signal,
    body: async () => JSON.stringify({
      model: model.modelId,
      stream: false,
      messages: [
        ...(request.hint && model.acceptsHint ? [{ role: 'system', content: request.hint }] : []),
        {
          role: 'user',
          content: [{
            type: 'input_audio',
            input_audio: {
              data: `data:${CHUNK_FORMATS[request.format].mimeType};base64,${(await fs.readFile(request.file)).toString('base64')}`,
            },
          }],
        },
      ],
      asr_options: {
        ...(request.language.mode === 'assert' ? { language: primaryLanguage(request.language.tag) } : {}),
        enable_itn: false,
      },
    }),
  });
  const value = response.json<unknown>();
  if (!isObject(value)) throw new ProviderFailure('protocol', PH.notObject({ label }));
  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  if (!isObject(choice) || !isObject(choice.message) || typeof choice.message.content !== 'string') {
    throw new ProviderFailure('protocol', PH.missingText({ label }));
  }
  if (choice.finish_reason !== 'stop' || (typeof choice.message.refusal === 'string' && choice.message.refusal)) {
    throw new ProviderFailure('protocol', PH.unexpectedFinish({ label, reason: String(choice.finish_reason) }));
  }
  return { text: choice.message.content, ...(value.usage !== undefined ? { usage: value.usage } : {}) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
