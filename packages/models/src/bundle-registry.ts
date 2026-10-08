import type {
  ModelBackend,
  ModelCapability,
  ModelLicense,
  SpeechKnobRange,
  SpeechReadings,
  SpeechVoiceDescription,
  VoiceMode,
} from '@baocut/protocol';
import { ModelsBundleRegistry as M } from '@baocut/protocol/messages/models/bundle-registry.ts';
import { IMAGE_BUNDLES } from './image-bundles.ts';
import { SPEECH_BUNDLES } from './speech-bundles.ts';
import type { BundleComponent, ModelFamily } from './worker-contract.ts';

/**
 * 模型包登记（架构设计 §6.3、§6.5）。P0 写死在这里；下载器与多 backend 选择（P1）接上之后改为从目录读取。
 *
 * 每个组件指向模型目录里的一个上游仓库：`<models-root>/<owner>/<repo>/`，`revision` 固定为上游的提交。
 */

export interface BundleComponentSource {
  family: ModelFamily;
  /** `<owner>/<repo>` */
  repo: string;
  revision: string;
  /**
   * 可选的组件：安装与修复照样下载它，但缺它时模型包仍算装好（不是 `incomplete`），交给 Worker 时略去。
   * 用于几个模型包共用、后来才加进来的组件（对齐器、说话人模型），已装好的模型包不因此变得不完整。
   */
  optional?: true;
  /** 与主模型许可不同的组件自己的许可（对齐器、说话人模型）。 */
  license?: ModelLicense;
  /**
   * 组件在仓库里的子目录（`/` 分隔，不带首尾斜杠）。安装、校验与装没装好照旧按整个仓库算；交给 Worker 时组件的目录是
   * 这个子目录，只带其下的文件，路径相对它（`argmaxinc/whisperkit-coreml` 一个仓库放着多个 Whisper 变体）。
   */
  subdir?: string;
  /**
   * 权重主体的存储位宽：MLX 仿射量化的 4 / 8，bf16 的 16，f32 的 32。量化包里常有不量化的部分（音频塔、范数，以 bf16 / f16
   * 存），所以只在不知道 `parameters` 时用来估计 candle 的常驻量（`candleResidentBytes`）。
   */
  weightBits?: 4 | 8 | 16 | 32;
  /**
   * 反量化之后的参数个数（按 safetensors 头里各张量的形状数出来，量化张量按位宽展开，不计 `scales` / `biases`）。candle 后端
   * 加载时把权重都换成计算精度，常驻量约为参数个数 × 每个参数的字节数（CPU 的 f32 是 4，CUDA 的半精度是 2）。
   */
  parameters?: number;
}

export interface BundleDefinition {
  bundleId: string;
  capability: ModelCapability;
  backend: ModelBackend;
  device: string;
  components: Partial<Record<BundleComponent, BundleComponentSource>>;
  /** 给人看的名字（必填）：同一个模型换后端（MLX / candle、Core ML / GGML）名字不变（架构设计 §6.5）。 */
  label: string;
  /** 权重的许可（下载前给人看）。 */
  license?: ModelLicense;
  /** `synthesize` 模型包的特性：`local` Provider 据此描述 `synthesizeSpeech` 模型、在提交时检查请求。 */
  speech?: SpeechBundleProfile;
  /** `image` 模型包的特性：`local` Provider 据此描述 `generateImage` 模型、资源调度据此计 Model Worker 的峰值。 */
  image?: ImageBundleProfile;
  /**
   * 识别模型包用哪个「说话人区分」模型包（`capability: 'diarize'`，架构设计 §6.6）：它装好了，交给 Worker 的模型包带上它的组件
   * （`segmentation` 与 `speaker`），转写要说话人时识别完成后区分。没装时不带，要说话人只报 `diarization-unavailable`。
   */
  diarization?: string;
}

/** 一个本地文生图模型包能做什么（架构设计 §6.1、§6.3）。一次一张、只出 PNG、不收参考图、接受 seed。 */
export interface ImageBundleProfile {
  family: string;
  /** 宽高比与它的像素尺寸；第一个是默认尺寸。 */
  aspects: ReadonlyArray<{ ratio: string; size: string }>;
  /** 另外接受、不进画幅菜单的尺寸（`WIDTHxHEIGHT`）：设置页「试画」的小图。 */
  extraSizes: readonly string[];
  /** 提示词上限（Unicode 码点）。 */
  maxPromptChars: number;
  /** 请求能给的去噪步数；`default` 是不指定时的步数（Worker 用同一个默认值）。 */
  steps: SpeechKnobRange;
  /**
   * Model Worker 进程的峰值内存（字节，实测后取整留余量）：三段权重逐层流式读入、从不同时驻留，峰值与权重总量无关，
   * 资源调度按它计 Model Worker 的需求。这是登记的设备上的值；candle 模型包在 Worker 报告的设备与登记的不同时（CUDA）
   * 用 `devicePeakBytes` 里那个设备的值。
   */
  peakBytes: number;
  /** candle 模型包按 Worker 报告的设备覆盖 `peakBytes`（键是设备，如 `cuda`）。没有的设备用 `peakBytes`。 */
  devicePeakBytes?: Readonly<Record<string, number>>;
  /** 在这台机器上一张要几分钟到十几分钟：界面提示耗时。 */
  slow: boolean;
}

/**
 * 一个本地语音合成模型包能做什么（架构设计 §6.1、§6.3）。
 *
 * - `presets`：预设音色从哪来。`model` 是模型自带的说话人（`speakers`）；`builtin-reference` 是内置音色（随应用分发的
 *   参考录音，选它即用那段录音克隆）；`builtin-description` 是内置音色的英文声音描述（按描述造声的模型）。
 * - `voiceModes` 只列 `preset` / `clone` / `describe`：本地模型没有供应商账号里的音色（`custom`）。
 */
export interface SpeechBundleProfile {
  family: string;
  languages: 'any' | string[];
  voiceModes: Exclude<VoiceMode, 'custom'>[];
  presets: 'model' | 'builtin-reference' | 'builtin-description' | 'none';
  /** `presets: 'model'` 时模型自带的说话人。 */
  speakers?: string[];
  reference: { recommendedSeconds: [number, number]; withTranscriptSeconds: [number, number] | null; acceptsTranscript: boolean } | null;
  voiceDescription: SpeechVoiceDescription | null;
  instructions: 'style' | null;
  emotion: boolean;
  knobs: Partial<Record<'speed' | 'cfg' | 'steps', SpeechKnobRange>>;
  maxDurationSec: number | null;
  acceptsSeed: boolean;
  readings: SpeechReadings;
  sampleRate: number;
  slow: boolean;
}

/** Apple Silicon 上的默认转写模型包。按平台取默认用 `defaultTranscribeBundle`。 */
export const DEFAULT_TRANSCRIBE_BUNDLE = 'qwen3-asr-0.6b@mlx-4bit';
/** 别的平台（Windows、Linux、Intel Mac）上的默认转写模型包：同一份权重，candle 后端。 */
export const DEFAULT_CANDLE_TRANSCRIBE_BUNDLE = 'qwen3-asr-0.6b@candle';
/** 各平台的默认转写模型包（不知道对方平台时，例如远端节点还没回报模型包，按这个顺序找）。 */
export const DEFAULT_TRANSCRIBE_BUNDLES: readonly string[] = [DEFAULT_TRANSCRIBE_BUNDLE, DEFAULT_CANDLE_TRANSCRIBE_BUNDLE];

/** 识别模型包共用的 Silero VAD。 */
const SILERO_VAD: BundleComponentSource = {
  family: 'silero-vad',
  repo: 'aufklarer/Silero-VAD-v6.2.1-MLX',
  revision: '0046cea48b26401909b24292b688fbc9b6322bc5',
  weightBits: 32,
  parameters: 309_121,
};

const QWEN3_ASR_LICENSE: ModelLicense = {
  name: 'Apache-2.0',
  url: 'https://huggingface.co/Qwen/Qwen3-ASR-1.7B',
  commercialUse: true,
  // 许可摘要给人看：用 getter，读的时候（列出状态、序列化过线）按当前语言生成。
  get summary() {
    return M.qwen3AsrLicense().text;
  },
};

/**
 * 识别模型包（Qwen3-ASR、Whisper、MOSS）共用的强制对齐器（可选）：装了，本地识别的词时间是对齐出来的（`aligned`；MOSS 只对齐
 * 长于 5 秒的行），并提供 `align` 能力；没装时按字符长度估计（架构设计 §6.6）。
 */
export const QWEN3_FORCED_ALIGNER: BundleComponentSource = {
  family: 'qwen3-forced-aligner',
  repo: 'aufklarer/Qwen3-ForcedAligner-0.6B-4bit',
  revision: 'f0e9f12a0ddbcb5f1e1b7f0339090628f1cede1d',
  optional: true,
  weightBits: 4,
  parameters: 917_728_896,
  license: {
    name: 'Apache-2.0',
    url: 'https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B',
    commercialUse: true,
    get summary() {
      return M.qwen3AlignerLicense().text;
    },
  },
};

/**
 * WeSpeaker ResNet34-LM 说话人嵌入（可选），给自分段模型（MOSS）合并跨块的说话人；Qwen3-ASR 与 Whisper 的模型包不带，
 * 由「说话人区分」模型包带（必需，与 Pyannote 分段一起用）。
 * MLX 转换包的模型卡标 MIT，但权重来自 pyannote 的 WeSpeaker 转换，上游按 CC-BY-4.0 发布，以上游为准。CC-BY-4.0 要署名，
 * 署名（作品、作者、许可与改动）写在许可的 `summary` 里；模型包状态的组件带上这份许可，供界面在模型详情的许可行列出（架构设计 §6.3）。
 */
export const WESPEAKER: BundleComponentSource = {
  family: 'wespeaker',
  repo: 'aufklarer/WeSpeaker-ResNet34-LM-MLX',
  revision: '26499ce11ad1b48ac96aacc8d6fa433f941bdc96',
  optional: true,
  weightBits: 32,
  parameters: 6_630_080,
  license: {
    name: 'CC-BY-4.0',
    url: 'https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM',
    commercialUse: true,
    get summary() {
      return M.wespeakerLicense().text;
    },
  },
};

/**
 * Pyannote segmentation-3.0 的 MLX 转换包：「说话人区分」模型包的分段模型（滑窗逐帧判断谁在说话），candle 读同一个仓库。
 */
const PYANNOTE_SEGMENTATION: BundleComponentSource = {
  family: 'pyannote-segmentation',
  repo: 'aufklarer/Pyannote-Segmentation-MLX',
  revision: 'abef0110277063f0ea117a802832a3eba22af84c',
  weightBits: 32,
  parameters: 1_489_169,
};

const { optional: _optional, ...WESPEAKER_REQUIRED } = WESPEAKER;

/** Apple Silicon 上的「说话人区分」模型包（MLX）；Core ML 的 Whisper 同样用它（Worker 里是 MLX 的 Pyannote 与 WeSpeaker）。 */
export const SPEAKER_DIARIZATION_BUNDLE = 'speaker-diarization@mlx';
/** 别的平台上的「说话人区分」模型包（candle，同一批仓库）；GGML 的 Whisper 同样用它。 */
export const SPEAKER_DIARIZATION_CANDLE_BUNDLE = 'speaker-diarization@candle';

/**
 * 「说话人区分」模型包（架构设计 §6.6）：Pyannote 分段 + WeSpeaker 声纹聚类，给不自带区分的识别模型包（Qwen3-ASR、Whisper）
 * 在转写之后标说话人；AI 工具「识别说话人」给已有转写重新区分时，它单独加载进 Model Worker（`job.run` 的 `diarize`）。
 * MOSS 自己区分，不用它。WeSpeaker 与 MOSS 的说话人模型是同一个仓库，装一份共用。
 */
const SPEAKER_DIARIZATION: BundleDefinition = {
  bundleId: SPEAKER_DIARIZATION_BUNDLE,
  capability: 'diarize',
  backend: 'mlx',
  device: 'metal',
  get label() {
    return M.speakerDiarizationLabel().text;
  },
  components: { segmentation: PYANNOTE_SEGMENTATION, speaker: WESPEAKER_REQUIRED },
  license: {
    name: 'MIT',
    url: 'https://huggingface.co/pyannote/segmentation-3.0',
    commercialUse: true,
    get summary() {
      return M.pyannoteLicense().text;
    },
  },
};

/**
 * Whisper 的分词器（`tokenizer.json` 等），large-v3 与 turbo 共用，取自 `openai/whisper-large-v3`，是单独的组件。旧版只把
 * `tokenizer.json` 叠放进权重仓库目录，那份不算装好：从旧版升级的安装要补下这约 4 MB。MLX 包的 `generation_config.json`
 * 也取自这里（mlx-community 的仓库没有它）；它是后加进清单的：装没装好按磁盘上的清单判断，早先装好的分词器组件
 * 照样算装好（Core ML 不受影响），但没有这个文件，交给 MLX 包时 Worker 报 `MODEL_NOT_INSTALLED`。列出 MLX 包之前要让旧安装补下它。
 */
const WHISPER_TOKENIZER: BundleComponentSource = {
  family: 'whisper-tokenizer',
  repo: 'openai/whisper-large-v3',
  revision: '06f233fe06e710322aca913c1bc4249a0d71fce1',
};

const WHISPER_LARGE_V3_LICENSE: ModelLicense = {
  name: 'Apache-2.0',
  url: 'https://huggingface.co/openai/whisper-large-v3',
  commercialUse: true,
  get summary() {
    return M.whisperV3CoremlLicense().text;
  },
};

const WHISPER_TURBO_LICENSE: ModelLicense = {
  name: 'MIT',
  url: 'https://huggingface.co/openai/whisper-large-v3-turbo',
  commercialUse: true,
  get summary() {
    return M.whisperTurboCoremlLicense().text;
  },
};

/** 同一份权重的 MLX 转换（mlx-community 的 fp16 仓库）另标 Apache-2.0。 */
const WHISPER_LARGE_V3_MLX_LICENSE: ModelLicense = {
  name: 'Apache-2.0',
  url: 'https://huggingface.co/openai/whisper-large-v3',
  commercialUse: true,
  get summary() {
    return M.whisperV3MlxLicense().text;
  },
};

const WHISPER_TURBO_MLX_LICENSE: ModelLicense = {
  name: 'MIT',
  url: 'https://huggingface.co/openai/whisper-large-v3-turbo',
  commercialUse: true,
  get summary() {
    return M.whisperTurboMlxLicense().text;
  },
};

/** 人声分离：HTDemucs-FT 的 MLX 转换包（架构设计 §6.1 `separateAudio`）；candle 读同一个仓库（fp16 权重加载时升成 f32）。 */
const HTDEMUCS_FT_LICENSE: ModelLicense = {
  name: 'MIT',
  url: 'https://github.com/facebookresearch/demucs/blob/main/LICENSE',
  commercialUse: true,
  get summary() {
    return M.htdemucsLicense().text;
  },
};

/** 同一份权重的 GGML 转换（whisper.cpp 仓库）另标 MIT。 */
const WHISPER_LARGE_V3_GGML_LICENSE: ModelLicense = {
  name: 'Apache-2.0',
  url: 'https://huggingface.co/openai/whisper-large-v3',
  commercialUse: true,
  get summary() {
    return M.whisperV3GgmlLicense().text;
  },
};

const WHISPER_TURBO_GGML_LICENSE: ModelLicense = {
  name: 'MIT',
  url: 'https://huggingface.co/openai/whisper-large-v3-turbo',
  commercialUse: true,
  get summary() {
    return M.whisperTurboGgmlLicense().text;
  },
};

/**
 * whisper.cpp 的单文件 GGML 权重（词表内嵌，不要分词器组件）。两个模型包的文件在同一个上游仓库的同一版本里：large-v3
 * 登记在兄弟目录 `ggerganov/whisper.cpp-large-v3` 名下（下载仍取自 `ggerganov/whisper.cpp`，见仓库清单的 `sourceRepo`），
 * 两个模型包各装各删，装一个不连带下载另一个。
 */
const WHISPER_GGML_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';

// Whisper 的 MLX、Core ML 与 GGML 三个后端共用同一个名字（架构设计 §6.5），界面不露 bundleId。
const WHISPER_LARGE_V3_LABEL = 'Whisper large-v3';
const WHISPER_TURBO_LABEL = 'Whisper large-v3 turbo';

const QWEN3_ASR_0_6B: BundleDefinition = {
  bundleId: DEFAULT_TRANSCRIBE_BUNDLE,
  capability: 'transcribe',
  backend: 'mlx',
  device: 'metal',
  label: 'Qwen3-ASR 0.6B',
  components: {
    asr: {
      family: 'qwen3-asr',
      repo: 'aufklarer/Qwen3-ASR-0.6B-MLX-4bit',
      revision: 'bc441bd1e4295c1f42d9879f056049a925b6e013',
      weightBits: 4,
      parameters: 782_426_112,
    },
    vad: SILERO_VAD,
    aligner: QWEN3_FORCED_ALIGNER,
  },
  license: {
    name: 'Apache-2.0',
    url: 'https://huggingface.co/Qwen/Qwen3-ASR-0.6B',
    commercialUse: true,
    get summary() {
      return M.qwen3AsrLicense().text;
    },
  },
  diarization: SPEAKER_DIARIZATION_BUNDLE,
};

const QWEN3_ASR_1_7B: BundleDefinition = {
  bundleId: 'qwen3-asr-1.7b@mlx-8bit',
  capability: 'transcribe',
  backend: 'mlx',
  device: 'metal',
  label: 'Qwen3-ASR 1.7B',
  components: {
    asr: {
      family: 'qwen3-asr',
      repo: 'aufklarer/Qwen3-ASR-1.7B-MLX-8bit',
      revision: 'e5450a26d1fd417c45fc9c405651ddc3180a27a6',
      weightBits: 8,
      parameters: 2_038_052_480,
    },
    vad: SILERO_VAD,
    aligner: QWEN3_FORCED_ALIGNER,
  },
  license: QWEN3_ASR_LICENSE,
  diarization: SPEAKER_DIARIZATION_BUNDLE,
};

// 自己切段、自带说话人（没有 VAD）；装了说话人模型时用它合并跨块的说话人，装了对齐器时长行的词时间对齐出来。
const MOSS_TRANSCRIBE_DIARIZE: BundleDefinition = {
  bundleId: 'moss-transcribe-diarize@mlx-8bit',
  capability: 'transcribe',
  backend: 'mlx',
  device: 'metal',
  label: 'MOSS Transcribe',
  components: {
    asr: {
      family: 'moss-transcribe-diarize',
      repo: 'OpenMOSS-Team/MOSS-Transcribe-Diarize',
      revision: 'e5118b411bf5a77d7a90c4941066bec93c967312',
      weightBits: 16,
      parameters: 908_513_280,
    },
    aligner: QWEN3_FORCED_ALIGNER,
    speaker: WESPEAKER,
  },
  license: {
    name: 'Apache-2.0',
    url: 'https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize',
    commercialUse: true,
    get summary() {
      return M.mossLicense().text;
    },
  },
};

/**
 * candle 后端的同一个模型包：仓库、组件、许可与名字都不变，只换后端（架构设计 §6.5）。登记的设备是 `cpu`；Worker 握手报告了
 * CUDA 时 Runtime 改用 Worker 报告的设备。用的「说话人区分」模型包同样换成 candle 的。
 */
function onCandle(def: BundleDefinition, bundleId: string): BundleDefinition {
  // 按属性描述符复制：名字是 getter 的（「说话人区分」）照样在读的时候按当前语言生成，展开运算会在这里就把它求值定死。
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(def)) as BundleDefinition;
  return Object.assign(copy, {
    bundleId,
    backend: 'candle' as const,
    device: 'cpu',
    ...(def.diarization ? { diarization: SPEAKER_DIARIZATION_CANDLE_BUNDLE } : {}),
  });
}

const HTDEMUCS_FT: BundleDefinition = {
  bundleId: 'htdemucs-ft@mlx',
  capability: 'separate',
  backend: 'mlx',
  device: 'metal',
  components: {
    separator: { family: 'htdemucs-ft', repo: 'aufklarer/HTDemucs-FT-MLX', revision: '39820e356306479d81dacb9f1042e5de86d49e29' },
  },
  label: 'HTDemucs-FT',
  license: HTDEMUCS_FT_LICENSE,
};

export const BUNDLES: readonly BundleDefinition[] = [
  QWEN3_ASR_0_6B,
  QWEN3_ASR_1_7B,
  {
    bundleId: 'whisper-large-v3@coreml',
    capability: 'transcribe',
    backend: 'coreml',
    device: 'ane',
    label: WHISPER_LARGE_V3_LABEL,
    components: {
      asr: {
        family: 'whisper-coreml',
        repo: 'argmaxinc/whisperkit-coreml',
        revision: '97a5bf9bbc74c7d9c12c755d04dea59e672e3808',
        subdir: 'openai_whisper-large-v3_947MB',
      },
      vad: SILERO_VAD,
      tokenizer: WHISPER_TOKENIZER,
      aligner: QWEN3_FORCED_ALIGNER,
    },
    license: WHISPER_LARGE_V3_LICENSE,
    diarization: SPEAKER_DIARIZATION_BUNDLE,
  },
  {
    bundleId: 'whisper-large-v3-turbo@coreml',
    capability: 'transcribe',
    backend: 'coreml',
    device: 'ane',
    label: WHISPER_TURBO_LABEL,
    components: {
      asr: {
        family: 'whisper-coreml',
        repo: 'aufklarer/Whisper-Large-v3-Turbo-CoreML',
        revision: 'a8e93b2084b3d0a09765b2e3a5602a3d2b8f8d25',
      },
      vad: SILERO_VAD,
      tokenizer: WHISPER_TOKENIZER,
      aligner: QWEN3_FORCED_ALIGNER,
    },
    license: WHISPER_TURBO_LICENSE,
    diarization: SPEAKER_DIARIZATION_BUNDLE,
  },
  // MLX 的 Whisper（mlx-community 的 fp16 转换）：解码配置与分词器同在 openai/whisper-large-v3 的分词器组件里。
  {
    bundleId: 'whisper-large-v3@mlx',
    capability: 'transcribe',
    backend: 'mlx',
    device: 'metal',
    label: WHISPER_LARGE_V3_LABEL,
    components: {
      asr: { family: 'whisper-mlx', repo: 'mlx-community/whisper-large-v3-fp16', revision: '5467ef1f82cf0e110f521092acb434d9c82b5d5a' },
      vad: SILERO_VAD,
      tokenizer: WHISPER_TOKENIZER,
      aligner: QWEN3_FORCED_ALIGNER,
    },
    license: WHISPER_LARGE_V3_MLX_LICENSE,
    diarization: SPEAKER_DIARIZATION_BUNDLE,
  },
  {
    bundleId: 'whisper-large-v3-turbo@mlx',
    capability: 'transcribe',
    backend: 'mlx',
    device: 'metal',
    label: WHISPER_TURBO_LABEL,
    components: {
      asr: {
        family: 'whisper-mlx',
        repo: 'mlx-community/whisper-large-v3-turbo-fp16',
        revision: '258e98b1f53da60a0a51c1e45e480ffa3ec71e23',
      },
      vad: SILERO_VAD,
      tokenizer: WHISPER_TOKENIZER,
      aligner: QWEN3_FORCED_ALIGNER,
    },
    license: WHISPER_TURBO_MLX_LICENSE,
    diarization: SPEAKER_DIARIZATION_BUNDLE,
  },
  MOSS_TRANSCRIBE_DIARIZE,
  onCandle(QWEN3_ASR_0_6B, DEFAULT_CANDLE_TRANSCRIBE_BUNDLE),
  onCandle(QWEN3_ASR_1_7B, 'qwen3-asr-1.7b@candle'),
  onCandle(MOSS_TRANSCRIBE_DIARIZE, 'moss-transcribe-diarize@candle'),
  SPEAKER_DIARIZATION,
  onCandle(SPEAKER_DIARIZATION, SPEAKER_DIARIZATION_CANDLE_BUNDLE),
  // whisper.cpp 的 Whisper：登记的设备是 `cpu`；Worker 握手报告了 GPU 时 Runtime 改用它（`cuda` 或 `vulkan`，与 candle 同一做法）。
  {
    bundleId: 'whisper-large-v3@ggml',
    capability: 'transcribe',
    backend: 'ggml',
    device: 'cpu',
    label: WHISPER_LARGE_V3_LABEL,
    components: {
      asr: { family: 'whisper-ggml', repo: 'ggerganov/whisper.cpp-large-v3', revision: WHISPER_GGML_REVISION },
      vad: SILERO_VAD,
      aligner: QWEN3_FORCED_ALIGNER,
    },
    license: WHISPER_LARGE_V3_GGML_LICENSE,
    diarization: SPEAKER_DIARIZATION_CANDLE_BUNDLE,
  },
  {
    bundleId: 'whisper-large-v3-turbo@ggml',
    capability: 'transcribe',
    backend: 'ggml',
    device: 'cpu',
    label: WHISPER_TURBO_LABEL,
    components: {
      asr: { family: 'whisper-ggml', repo: 'ggerganov/whisper.cpp', revision: WHISPER_GGML_REVISION },
      vad: SILERO_VAD,
      aligner: QWEN3_FORCED_ALIGNER,
    },
    license: WHISPER_TURBO_GGML_LICENSE,
    diarization: SPEAKER_DIARIZATION_CANDLE_BUNDLE,
  },
  ...SPEECH_BUNDLES,
  ...IMAGE_BUNDLES,
  HTDEMUCS_FT,
  onCandle(HTDEMUCS_FT, 'htdemucs-ft@candle'),
];

/** backend 能不能在这台机器上用：`mlx` 与 `coreml` 只有 Apple Silicon 的 macOS；`candle` 与 `ggml` 全平台（CPU）。 */
export function backendSupported(backend: ModelBackend, platform: NodeJS.Platform, arch: string): boolean {
  if (backend === 'mlx' || backend === 'coreml') return platform === 'darwin' && arch === 'arm64';
  return true;
}

function appleSilicon(platform: NodeJS.Platform, arch: string): boolean {
  return platform === 'darwin' && arch === 'arm64';
}

/**
 * 登记了、能加载，但不列出的模型包：同一个模型在一个平台上只列一种（架构设计 §6.5）。Whisper 在 Apple Silicon 上列 Core ML 的；
 * MLX 的（`whisper-mlx`）识别整段长音频与 Core ML 一样快，但按 VAD 切成短段时每段都要跑满 30 秒的编码器，转写流水线慢约 1.3 倍，
 * 换不换由 §14 的待评审事项决定。
 */
const UNLISTED_BUNDLES: ReadonlySet<string> = new Set(['whisper-large-v3@mlx', 'whisper-large-v3-turbo@mlx']);

/**
 * 这台机器上列出的模型包（架构设计 §6.5）：Apple Silicon 只列 MLX 与 Core ML 的（同样的模型在 candle、GGML 上更慢，不给人选）；
 * 别的平台只列 candle 与 GGML 的（MLX、Core ML 用不了）。[`UNLISTED_BUNDLES`] 在哪里都不列。
 */
export function platformBundles(
  platform: NodeJS.Platform,
  arch: string,
  bundles: readonly BundleDefinition[] = BUNDLES,
): BundleDefinition[] {
  return bundles.filter(
    (b) =>
      !UNLISTED_BUNDLES.has(b.bundleId) &&
      (appleSilicon(platform, arch) ? b.backend !== 'candle' && b.backend !== 'ggml' : backendSupported(b.backend, platform, arch)),
  );
}

/** 这台机器上的默认转写模型包：Apple Silicon 用 MLX 的，别的平台用 candle 的。 */
export function defaultTranscribeBundle(platform: NodeJS.Platform, arch: string): string {
  return appleSilicon(platform, arch) ? DEFAULT_TRANSCRIBE_BUNDLE : DEFAULT_CANDLE_TRANSCRIBE_BUNDLE;
}

/**
 * candle 模型包的 Model Worker 加载后约常驻多少（字节，架构设计 §6.5）。candle 把权重都换成计算精度：CPU 上是 f32，CUDA 上是
 * 半精度。每个组件按参数个数 × 4（CPU）或 × 2（CUDA）；没有 `parameters` 时按存储字节 × 计算位宽 / `weightBits`（全量化时
 * 4 位约 8 倍、8 位约 4 倍，有不量化的部分时偏大）；两样都没有时按存储字节。
 */
export function candleResidentBytes(
  device: string,
  components: ReadonlyArray<{ bytes: number; weightBits?: number; parameters?: number }>,
): number {
  const computeBits = device === 'cuda' ? 16 : 32;
  const resident = (c: { bytes: number; weightBits?: number; parameters?: number }) =>
    c.parameters ? (c.parameters * computeBits) / 8 : c.weightBits ? (c.bytes * computeBits) / c.weightBits : c.bytes;
  return Math.round(components.reduce((sum, c) => sum + resident(c), 0));
}

/** 模型包的必需组件（不含 `optional` 的）：它们都装好，模型包就算装好。 */
export function requiredSources(def: Pick<BundleDefinition, 'components'>): BundleComponentSource[] {
  return Object.values(def.components).filter((s): s is BundleComponentSource => s !== undefined && !s.optional);
}
