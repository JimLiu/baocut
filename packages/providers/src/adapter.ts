import type { ImageParameters, LanguageOption, SpeechParameters, TextParameters, TextReply } from '@baocut/models';
import type {
  DeclaredModel,
  ImageFormat,
  ImageModelInfo,
  SpeechFormat,
  SpeechModelInfo,
  SpeechVoice,
  TextModelInfo,
  TranscribeModelInfo,
} from '@baocut/protocol';
import type { ChunkFormat } from './audio/audio-prep.ts';
import type { ProviderHttpOptions } from './http/provider-fetch.ts';

/**
 * 在线转写适配器（架构设计 §6.4）：一个供应商的请求与响应形状。音频准备、切片、拼接、结果组装都在
 * `OnlineTranscriber` 里，适配器只管把一块音频发出去、把响应读成 `ChunkTranscript`。
 *
 * `synthesizeSpeech` / `generateImage` 的适配器（`SpeechAdapter`、`ImageAdapter`）同样只管请求与响应的形状：
 * 一次合成或一次生成，把响应读成字节。写文件、算摘要在 `OnlineGenerator` 里，校验与发布在 JobManager 里。
 */

/** 一个在线 Provider 此刻的配置（来自配置存储）。密钥只交给适配器放进请求头。 */
export interface AdapterConfig {
  providerId: string;
  /** 不带结尾斜杠的基址。 */
  baseUrl: string;
  credential: string | null;
  /** 密钥属于哪个账号（§6.8，执行时取密钥时定下）；没有账号或只是描述时不给。用量记录与账号状态用它。 */
  accountId?: string | null;
  /** 自定义端点声明的模型。 */
  declared: readonly DeclaredModel[];
}

/** 适配器发请求时的调节项（测试注入更短的退避与期限）。 */
export interface AdapterHttp {
  backoffMs?: ProviderHttpOptions['backoffMs'];
  /** 单次请求的期限（毫秒）；不给时按音频时长估。 */
  timeoutMs?: number;
  /** 一共试几次（默认 3）。 */
  attempts?: number;
}

export interface ChunkRequest {
  config: AdapterConfig;
  model: TranscribeModelInfo;
  /** 编码好的一块音频（staging 里的绝对路径）。 */
  file: string;
  byteLength: number;
  format: ChunkFormat;
  durationSec: number;
  language: LanguageOption;
  hint?: string;
  signal: AbortSignal;
  http: AdapterHttp;
}

/** 一块音频的转写。时间是相对这一块起点的秒。 */
export interface ChunkTranscript {
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  /** 供应商给出的词级时间。 */
  words?: Array<{ start: number; end: number; text: string; confidence?: number | null }>;
  /** 供应商识别出的语言（BCP 47；认不出时 null）。 */
  language?: string | null;
  /** 供应商原样报告的用量。 */
  usage?: unknown;
}

export interface TranscribeAdapter {
  /** 写进结果 `provenance.workerVersion` 的版本。 */
  readonly version: string;
  /** 这个 Provider 的模型。自定义端点按声明给出。 */
  models(config: AdapterConfig): TranscribeModelInfo[];
  /** 切片用什么编码。 */
  chunkFormat(model: TranscribeModelInfo): ChunkFormat;
  /** 比限制更短的偏好块长（秒），例如不返回时间的模型切短些让插值不太粗；null 为按限制切。 */
  preferredChunkSec(model: TranscribeModelInfo): number | null;
  transcribeChunk(request: ChunkRequest): Promise<ChunkTranscript>;
  /** 用这份配置向供应商发一个只读请求，验证密钥与端点。只在 `models.configure` 带 `verify: true` 时调用。 */
  validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void>;
}

/** 按音频时长估单次请求的期限：至少 2 分钟，每分钟音频再加 1 分钟，最多 30 分钟。 */
export function requestTimeoutMs(durationSec: number, http: AdapterHttp): number {
  if (http.timeoutMs !== undefined) return http.timeoutMs;
  return Math.min(30 * 60_000, 120_000 + Math.ceil(durationSec / 60) * 60_000);
}

/** 断言的语言给供应商时只用主语言子标签（`zh-Hans` → `zh`）。 */
export function primaryLanguage(tag: string): string {
  return tag.split('-')[0]!.toLowerCase();
}

// ---- 生成类能力 ----

/** 媒体格式的扩展名与媒体类型。 */
export const SPEECH_MEDIA: Record<SpeechFormat, { extension: string; mediaType: string }> = {
  mp3: { extension: 'mp3', mediaType: 'audio/mpeg' },
  wav: { extension: 'wav', mediaType: 'audio/wav' },
  flac: { extension: 'flac', mediaType: 'audio/flac' },
};
export const IMAGE_MEDIA: Record<ImageFormat, { extension: string; mediaType: string }> = {
  png: { extension: 'png', mediaType: 'image/png' },
  jpeg: { extension: 'jpg', mediaType: 'image/jpeg' },
  webp: { extension: 'webp', mediaType: 'image/webp' },
};

/** 生成请求的期限：合成与生图都可能要几十秒到几分钟。测试注入更短的。 */
export function generationTimeoutMs(http: AdapterHttp): number {
  return http.timeoutMs ?? 5 * 60_000;
}

export interface SpeechRequest {
  config: AdapterConfig;
  model: SpeechModelInfo;
  parameters: SpeechParameters;
  signal: AbortSignal;
  http: AdapterHttp;
}

export interface SpeechOutput {
  bytes: Buffer;
  /** 用量（供应商原样报告的；纯音频响应没有）。 */
  usage?: unknown;
}

export interface SpeechAdapter {
  readonly version: string;
  models(config: AdapterConfig): SpeechModelInfo[];
  /** 合成一次：返回请求格式（`parameters.format`）的音频字节。 */
  synthesize(request: SpeechRequest): Promise<SpeechOutput>;
}

export interface ImageRequest {
  config: AdapterConfig;
  model: ImageModelInfo;
  parameters: ImageParameters;
  signal: AbortSignal;
  http: AdapterHttp;
  /** 已经拿到第几张（多次请求凑齐张数的适配器报告进度用）。 */
  progress(done: number): void;
}

export interface ImageOutput {
  /** 恰好 `parameters.count` 张，格式是 `parameters.format`。 */
  images: Buffer[];
  usage?: unknown;
}

export interface ImageAdapter {
  readonly version: string;
  models(config: AdapterConfig): ImageModelInfo[];
  generate(request: ImageRequest): Promise<ImageOutput>;
}

// ---- 文本模型 ----

/** 文本请求的期限：长输出与高推理强度可能要几分钟。测试注入更短的。 */
export function textTimeoutMs(http: AdapterHttp): number {
  return http.timeoutMs ?? 10 * 60_000;
}

export interface TextRequest {
  config: AdapterConfig;
  model: TextModelInfo;
  parameters: TextParameters;
  signal: AbortSignal;
  http: AdapterHttp;
  /** HTTP 层每退避重试一次调用一次。 */
  onRetry(): void;
}

export interface TextAdapter {
  readonly version: string;
  models(config: AdapterConfig): TextModelInfo[];
  /** 一次调用：把冻结的参数换成供应商的写法，读出文本、结束原因、用量与模型版本。检查在 `finishText` 里。 */
  generate(request: TextRequest): Promise<TextReply>;
}

// ---- 模型列表 ----

/** 向供应商取到的列表：模型 ID 与（有的话）账号里的音色。 */
export interface ProviderListing {
  models: string[];
  voices?: SpeechVoice[];
}

export interface ModelLister {
  /** 只读请求；失败抛 `ProviderFailure`（文本不含密钥）。 */
  listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing>;
}

// ---- 音色克隆 ----

/** 克隆请求的期限：上传一段参考录音、等供应商建好音色。测试注入更短的。 */
export function voiceCloneTimeoutMs(http: AdapterHttp): number {
  return http.timeoutMs ?? 2 * 60_000;
}

export interface VoiceCloneRequest {
  config: AdapterConfig;
  /** 克隆在供应商那边的名字。 */
  name: string;
  /** 参考录音（绝对路径），整个上传。 */
  file: string;
  fileName: string;
  mediaType: string;
  /** 附在克隆上的说明（供应商接受时）；没有时 null。 */
  description: string | null;
  signal: AbortSignal;
  http: AdapterHttp;
}

export interface VoiceCloneDeleteRequest {
  config: AdapterConfig;
  voiceId: string;
  signal: AbortSignal;
  http: AdapterHttp;
}

/**
 * 音色克隆（架构设计 §5.9）：只有真的提供克隆接口的供应商才有这个适配器。创建把参考录音上传、返回供应商的音色 ID；
 * 删除请求删掉远端的克隆，供应商那边已经没有时返回 `not-found`（不算失败）。
 */
export interface VoiceCloneAdapter {
  readonly version: string;
  createVoiceClone(request: VoiceCloneRequest): Promise<{ voiceId: string }>;
  deleteVoiceClone(request: VoiceCloneDeleteRequest): Promise<'deleted' | 'not-found'>;
}
