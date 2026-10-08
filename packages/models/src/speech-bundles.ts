import type { ModelLicense, SpeechVoiceDescription } from '@baocut/protocol';
import { ModelsSpeechBundles as M } from '@baocut/protocol/messages/models/speech-bundles.ts';
import type { BundleComponentSource, BundleDefinition, SpeechBundleProfile } from './bundle-registry.ts';

/**
 * 本地语音合成的模型包（架构设计 §6.3）。`bundleId` 是 `<模型>@<backend>-<量化>`，模型名与原型的合成模型表一致。
 * 仓库、版本与文件清单（`repo-manifests.ts`）取自旧版 BaoCut 为同一版本固定的清单。
 *
 * 组件：`tts` 是主模型；`codec` 是 Qwen3-TTS 共用的语音编解码器（一份，按引用保留）；`aux` 是 IndexTTS 2.5 用到的
 * IndexTTS2 辅助权重（w2v-BERT、CAM++、BigVGAN 与统计量），直接共用整个 IndexTTS2 仓库：与 `indextts2@mlx-fp16`
 * 同一仓库与版本，装一份、按引用保留（代价是只装 2.5 时多下 IndexTTS2 的主权重，见架构设计 §14）。
 *
 * 引擎在 Model Worker 里逐个接入；Worker 在 `worker.hello` 的 `synthesizeFamilies` 里声明接上了的模型族，Runtime 在加载前
 * 按它拒绝没接上的，不停用模型包（Model Worker 协议规范 §2.1）。
 *
 * 每个 MLX 模型包都有一个 candle 变体（`<模型>@candle`，架构设计 §6.5）：同一仓库与版本，加载时把量化权重反量化、把权重换成
 * 计算精度（CPU 上 f32，CUDA 上保持半精度），只在 Apple Silicon 以外的平台列出。组件上的 `weightBits` / `parameters` 只给
 * candle 估计常驻量用（`candleResidentBytes`）；参数个数按 safetensors 头数出（量化张量按位宽展开，不计 `scales` / `biases`）。
 */

const QWEN3_TTS_CODEC: BundleComponentSource = {
  family: 'qwen3-tts-tokenizer',
  repo: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
  revision: '7dd38ad4e9bad454aae9cd937d0cd577604fe229',
  weightBits: 32,
  parameters: 170_557_441,
};

const INDEX_TTS2_REPO = { repo: 'aufklarer/IndexTTS2-MLX-fp16', revision: '208b3d6ea53a119f3501b3bfd8e666b9b5e8c705' };

/** 主模型组件的存储位宽与参数个数（candle 估计常驻量用）。 */
type WeightSize = Required<Pick<BundleComponentSource, 'weightBits' | 'parameters'>>;

const QWEN3_TTS_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru'];
/** Qwen3-TTS CustomVoice 的九个说话人（0.6B 与 1.7B 同一张表）；名字是权重里的标识，不翻译。 */
export const QWEN3_TTS_SPEAKERS = ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'];

/** 克隆的参考录音建议 3–15 秒（五个能克隆的引擎共用）。 */
const REFERENCE_SECONDS: [number, number] = [3, 15];

/** OmniVoice 按描述造声的封闭词表：每类至多一项；同一类各语言的词条按下标对应。 */
// i18n-ignore-start: 交给模型的声音描述词表（各语言的词条原样传给 OmniVoice）
export const OMNIVOICE_VOCABULARY: SpeechVoiceDescription = {
  kind: 'vocabulary',
  categories: [
    { category: 'gender', terms: { en: ['male', 'female'], zh: ['男', '女'] } },
    {
      category: 'age',
      terms: { en: ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'], zh: ['儿童', '少年', '青年', '中年', '老年'] },
    },
    {
      category: 'pitch',
      terms: {
        en: ['very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'],
        zh: ['极低音调', '低音调', '中音调', '高音调', '极高音调'],
      },
    },
    { category: 'style', terms: { en: ['whisper'], zh: ['耳语'] } },
    {
      category: 'accent',
      terms: {
        en: [
          'american accent',
          'british accent',
          'australian accent',
          'chinese accent',
          'canadian accent',
          'indian accent',
          'korean accent',
          'portuguese accent',
          'russian accent',
          'japanese accent',
        ],
      },
    },
    {
      category: 'dialect',
      terms: {
        zh: ['河南话', '陕西话', '四川话', '贵州话', '云南话', '桂林话', '济南话', '石家庄话', '甘肃话', '宁夏话', '青岛话', '东北话'],
      },
    },
  ],
};
// i18n-ignore-end

const QWEN3_TTS_LICENSE: ModelLicense = {
  name: 'Apache-2.0',
  url: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base',
  commercialUse: true,
  // 许可摘要给人看：用 getter，读的时候（列出状态、序列化过线）按当前语言生成。
  get summary() {
    return M.qwen3TtsLicense().text;
  },
};
const INDEX_TTS2_LICENSE: ModelLicense = {
  name: 'bilibili Model Use License Agreement',
  url: 'https://huggingface.co/IndexTeam/IndexTTS-2/blob/main/LICENSE.txt',
  commercialUse: true,
  get summary() {
    return M.indexTts2License().text;
  },
};
const INDEX_TTS25_LICENSE: ModelLicense = {
  name: 'bilibili Model Use License Agreement',
  url: 'https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE',
  commercialUse: true,
  get summary() {
    return M.indexTts25License().text;
  },
};

const MLX = { backend: 'mlx', device: 'metal', capability: 'synthesize' } as const;

function qwen3(
  bundleId: string,
  label: string,
  repo: string,
  revision: string,
  size: WeightSize,
  variant: 'base' | 'customvoice' | 'voicedesign',
  slow: boolean,
  license: ModelLicense = QWEN3_TTS_LICENSE,
): BundleDefinition {
  const common = {
    family: 'qwen3-tts',
    languages: QWEN3_TTS_LANGUAGES,
    emotion: false,
    knobs: {},
    maxDurationSec: null,
    acceptsSeed: true,
    readings: 'homophone',
    sampleRate: 24_000,
    slow,
  } as const;
  const speech: SpeechBundleProfile =
    variant === 'customvoice'
      ? {
          ...common,
          voiceModes: ['preset'],
          presets: 'model',
          speakers: QWEN3_TTS_SPEAKERS,
          reference: null,
          voiceDescription: null,
          instructions: 'style',
        }
      : variant === 'voicedesign'
        ? {
            ...common,
            voiceModes: ['preset', 'describe'],
            presets: 'builtin-description',
            reference: null,
            voiceDescription: { kind: 'free' },
            instructions: null,
          }
        : {
            ...common,
            voiceModes: ['preset', 'clone'],
            presets: 'builtin-reference',
            reference: { recommendedSeconds: REFERENCE_SECONDS, withTranscriptSeconds: null, acceptsTranscript: true },
            voiceDescription: null,
            instructions: null,
          };
  return {
    bundleId,
    label,
    ...MLX,
    components: { tts: { family: 'qwen3-tts', repo, revision, ...size }, codec: QWEN3_TTS_CODEC },
    license,
    speech,
  };
}

const MLX_SPEECH_BUNDLES: readonly BundleDefinition[] = [
  qwen3(
    'qwen3-tts-0.6b-base@mlx-8bit',
    'Qwen3-TTS 0.6B Base',
    'aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit',
    '2a20f4adf0436810367cea5a51aa7eb1bc50b6d8',
    { weightBits: 8, parameters: 914_643_008 },
    'base',
    false,
  ),
  qwen3(
    'qwen3-tts-0.6b-customvoice@mlx-bf16',
    'Qwen3-TTS 0.6B CustomVoice',
    'aufklarer/Qwen3-TTS-12Hz-0.6B-CustomVoice-MLX-bf16',
    '3affbf656d9d6aa9255ec0b31cc90055605170bc',
    { weightBits: 16, parameters: 905_788_672 },
    'customvoice',
    false,
  ),
  qwen3(
    'qwen3-tts-1.7b-base@mlx-8bit',
    'Qwen3-TTS 1.7B Base',
    'aufklarer/Qwen3-TTS-12Hz-1.7B-Base-MLX-8bit',
    '87d008f1e1a20d265bee01c7ccb0a78f5b8d1132',
    { weightBits: 8, parameters: 1_928_677_440 },
    'base',
    true,
  ),
  qwen3(
    'qwen3-tts-1.7b-customvoice@mlx-8bit',
    'Qwen3-TTS 1.7B CustomVoice',
    'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit',
    '41d3337e8b7f2843a75841595fc14e4b9a7a4b96',
    { weightBits: 8, parameters: 1_916_676_352 },
    'customvoice',
    true,
  ),
  qwen3(
    'qwen3-tts-1.7b-voicedesign@mlx-8bit',
    'Qwen3-TTS 1.7B VoiceDesign',
    'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit',
    'f90d617701d9f7f4ca499291e0b57f2b3c2fd2ee',
    { weightBits: 8, parameters: 1_916_676_352 },
    'voicedesign',
    true,
    { ...QWEN3_TTS_LICENSE, url: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign' },
  ),
  {
    bundleId: 'indextts2@mlx-fp16',
    label: 'IndexTTS2',
    ...MLX,
    // 整个仓库（含 `aux/`）都按这个模型包计。
    components: { tts: { family: 'indextts2', ...INDEX_TTS2_REPO, weightBits: 16, parameters: 1_915_602_132 } },
    license: INDEX_TTS2_LICENSE,
    speech: {
      family: 'indextts2',
      languages: 'any',
      voiceModes: ['preset', 'clone'],
      presets: 'builtin-reference',
      // IndexTTS 只从参考录音取音色，不读原文。
      reference: { recommendedSeconds: REFERENCE_SECONDS, withTranscriptSeconds: null, acceptsTranscript: false },
      voiceDescription: null,
      instructions: null,
      emotion: true,
      knobs: {},
      maxDurationSec: null,
      acceptsSeed: true,
      readings: 'inline-pinyin',
      sampleRate: 22_050,
      slow: false,
    },
  },
  {
    bundleId: 'index-tts2.5@mlx-fp16',
    label: 'IndexTTS 2.5',
    ...MLX,
    components: {
      tts: {
        family: 'indextts2.5',
        repo: 'mlx-community/IndexTTS-2.5-fp16',
        revision: '65644cd70da15309ffeb74aa03f3686bb04e3eb1',
        weightBits: 16,
        parameters: 966_515_596,
      },
      // 只读 `aux/` 下的 w2v-BERT、CAM++、BigVGAN 与统计量，参数个数只数这些。
      aux: { family: 'indextts2-aux', ...INDEX_TTS2_REPO, weightBits: 16, parameters: 699_767_331 },
    },
    license: INDEX_TTS25_LICENSE,
    speech: {
      family: 'indextts2',
      languages: ['zh', 'en', 'ja', 'es', 'ar'],
      voiceModes: ['preset', 'clone'],
      presets: 'builtin-reference',
      reference: { recommendedSeconds: REFERENCE_SECONDS, withTranscriptSeconds: null, acceptsTranscript: false },
      voiceDescription: null,
      instructions: null,
      emotion: true,
      // 语速按倍率缩放目标语义 token 数。
      knobs: { speed: { min: 0.5, max: 1.5, step: 0.05, default: 1 } },
      maxDurationSec: null,
      acceptsSeed: true,
      readings: 'annotated',
      sampleRate: 22_050,
      slow: false,
    },
  },
  {
    bundleId: 'gpt-sovits-v2@mlx-fp16',
    label: 'GPT-SoVITS v2',
    ...MLX,
    components: {
      tts: {
        family: 'gpt-sovits',
        repo: 'PJMixers-Dev/lj1995_GPT-SoVITS-safetensors',
        revision: 'cea8b8279588e63c2fdc10e02610c11f02af5450',
        weightBits: 16,
        parameters: 550_408_203,
      },
    },
    license: {
      name: 'MIT',
      url: 'https://huggingface.co/lj1995/GPT-SoVITS',
      commercialUse: true,
      get summary() {
        return M.gptSovitsLicense().text;
      },
    },
    speech: {
      family: 'gpt-sovits',
      languages: ['zh', 'en'],
      voiceModes: ['preset', 'clone'],
      presets: 'builtin-reference',
      // 给了原文时参考录音要 3–10 秒。
      reference: { recommendedSeconds: REFERENCE_SECONDS, withTranscriptSeconds: [3, 10], acceptsTranscript: true },
      voiceDescription: null,
      instructions: null,
      emotion: false,
      knobs: {},
      maxDurationSec: null,
      acceptsSeed: true,
      readings: 'unsupported',
      sampleRate: 32_000,
      slow: false,
    },
  },
  {
    bundleId: 'voxcpm2@mlx-int8',
    label: 'VoxCPM2',
    ...MLX,
    components: {
      tts: {
        family: 'voxcpm2',
        repo: 'aufklarer/VoxCPM2-MLX-int8',
        revision: '471a37b830ccf5e23fdb4c822649ec7c3b7320b4',
        weightBits: 8,
        parameters: 2_383_791_364,
      },
    },
    license: {
      name: 'Apache-2.0',
      url: 'https://huggingface.co/openbmb/VoxCPM2',
      commercialUse: true,
      get summary() {
        return M.voxcpm2License().text;
      },
    },
    speech: {
      family: 'voxcpm2',
      languages: 'any',
      voiceModes: ['preset', 'clone'],
      presets: 'builtin-reference',
      reference: { recommendedSeconds: REFERENCE_SECONDS, withTranscriptSeconds: null, acceptsTranscript: true },
      voiceDescription: null,
      // 风格说明接在正文前；给了它就不走续写式的高保真克隆。
      instructions: 'style',
      emotion: false,
      knobs: { cfg: { min: 1, max: 3, step: 0.1, default: 2 }, steps: { min: 1, max: 50, step: 1, default: 10 } },
      maxDurationSec: null,
      acceptsSeed: true,
      readings: 'unsupported',
      sampleRate: 48_000,
      slow: false,
    },
  },
  {
    bundleId: 'omnivoice@mlx-int8',
    label: 'OmniVoice',
    ...MLX,
    components: {
      tts: {
        family: 'omnivoice',
        repo: 'aufklarer/OmniVoice-MLX-int8',
        revision: 'e815dfafaf9c90f995ddc9fcfe52fd0d80babe4e',
        weightBits: 8,
        parameters: 813_977_833,
      },
    },
    license: {
      name: 'CC-BY-NC-4.0',
      url: 'https://huggingface.co/k2-fsa/OmniVoice',
      commercialUse: false,
      get summary() {
        return M.omnivoiceLicense().text;
      },
    },
    speech: {
      family: 'omnivoice',
      languages: 'any',
      voiceModes: ['preset', 'clone', 'describe'],
      presets: 'builtin-reference',
      reference: { recommendedSeconds: REFERENCE_SECONDS, withTranscriptSeconds: null, acceptsTranscript: true },
      voiceDescription: OMNIVOICE_VOCABULARY,
      instructions: null,
      emotion: false,
      knobs: {
        speed: { min: 0.5, max: 1.5, step: 0.05, default: 1 },
        cfg: { min: 0, max: 4, step: 0.1, default: 2 },
        steps: { min: 4, max: 64, step: 1, default: 32 },
      },
      maxDurationSec: 60,
      acceptsSeed: true,
      readings: 'unsupported',
      sampleRate: 24_000,
      slow: false,
    },
  },
];

/** MLX 模型包的 candle 变体：同一仓库与特性，ID 是 `<模型>@candle`，登记的设备是 `cpu`（Worker 报告 CUDA 时 Runtime 改用 `cuda`）。 */
function onCandle(def: BundleDefinition): BundleDefinition {
  return { ...def, bundleId: `${def.bundleId.split('@')[0]}@candle`, backend: 'candle', device: 'cpu' };
}

export const SPEECH_BUNDLES: readonly BundleDefinition[] = [...MLX_SPEECH_BUNDLES, ...MLX_SPEECH_BUNDLES.map(onCandle)];
