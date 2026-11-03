// OpenAI 兼容端点的语音合成与图片生成（架构设计 §6.4）：用户声明 `capability` 为 `synthesizeSpeech` / `generateImage`
// 的模型，请求形状同 OpenAI（`POST {base}/audio/speech`、`POST {base}/images/generations`，见 openai-generation.ts）。
// 语音仍假定端点接受任意 `voice` 与声明的 `response_format`。图片只发模型、提示词、已选尺寸与多张时的 `n`，
// 不发顶层 `output_format` / `response_format`：兼容服务不一定支持（例如 Agnes Image 2.5 Flash 文档明确禁止顶层 response_format）。
//   https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash
// 图片响应接受 `data[].b64_json` 或 `data[].url`；格式与声明不符时在发布前以 `MODEL_OUTPUT_INVALID` 失败。
import type { DeclaredModel, ImageModelInfo, SpeechModelInfo } from '@baocut/protocol';
import type { AdapterConfig, ImageAdapter, ImageOutput, ImageRequest, SpeechAdapter, SpeechOutput, SpeechRequest } from '../adapter.ts';
import { openAiGenerateImages, openAiSynthesize } from '../openai/openai-generation.ts';
import { declaredOf } from './compatible-adapter.ts';

export class CompatibleSpeechAdapter implements SpeechAdapter {
  readonly version = 'baocut-providers/openai-compatible-speech@1';
  readonly #label: () => string;

  constructor(label: () => string) {
    this.#label = label;
  }

  models(config: AdapterConfig): SpeechModelInfo[] {
    return declaredOf(config, 'synthesizeSpeech').map((m, i) => declaredSpeechInfo(m, i === 0));
  }

  synthesize(request: SpeechRequest): Promise<SpeechOutput> {
    return openAiSynthesize(request, { label: this.#label(), compatible: true });
  }
}

export class CompatibleImageAdapter implements ImageAdapter {
  readonly version = 'baocut-providers/openai-compatible-image@2';
  readonly #label: () => string;

  constructor(label: () => string) {
    this.#label = label;
  }

  models(config: AdapterConfig): ImageModelInfo[] {
    return declaredOf(config, 'generateImage').map((m, i) => declaredImageInfo(m, i === 0));
  }

  generate(request: ImageRequest): Promise<ImageOutput> {
    return openAiGenerateImages(request, { label: this.#label(), compatible: true });
  }
}

/** 声明的语音模型补上保守的默认值：第一个音色是默认音色，也接受没有声明的音色 ID。 */
export function declaredSpeechInfo(model: DeclaredModel, isDefault: boolean): SpeechModelInfo {
  const voices = (model.voices ?? []).map((voiceId) => ({ voiceId, label: voiceId }));
  const formats = model.formats?.length ? [...model.formats] : (['mp3'] as const);
  return {
    modelId: model.modelId,
    label: model.label ?? model.modelId,
    ...(isDefault ? { default: true } : {}),
    declared: true,
    voices,
    defaultVoice: voices[0]?.voiceId ?? null,
    voiceModes: voices.length > 0 ? ['preset', 'custom'] : ['custom'],
    languages: 'any',
    maxInputChars: model.maxInputChars ?? 4096,
    formats: [...formats],
    defaultFormat: formats[0]!,
    acceptsInstructions: false,
    speedRange: null,
    acceptsSeed: false,
    cost: 'unknown',
  };
}

/** 声明的图片模型补上保守的默认值：第一个尺寸是默认尺寸（没有声明时 1024x1024），一次 1 张，`png`。 */
export function declaredImageInfo(model: DeclaredModel, isDefault: boolean): ImageModelInfo {
  const sizes = model.sizes?.length ? [...model.sizes] : ['1024x1024'];
  return {
    modelId: model.modelId,
    label: model.label ?? model.modelId,
    ...(isDefault ? { default: true } : {}),
    declared: true,
    sizes,
    aspectRatios: [],
    defaultSize: sizes[0]!,
    maxCount: model.maxCount ?? 1,
    maxPromptChars: model.maxPromptChars ?? 4000,
    formats: ['png'],
    defaultFormat: 'png',
    referenceImages: null,
    img2img: null,
    acceptsSeed: false,
    cost: 'unknown',
  };
}
