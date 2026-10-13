import type { ModelBackend, ModelCapability } from '@baocut/protocol';

/**
 * Runtime 与 Model Worker 之间的合同（Model Worker 协议规范）：消息形状、模型包描述与 `baocut.asr-result/v1`。
 * 这是私有执行器通道，不进公共协议包；字段名与规范逐字对应。
 */

export const WORKER_CONTRACT_VERSION = 1;
export const ASR_RESULT_SCHEMA = 'baocut.asr-result/v1';
export const DEFAULT_TIMESCALE = 1_000_000;

// ---- §4 模型包描述 ----

export type ModelFamily =
  // 识别主模型（`components.asr.family`）：Qwen3-ASR、Whisper 的 MLX 包、CoreML 包与 GGML（whisper.cpp）包、MOSS-Transcribe-Diarize
  // （自己切段、不要 VAD）。
  | 'qwen3-asr'
  | 'whisper-mlx'
  | 'whisper-coreml'
  | 'whisper-ggml'
  | 'moss-transcribe-diarize'
  /** Whisper 的分词器（`tokenizer` 组件，取自 `openai/whisper-large-v3`；MLX 包的 `generation_config.json` 也在这里）。 */
  | 'whisper-tokenizer'
  | 'qwen3-forced-aligner'
  | 'silero-vad'
  | 'wespeaker'
  /** 「说话人区分」模型包的 Pyannote 分段模型（`segmentation` 组件，与 `speaker` 的 WeSpeaker 一起用，§4）。 */
  | 'pyannote-segmentation'
  // 本地语音合成（§4.1）：主模型、共享的语音编解码器与 IndexTTS 2.5 取自 IndexTTS2 仓库的辅助权重。
  | 'qwen3-tts'
  | 'qwen3-tts-tokenizer'
  | 'indextts2'
  | 'indextts2.5'
  | 'indextts2-aux'
  | 'gpt-sovits'
  | 'voxcpm2'
  | 'omnivoice'
  | 'fish-s2-pro'
  | 'fish-s2-pro-codec'
  /** 人声与伴奏分离（`separator` 组件，§4.2）：HTDemucs-FT，四个子模型同在一个权重文件里。 */
  | 'htdemucs-ft'
  // 本地文生图（§4.2）：Qwen-Image-2.1（文本编码器、DiT、VAE 与分词表同在一个 `image` 组件里）。
  | 'qwen-image'
  /** 本地音乐生成（§4.4）：YuE2 的 GGUF 权重（主模型、VAE 与分词表同在一个 `music` 组件里），由 audio.cpp 引擎执行，不交给 Model Worker。 */
  | 'yue2'
  /**
   * audio.cpp 引擎（`audiocpp-engine` 组件，§4.4）：上游 GitHub 发布页的预编译包，按主机平台取一个压缩包解开；不交给 Model Worker，
   * 音乐生成的本地 Provider 直接执行它。
   */
  | 'audio-cpp-engine'
  /**
   * 本地文本嵌入（`embedding` 组件，§4.5）：EmbeddingGemma 2 的 LiteRT-LM 包（单个 `.litertlm`）。文字搜索（text 270M）与多模态搜索
   * （740M）两个模型包同一个 family；这一阶段只用文本编码器。
   */
  | 'embeddinggemma2-litert'
  /** LiteRT-LM 的 C 动态库（`litertlm-runtime` 组件，§4.5）：GitHub 发布页的预编译包，Model Worker 运行期打开它。 */
  | 'litertlm-runtime';
/**
 * `asr` / `vad` / `aligner` / `speaker` / `segmentation` / `tokenizer` 是识别的组件；`tts` / `codec` / `aux` 是语音合成的组件（§4.1）；
 * `separator` 是人声与伴奏分离的组件，`image` 是文生图的组件（§4.2）：两者都不与别的组件同在一个模型包里。
 */
export type BundleComponent =
  | 'asr'
  | 'vad'
  | 'aligner'
  | 'speaker'
  | 'segmentation'
  | 'tokenizer'
  | 'tts'
  | 'codec'
  | 'aux'
  | 'separator'
  | 'image'
  /** 音乐生成的组件（§4.4）：不与别的组件同在一个模型包里，也不交给 Model Worker（audio.cpp 引擎直接读它的目录）。 */
  | 'music'
  /**
   * 音乐生成模型包的 audio.cpp 引擎（§4.4）：平台专属的共享组件，来自 GitHub 发布页而不是模型仓库，装在 Runtime Home 的
   * `tools/audiocpp/<版本>/`，不在模型目录里，也不交给 Model Worker。
   */
  | 'audiocpp-engine'
  /** 文本嵌入的模型（§4.5）：不与识别、合成等组件同在一个模型包里；必须带上 `litertlm-runtime`。 */
  | 'embedding'
  /**
   * 文本嵌入模型包的 LiteRT-LM C 库（§4.5）：平台专属的共享组件，来自 GitHub 发布页，装在 Runtime Home 的
   * `tools/litertlm-runtime/<版本>/`；与 `audiocpp-engine` 不同，它交给 Model Worker（Worker 运行期 `dlopen`）。
   */
  | 'litertlm-runtime';
export const SPEECH_COMPONENTS: readonly BundleComponent[] = ['tts', 'codec', 'aux'];

export interface ModelFiles {
  family: ModelFamily;
  revision: string;
  /** 绝对路径。 */
  dir: string;
  /** 相对 `dir`。 */
  files: Array<{ path: string; sha256: string; byteLength: number }>;
}

export interface ModelBundle {
  bundleId: string;
  backend: ModelBackend;
  device: string;
  components: Partial<Record<BundleComponent, ModelFiles>>;
  threads: number;
  memoryBudgetBytes: number | null;
  /** 后端可写的缓存目录（绝对路径；LiteRT-LM 的编译缓存）。没给时 Worker 用系统临时目录。 */
  cacheDir?: string;
}

// ---- §2 方法 ----

export interface WorkerHello {
  workerVersion: string;
  contractVersion: number;
  pid: number;
  backends: Array<{ id: ModelBackend; available: boolean; reason?: string; devices: string[] }>;
  capabilities: ModelCapability[];
  /**
   * 这个 Worker 能加载的识别主模型 family（`components.asr.family`）。有一个时 `capabilities` 才含 `transcribe`；
   * 识别的模型包只交给列出了它的 family 的 Worker（§2.1）。
   */
  transcribeFamilies: ModelFamily[];
  /**
   * 这个 Worker 能加载的合成主模型 family（`components.tts.family`）。有一个时 `capabilities` 才含 `synthesize`；
   * 合成的模型包只交给列出了它的 family 的 Worker（§2.1）。
   */
  synthesizeFamilies: ModelFamily[];
  /**
   * 这个 Worker 能加载的分离模型 family（`components.separator.family`）。有一个时 `capabilities` 才含 `separate`；
   * 分离的模型包只交给列出了它的 family 的 Worker（§2.1）。
   */
  separateFamilies: ModelFamily[];
  /**
   * 这个 Worker 能加载的文生图 family（`components.image.family`）。有一个时 `capabilities` 才含 `image`；
   * 文生图的模型包只交给列出了它的 family 的 Worker（§2.1）。
   */
  imageFamilies: ModelFamily[];
  /**
   * 文本嵌入（`embed.run`，§2.5.6）：这个构建编进了 LiteRT-LM 后端时才有，同时 `capabilities` 含 `embed`。缺省即不支持
   * （旧的 Worker 没有这个字段）。
   */
  embeddingCapabilities?: EmbeddingCapabilities;
}

export interface EmbeddingCapabilities {
  /** 能加载的 `components.embedding.family`。 */
  families: ModelFamily[];
  /** 引擎接受的 `outputSize`。 */
  outputSizes: number[];
  /** 一次 `embed.run` 至多几条文本。 */
  maxBatch: number;
  /** 引擎的最大输入长度（token）；超过时报 `INPUT_TOO_LONG`。 */
  maxInputTokens: number;
}

export interface ModelLoadResult {
  loaded: true;
  residentBytes: number | null;
  warmupMs: number;
}

export interface WorkerStatus {
  state: 'empty' | 'loading' | 'ready' | 'busy' | 'unloading';
  bundleId: string | null;
  job: { jobId: string; phase: string; startedAt: string } | null;
  memory: { active: number; cache: number; peak: number } | null;
}

export type LanguageOption = { mode: 'assert'; tag: string } | { mode: 'prefer'; tag: string | null };

export interface TranscribeOptions {
  language: LanguageOption;
  diarize: boolean;
  hint?: string;
  timescale: number;
}

export interface TickRange {
  start: number;
  end: number;
  timescale: number;
}

export interface JobInput {
  file: string;
  contentHash: string;
  track: number;
  range?: TickRange;
}

export interface TranscribeRunParams {
  jobId: string;
  runGeneration: number;
  capability: 'transcribe';
  input: JobInput;
  options: TranscribeOptions;
  staging: string;
  outputContract: typeof ASR_RESULT_SCHEMA;
}

/** 合成的输出合同：staging 里的一个 WAV（PCM，单声道或立体声，采样率是模型的原生采样率）。 */
export const SPEECH_WAV_CONTRACT = 'baocut.speech-wav/v1';
/** 合成结果在 staging 里的文件名。 */
export const SPEECH_OUTPUT_FILE = 'speech.wav';

/**
 * 合成的声音（§2.5.2）：`preset` 是模型的说话人；`clone` 用 `input` 的参考录音，`transcript` 是它的原文；
 * `describe` 是一句描述。Worker 不换成别的声音：模型做不到就是 `INVALID_PARAMS`。
 */
export type SynthesizeVoice =
  { mode: 'preset'; id: string } | { mode: 'clone'; transcript: string | null } | { mode: 'describe'; description: string };

/** `job.run`（capability `synthesize`）的冻结参数。文本原样交给 Worker，读音标注由引擎换成自己的写法。 */
export interface SynthesizeOptions {
  text: string;
  /** BCP 47；null 为由引擎按文本判断。 */
  language: string | null;
  voice: SynthesizeVoice;
  /** 语气与风格的说明（模型接受时）。 */
  instructions: string | null;
  speed: number | null;
  cfg: number | null;
  steps: number | null;
  seed: number | null;
}

export interface SynthesizeRunParams {
  jobId: string;
  runGeneration: number;
  capability: 'synthesize';
  /** `clone` 的参考录音（只读、整段、轨 0）；其余声音方式为 null。 */
  input: JobInput | null;
  options: SynthesizeOptions;
  staging: string;
  outputContract: typeof SPEECH_WAV_CONTRACT;
}

/** 分离的输出合同：staging 里人声与背景两个 16-bit PCM 立体声 WAV，采样率是请求的 `sampleRate`，长度与输入相同。 */
export const STEMS_WAV_CONTRACT = 'baocut.stems-wav/v1';
/** 分离结果在 staging 里的文件名。 */
export const STEM_OUTPUT_FILES = { vocals: 'vocals.wav', background: 'background.wav' } as const;

/** `job.run`（capability `separate`）的参数（§2.5.4）：整段输入，不接受 `range`。 */
export interface SeparateRunParams {
  jobId: string;
  runGeneration: number;
  capability: 'separate';
  input: Omit<JobInput, 'range'>;
  /** `sampleRate`：输出的采样率（8000–192000）；null 为模型的工作采样率（HTDemucs 为 44100）。Runtime 传输入音轨的采样率。 */
  options: { sampleRate: number | null };
  staging: string;
  outputContract: typeof STEMS_WAV_CONTRACT;
}

/** 文生图的输出合同：staging 里的一张 8 位 RGBA PNG。 */
export const IMAGE_PNG_CONTRACT = 'baocut.image-png/v1';
/** 文生图结果在 staging 里的文件名。 */
export const IMAGE_OUTPUT_FILE = 'image.png';

/** 音乐生成的输出约定（§4.4）：staging 里一个 WAV（模型的采样率、单声道或立体声、16 位或 32 位浮点）。 */
export const MUSIC_WAV_CONTRACT = 'baocut.music-wav/v1';
/** 音乐生成结果在 staging 里的文件名。 */
export const MUSIC_OUTPUT_FILE = 'music.wav';

/** `job.run`（capability `image`）的冻结参数（§2.5.3）。宽高是像素；`seed` 必给（Runtime 在提交时冻结），同一 seed 同一张图。 */
export interface ImageRunOptions {
  prompt: string;
  width: number;
  height: number;
  /** 去噪步数；null 为模型的默认步数。 */
  steps: number | null;
  seed: number;
  /** 输入图（绝对路径，PNG / JPEG / WebP）；不给即文生图。 */
  images?: { file: string }[];
  /** 有 `images` 时必给：`ref` 是指令改图（第一张是要改的图），`img2img` 是以图为底重画（一张）。 */
  imageMode?: 'ref' | 'img2img';
  /** 0..1，只在 `img2img` 时给且必给。 */
  strength?: number;
}

export interface ImageRunParams {
  jobId: string;
  runGeneration: number;
  capability: 'image';
  options: ImageRunOptions;
  staging: string;
  outputContract: typeof IMAGE_PNG_CONTRACT;
}

/** 已有转写的说话人区分的输出合同：staging 里的 `speakers.json`（§2.5.5）。 */
export const SPEAKERS_CONTRACT = 'baocut.speakers/v1';
/** 说话人区分结果在 staging 里的文件名。 */
export const SPEAKERS_OUTPUT_FILE = 'speakers.json';

/**
 * `job.run`（capability `diarize`）的参数（§2.5.5）：加载的是「说话人区分」模型包本身（只有 `segmentation` 与 `speaker`）。
 * `words` 是转写的词在素材时间上的起止（`timescale` 下的刻度），按转写里的次序。
 */
export interface DiarizeRunParams {
  jobId: string;
  runGeneration: number;
  capability: 'diarize';
  input: JobInput;
  options: { timescale: number; words: Array<[number, number]> };
  staging: string;
  outputContract: typeof SPEAKERS_CONTRACT;
}

/** `job.run`（`diarize`）的结果：`output` 是 staging 里的 `speakers.json`，取消时为 null。 */
export interface DiarizeRunResult {
  outcome: 'completed' | 'cancelled';
  output: JobOutput | null;
  speakers: number;
  stats: { decodeMs: number; diarizeMs: number };
}

/** `speakers.json`（`baocut.speakers/v1`）。 */
export interface SpeakersFile {
  schema: typeof SPEAKERS_CONTRACT;
  clock: 'source-asset';
  timescale: number;
  speakers: Array<{ id: string; words: number; seconds: number }>;
  ranges: Array<{ start: number; end: number; speaker: string }>;
  /** 与参数的 `words` 一一对应：投影到的说话人，拿不到证据的词为 null。 */
  words: Array<string | null>;
  provenance: Record<string, unknown>;
}

export type JobRunParams = TranscribeRunParams | SynthesizeRunParams | SeparateRunParams | ImageRunParams | DiarizeRunParams;

export interface JobOutput {
  path: string;
  sha256: string;
  byteLength: number;
}

export interface JobRunResult {
  outcome: 'completed' | 'cancelled';
  output: JobOutput | null;
  segmentsFile: string | null;
  stats: { decodeMs: number; vadMs: number; asrMs: number; alignMs: number; speechSeconds: number };
}

/** `job.run`（`synthesize`）的结果：`output` 是 staging 里的 `speech.wav`。 */
export interface SynthesizeRunResult {
  outcome: 'completed' | 'cancelled';
  output: JobOutput | null;
  audio: { sampleRate: number; channels: number; durationSec: number } | null;
  stats: { referenceMs: number; synthesisMs: number; encodeMs: number };
  /** 没能按注记念出来的读音（引擎不认读音、注记畸形等）：警告，不是失败；取消时为空（§2.5.2）。 */
  readingsDropped: DroppedReading[];
}

/** `job.run`（`separate`）的结果：`stems` 是 staging 里的 `vocals.wav` 与 `background.wav`（背景是鼓、贝斯与其他之和），取消时为 null。 */
export interface SeparateRunResult {
  outcome: 'completed' | 'cancelled';
  stems: { vocals: JobOutput; background: JobOutput } | null;
  audio: { sampleRate: number; channels: number; durationSec: number } | null;
  stats: { decodeMs: number; separationMs: number; encodeMs: number };
}

/** 一条没念出来的读音注记：去注记后的文字里 `[start, end)`（Unicode 码点偏移）原本要读作 `reading`。 */
export interface DroppedReading {
  start: number;
  end: number;
  /** 规范化后的拼音读音，多字用空格分（`yin2 hang2`）；畸形注记是原文。 */
  reading: string;
  /** 注记的来源：手写、词组表、字典默认或 LLM 定的。 */
  origin: 'user' | 'phrase' | 'dict' | 'llm';
}

/** `job.run`（`image`）的结果：`output` 是 staging 里的 `image.png`。 */
export interface ImageRunResult {
  outcome: 'completed' | 'cancelled';
  output: JobOutput | null;
  image: { width: number; height: number; format: 'png'; seed: number; steps: number } | null;
  stats: { generationMs: number; encodeMs: number };
}

// ---- §3 事件 ----

/** 识别的阶段。 */
export type TranscribeJobPhase = 'decoding' | 'vad' | 'transcribing' | 'aligning' | 'diarizing' | 'finalizing';
/** 合成的阶段：`preparing-reference` → `synthesizing` → `encoding`。 */
export type SynthesizeJobPhase = 'preparing-reference' | 'synthesizing' | 'encoding';
export const SYNTHESIZE_JOB_PHASES: readonly SynthesizeJobPhase[] = ['preparing-reference', 'synthesizing', 'encoding'];
/** 分离的阶段：`decoding` → `separating`（进度单位 `steps` = 窗口 × 子模型）→ `encoding`。 */
export type SeparateJobPhase = 'decoding' | 'separating' | 'encoding';
/** 文生图的阶段：`encoding-prompt` → `denoising`（按步报进度，开始时 `0/n`）→ `decoding`。 */
export type ImageJobPhase = 'encoding-prompt' | 'denoising' | 'decoding';
export const IMAGE_JOB_PHASES: readonly ImageJobPhase[] = ['encoding-prompt', 'denoising', 'decoding'];
export type WorkerJobPhase = TranscribeJobPhase | SynthesizeJobPhase | SeparateJobPhase | ImageJobPhase;

export type WorkerEventParams =
  | { event: 'model.phase'; params: { phase: 'loading-weights' | 'compiling' | 'warming-up'; detail?: string } }
  | { event: 'job.phase'; params: { jobId: string; phase: WorkerJobPhase } }
  | {
      event: 'job.progress';
      params: { jobId: string; phase: WorkerJobPhase; done: number; total: number | null; unit: 'seconds' | 'segments' | 'steps' };
    }
  | { event: 'job.segment'; params: { jobId: string; segment: Segment } }
  | { event: 'job.warning'; params: { jobId: string; warning: AsrWarning } }
  | { event: 'job.language'; params: { jobId: string; tag: string; confidence: number | null } };

// ---- §6 输出合同 ----

export type AsrOutcome = 'transcribed' | 'no-audio-track' | 'no-speech';
export type TimingQuality = 'aligned' | 'provider' | 'estimated' | 'missing';
export const TIMING_QUALITIES: readonly TimingQuality[] = ['aligned', 'provider', 'estimated', 'missing'];

/** `hint-ignored`：模型没有识别提示的通道（MOSS），`hint` 没有交给模型；`segment-incomplete`：模型有一段没写完整，之后可能缺字。 */
export type AsrWarningCode =
  | 'alignment-failed'
  | 'timing-adjusted'
  | 'backend-degraded'
  | 'diarization-unavailable'
  | 'segment-degenerate'
  | 'range-clamped'
  | 'hint-ignored'
  | 'segment-incomplete';
export const ASR_WARNING_CODES: readonly AsrWarningCode[] = [
  'alignment-failed',
  'timing-adjusted',
  'backend-degraded',
  'diarization-unavailable',
  'segment-degenerate',
  'range-clamped',
  'hint-ignored',
  'segment-incomplete',
];

export interface AsrWarning {
  code: AsrWarningCode;
  segmentId?: string;
  detail?: string;
}

export interface Word {
  start: number;
  end: number;
  text: string;
  confidence: number | null;
  timingQuality: TimingQuality;
  /** 说话人区分（Pyannote，§6.6）投影到这个词的说话人，在 `speakers` 里；没有区分或拿不到证据时没有这一项。 */
  speakerId?: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  speakerId: string | null;
  words: Word[];
}

export interface ModelRef {
  family: string;
  revision: string;
}

export interface AsrProvenance {
  provider: string;
  bundleId: string | null;
  models: Partial<Record<BundleComponent, ModelRef>>;
  backend: string;
  device: string;
  workerVersion: string;
  inputHash: string;
  runGeneration: number;
  /**
   * 费用状态（架构设计 §6.4）：只有在线 Provider 给出。`reported` 时 `usage` 是供应商原样报告的用量对象，
   * 没有可信的报告时为 `unknown`；不换算成金额。
   */
  cost?: AsrCost;
}

export interface AsrCost {
  status: 'unknown' | 'reported';
  usage?: unknown;
}

export interface AsrResult {
  schema: typeof ASR_RESULT_SCHEMA;
  outcome: AsrOutcome;
  timescale: number;
  clock: 'source-asset';
  duration: number;
  language: { tag: string | null; source: 'asserted' | 'detected' | 'unknown'; confidence: number | null };
  segments: Segment[];
  speakers: Array<{ id: string; label: string | null }>;
  coverage: Array<{ start: number; end: number }>;
  warnings: AsrWarning[];
  provenance: AsrProvenance;
}

/** `segments.jsonl` 的首行（§5）。 */
export interface SegmentsHeader {
  header: true;
  jobId: string;
  contentHash: string;
  bundleId: string;
  workerVersion: string;
  timescale: number;
}

// ---- §2.5.6 文本嵌入 ----

/** 一次 `embed.run` 至多这么多条文本（Worker 的上限；Runtime 按它分批）。 */
export const EMBED_MAX_BATCH = 16;

/**
 * `embed.run` 的参数。文本已经加好任务前缀（`formatEmbeddingInput`），Worker 不改写；引擎按 `outputSize` 输出、开着归一化，
 * 超长报错不截断。一批在推理线程上一次算完，中途不响应取消：`worker.status` 的 `job.jobId` 是 `requestId`，`job.cancel` 照常确认，
 * 结果照常返回，由 Runtime 丢弃。
 */
export interface EmbedRunParams {
  requestId: string;
  texts: string[];
  outputSize: number;
  insertSpecialTokens: boolean;
}

/**
 * `embed.run` 的结果：每条文本一个向量，little-endian `float32` 的标准 base64，次序同 `texts`。C API 不报每条的 token 数，
 * 所以没有 `inputLengths`。
 */
export interface EmbedRunResult {
  vectors: string[];
  dims: number;
  device: string;
  elapsedMs: number;
}

// ---- §7 错误 ----

/** `embed.run` 的一条文本超过模型的最大输入长度：`details.index` 指出哪一条。不可重试。 */
export const INPUT_TOO_LONG = 'INPUT_TOO_LONG';

/** `model.load` 只会返回这三种失败。 */
export const LOAD_FAILURE_CODES = ['MODEL_NOT_INSTALLED', 'MODEL_UNSUPPORTED', 'MODEL_RESOURCE'] as const;
/** 推理途中可重试的失败：与进程崩溃一样计入崩溃次数（架构设计 §6.5）。 */
export const CRASH_CODES = ['WORKER_PANIC', 'INFERENCE_FAILED', 'DECODE_FAILED'] as const;
/** 输出写不进 staging（磁盘满、权限）：可重试，但与模型无关，不计崩溃次数。 */
export const OUTPUT_WRITE_FAILED = 'OUTPUT_WRITE_FAILED';
