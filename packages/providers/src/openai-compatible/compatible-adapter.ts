// OpenAI 兼容端点的转写适配器（架构设计 §6.4）：用户给出基址与模型，请求形状同 OpenAI。2026-10-03 读过的文档：
//   https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
// 兼容端点各家实现不一（vLLM、LocalAI、faster-whisper-server 等），这里只假定 `POST {base}/audio/transcriptions`
// 接受 multipart 的 `file`/`model`/`response_format`/`language`/`prompt`，`verbose_json` 时可能带 `segments`、`words`；
// 都是假定，没有逐家确认。声明了 `wordTimestamps: 'native'` 的模型请求 `verbose_json` 与词、段时间，其余请求 `json`。
// 密钥可选；切片用 WAV（兼容端点最普遍接受的格式）。
import type { DeclaredModel, ModelServiceCapability, TranscribeModelInfo } from '@baocut/protocol';
import type { ChunkFormat } from '../audio/audio-prep.ts';
import type { AdapterConfig, AdapterHttp, ChunkRequest, ChunkTranscript, TranscribeAdapter } from '../adapter.ts';
import { openAiTranscribeChunk, openAiValidate } from '../openai/openai-transcription.ts';

const DEFAULT_MAX_BYTES = 25_000_000;
const TIMELESS_CHUNK_SEC = 120;

export class CompatibleAdapter implements TranscribeAdapter {
  readonly version = 'baocut-providers/openai-compatible@1';
  /** 显示名可能随配置改变：每次用时再取。 */
  readonly #label: () => string;

  constructor(label: () => string) {
    this.#label = label;
  }

  models(config: AdapterConfig): TranscribeModelInfo[] {
    return declaredOf(config, 'transcribe').map((m, i) => declaredModelInfo(m, i === 0));
  }

  chunkFormat(_model: TranscribeModelInfo): ChunkFormat {
    return 'wav';
  }

  preferredChunkSec(model: TranscribeModelInfo): number | null {
    return model.wordTimestamps === 'native' ? null : TIMELESS_CHUNK_SEC;
  }

  transcribeChunk(request: ChunkRequest): Promise<ChunkTranscript> {
    return openAiTranscribeChunk(request, { label: this.#label(), verbose: request.model.wordTimestamps === 'native' });
  }

  validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    return openAiValidate(config, signal, http, this.#label());
  }
}

/** 声明为某种能力的模型（`capability` 不给时是 `transcribe`），按声明的顺序；第一个是这种能力的默认模型。 */
export function declaredOf(config: AdapterConfig, capability: ModelServiceCapability): DeclaredModel[] {
  return config.declared.filter((m) => (m.capability ?? 'transcribe') === capability);
}

/** 声明的模型补上保守的默认值。 */
export function declaredModelInfo(model: DeclaredModel, isDefault: boolean): TranscribeModelInfo {
  return {
    modelId: model.modelId,
    label: model.label ?? model.modelId,
    ...(isDefault ? { default: true } : {}),
    declared: true,
    maxInputBytes: model.maxInputBytes ?? DEFAULT_MAX_BYTES,
    maxDurationSec: model.maxDurationSec ?? null,
    wordTimestamps: model.wordTimestamps ?? 'native',
    languages: 'any',
    acceptsHint: model.acceptsHint ?? true,
    cost: 'unknown',
  };
}
