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
  /** 人声与伴奏分离（`separator` 组件，§4.2）：HTDemucs-FT，四个子模型同在一个权重文件里。 */
  | 'htdemucs-ft'
  // 本地文生图（§4.2）：Qwen-Image-2.1（文本编码器、DiT、VAE 与分词表同在一个 `image` 组件里）。
  | 'qwen-image';
/**
 * `asr` / `vad` / `aligner` / `speaker` / `segmentation` / `tokenizer` 是识别的组件；`tts` / `codec` / `aux` 是语音合成的组件（§4.1）；
 * `separator` 是人声与伴奏分离的组件，`image` 是文生图的组件（§4.2）：两者都不与别的组件同在一个模型包里。
 */
export type BundleComponent =
  'asr' | 'vad' | 'aligner' | 'speaker' | 'segmentation' | 'tokenizer' | 'tts' | 'codec' | 'aux' | 'separator' | 'image';
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

/** `job.run`（capability `image`）的冻结参数（§2.5.3）。宽高是像素；`seed` 必给（Runtime 在提交时冻结），同一 seed 同一张图。 */
export interface ImageRunOptions {
  prompt: string;
  width: number;
  height: number;
  /** 去噪步数；null 为模型的默认步数。 */
  steps: number | null;
  seed: number;
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

// ---- §7 错误 ----

/** `model.load` 只会返回这三种失败。 */
export const LOAD_FAILURE_CODES = ['MODEL_NOT_INSTALLED', 'MODEL_UNSUPPORTED', 'MODEL_RESOURCE'] as const;
/** 推理途中可重试的失败：与进程崩溃一样计入崩溃次数（架构设计 §6.5）。 */
export const CRASH_CODES = ['WORKER_PANIC', 'INFERENCE_FAILED', 'DECODE_FAILED'] as const;
/** 输出写不进 staging（磁盘满、权限）：可重试，但与模型无关，不计崩溃次数。 */
export const OUTPUT_WRITE_FAILED = 'OUTPUT_WRITE_FAILED';
