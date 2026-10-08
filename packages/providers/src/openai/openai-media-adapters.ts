// OpenAI 语音合成与图片生成的模型（架构设计 §6.4）。2026-10-03 读过的文档：
//   https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
//   https://developers.openai.com/api/docs/guides/text-to-speech
//   https://developers.openai.com/api/reference/resources/images/methods/generate
//   https://developers.openai.com/api/docs/guides/image-generation
// 文档确认的：语音模型 tts-1、tts-1-hd、gpt-4o-mini-tts；13 个内置音色，tts-1 / tts-1-hd 只有其中 9 个；指南推荐 marin、cedar；
// 文本 ≤ 4096 字符；语言大体同 Whisper（指南列出的语言）；mp3 是默认格式；`speed` 0.25–4.0；`instructions` 不用于 tts-1 系列；
// 没有 `seed`。图片模型 gpt-image-1、gpt-image-1-mini、gpt-image-1.5、gpt-image-2（dall-e-2/3 已于 2026-05-12 退役）；
// 尺寸 1024x1024、1536x1024、1024x1536 与 `auto`（不给 `size`）；gpt-image-2 接受任意 WIDTHxHEIGHT（边长是 16 的倍数、
// 宽高比 1:3–3:1、最大 3840x2160，超过 2560x1440 为实验性）；`n` 1–10；提示词 ≤ 32000 字符；没有 `seed`；
// 参考图走 `/images/edits`（这一版不用）。
// 没能确认的：自定义音色（`{ id }`）只按 gpt-4o-mini-tts 声明；opus、aac 的容器（不提供）；参考图的张数上限（按 16 声明）；
// gpt-image-2 的非标准尺寸只列出几个 16:9 的常用值，不开放任意尺寸。
import type { ImageAspectRatio, ImageModelInfo, SpeechModelInfo, SpeechVoice } from '@baocut/protocol';
import type { AdapterConfig, ImageAdapter, ImageOutput, ImageRequest, SpeechAdapter, SpeechOutput, SpeechRequest } from '../adapter.ts';
import { openAiGenerateImages, openAiSynthesize } from './openai-generation.ts';
import { WHISPER_LANGUAGES } from './openai-transcription.ts';

const LABEL = 'OpenAI';

const ALL_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const TTS1_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];

function voices(ids: string[]): SpeechVoice[] {
  return ids.map((voiceId) => ({ voiceId, label: voiceId[0]!.toUpperCase() + voiceId.slice(1) }));
}

const SPEECH_BASE = {
  languages: WHISPER_LANGUAGES,
  maxInputChars: 4096,
  formats: ['mp3', 'wav', 'flac'],
  defaultFormat: 'mp3',
  speedRange: { min: 0.25, max: 4 },
  acceptsSeed: false,
  cost: 'unknown',
} satisfies Partial<SpeechModelInfo>;

const SPEECH_MODELS: SpeechModelInfo[] = [
  {
    ...SPEECH_BASE,
    modelId: 'gpt-4o-mini-tts',
    label: 'GPT-4o mini TTS',
    default: true,
    voices: voices(ALL_VOICES),
    defaultVoice: 'marin',
    voiceModes: ['preset', 'custom'],
    acceptsInstructions: true,
  },
  {
    ...SPEECH_BASE,
    modelId: 'tts-1-hd',
    label: 'TTS-1 HD',
    voices: voices(TTS1_VOICES),
    defaultVoice: 'alloy',
    voiceModes: ['preset'],
    acceptsInstructions: false,
  },
  {
    ...SPEECH_BASE,
    modelId: 'tts-1',
    label: 'TTS-1',
    voices: voices(TTS1_VOICES),
    defaultVoice: 'alloy',
    voiceModes: ['preset'],
    acceptsInstructions: false,
  },
];

const STANDARD_RATIOS: ImageAspectRatio[] = [
  { ratio: '1:1', size: '1024x1024' },
  { ratio: '3:2', size: '1536x1024' },
  { ratio: '2:3', size: '1024x1536' },
];
const WIDE_RATIOS: ImageAspectRatio[] = [...STANDARD_RATIOS, { ratio: '16:9', size: '1536x864' }, { ratio: '9:16', size: '864x1536' }];

const IMAGE_BASE = {
  defaultSize: null,
  maxCount: 10,
  maxPromptChars: 32_000,
  formats: ['png', 'jpeg', 'webp'],
  defaultFormat: 'png',
  referenceImages: { max: 16 },
  acceptsSeed: false,
  cost: 'unknown',
} satisfies Partial<ImageModelInfo>;

const STANDARD_SIZES = STANDARD_RATIOS.map((r) => r.size);

const IMAGE_MODELS: ImageModelInfo[] = [
  {
    ...IMAGE_BASE,
    modelId: 'gpt-image-2',
    label: 'GPT Image 2',
    default: true,
    sizes: [...WIDE_RATIOS.map((r) => r.size), '2560x1440', '1440x2560'],
    aspectRatios: WIDE_RATIOS,
  },
  { ...IMAGE_BASE, modelId: 'gpt-image-1.5', label: 'GPT Image 1.5', sizes: STANDARD_SIZES, aspectRatios: STANDARD_RATIOS },
  { ...IMAGE_BASE, modelId: 'gpt-image-1', label: 'GPT Image 1', sizes: STANDARD_SIZES, aspectRatios: STANDARD_RATIOS },
  { ...IMAGE_BASE, modelId: 'gpt-image-1-mini', label: 'GPT Image 1 mini', sizes: STANDARD_SIZES, aspectRatios: STANDARD_RATIOS },
];

export class OpenAiSpeechAdapter implements SpeechAdapter {
  readonly version = 'baocut-providers/openai-speech@1';

  models(_config: AdapterConfig): SpeechModelInfo[] {
    return structuredClone(SPEECH_MODELS);
  }

  synthesize(request: SpeechRequest): Promise<SpeechOutput> {
    return openAiSynthesize(request, { label: LABEL, compatible: false });
  }
}

export class OpenAiImageAdapter implements ImageAdapter {
  readonly version = 'baocut-providers/openai-image@1';

  models(_config: AdapterConfig): ImageModelInfo[] {
    return structuredClone(IMAGE_MODELS);
  }

  generate(request: ImageRequest): Promise<ImageOutput> {
    return openAiGenerateImages(request, { label: LABEL, compatible: false });
  }
}
