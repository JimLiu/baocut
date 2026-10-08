// OpenAI 转写适配器（架构设计 §6.4）。2026-10-03 读过的文档：
//   https://developers.openai.com/api/docs/guides/speech-to-text
//   https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
// 文档确认的：whisper-1 支持 `verbose_json` 与 `timestamp_granularities[]`（词、段）；gpt-4o-transcribe 与
// gpt-4o-mini-transcribe 只支持 `json`/`text`，没有时间戳，用量是 token；文件 ≤ 25 MB；接受 m4a；`prompt` 用于术语提示。
// 没能确认的：gpt-4o 系列单次请求的时长上限（这里按 120 秒切片，既避开可能的上限，也让插值的词时间不太粗）；
// 指南里的 `gpt-transcribe` 没有在参考文档里给出参数，没有列入。
import type { TranscribeModelInfo } from '@baocut/protocol';
import type { ChunkFormat } from '../audio/audio-prep.ts';
import type { AdapterConfig, AdapterHttp, ChunkRequest, ChunkTranscript, TranscribeAdapter } from '../adapter.ts';
import { openAiTranscribeChunk, openAiValidate } from './openai-transcription.ts';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const LABEL = 'OpenAI';
const MAX_BYTES = 25_000_000;
/** 不返回时间的模型按这个长度切片。 */
const TIMELESS_CHUNK_SEC = 120;

const MODELS: TranscribeModelInfo[] = [
  {
    modelId: 'whisper-1',
    label: 'Whisper',
    default: true,
    maxInputBytes: MAX_BYTES,
    maxDurationSec: null,
    wordTimestamps: 'native',
    languages: 'any',
    acceptsHint: true,
    cost: 'unknown',
  },
  {
    modelId: 'gpt-4o-transcribe',
    label: 'GPT-4o Transcribe',
    maxInputBytes: MAX_BYTES,
    maxDurationSec: null,
    wordTimestamps: 'none',
    languages: 'any',
    acceptsHint: true,
    cost: 'unknown',
  },
  {
    modelId: 'gpt-4o-mini-transcribe',
    label: 'GPT-4o mini Transcribe',
    maxInputBytes: MAX_BYTES,
    maxDurationSec: null,
    wordTimestamps: 'none',
    languages: 'any',
    acceptsHint: true,
    cost: 'unknown',
  },
];

export class OpenAiAdapter implements TranscribeAdapter {
  readonly version = 'baocut-providers/openai@1';

  models(_config: AdapterConfig): TranscribeModelInfo[] {
    return MODELS.map((m) => ({ ...m }));
  }

  chunkFormat(_model: TranscribeModelInfo): ChunkFormat {
    return 'm4a';
  }

  preferredChunkSec(model: TranscribeModelInfo): number | null {
    return model.wordTimestamps === 'native' ? null : TIMELESS_CHUNK_SEC;
  }

  transcribeChunk(request: ChunkRequest): Promise<ChunkTranscript> {
    return openAiTranscribeChunk(request, { label: LABEL, verbose: request.model.wordTimestamps === 'native' });
  }

  validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    return openAiValidate(config, signal, http, LABEL);
  }
}
