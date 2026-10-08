import {
  RpcError,
  type FrozenSpeechReference,
  type GenerateImageRequest,
  type GenerationParameters,
  type ImageModelInfo,
  type SpeechModelInfo,
  type SynthesizeSpeechRequest,
} from '@baocut/protocol';
import { ModelsGenerationOptions as M } from '@baocut/protocol/messages/models/generation-options.ts';
import { canonicalLanguageTag } from './asr-result.ts';
import { builtinReferenceFile, frozenVoiceOf, planLocalVoice, type LocalVoicePlan } from './local-speech.ts';
import type { ModelChoice } from './model-selection.ts';

/**
 * 本地模型提交时已经决定的声音与读出的参考录音（`clone`、克隆模型的内置音色）。不给时按请求现算声音，
 * 需要参考录音而没有给出时是调用方的错。
 */
export interface LocalSpeechFreeze {
  plan: LocalVoicePlan;
  reference: FrozenSpeechReference | null;
}

/**
 * 生成请求与模型的特性是否相容，相容时给出冻结的参数（架构设计 §6.2、§6.6）。都在提交时检查，不在执行到一半时失败；
 * 不合的一律 `invalid-request`，`details` 带上模型的限制，不悄悄改参数（不截断文本、不换声音、不改尺寸）。
 */

export type SpeechParameters = Extract<GenerationParameters, { capability: 'synthesizeSpeech' }>;
export type ImageParameters = Extract<GenerationParameters, { capability: 'generateImage' }>;

/** 按 Unicode 码点计的长度（供应商的字符上限按字符算，代理对算一个）。 */
export function codePointLength(text: string): number {
  let length = 0;
  for (const _ of text) length++;
  return length;
}

export function speechParameters(
  choice: ModelChoice<'synthesizeSpeech'>,
  request: SynthesizeSpeechRequest,
  local?: LocalSpeechFreeze,
): SpeechParameters {
  const model: SpeechModelInfo = choice.model;
  const where = { providerId: choice.providerId, modelId: choice.modelId };
  if (!model.local) {
    // 参考录音、描述与扩散旋钮只有本地模型接受。
    for (const [key, value] of [
      ['reference', request.reference],
      ['voiceDescription', request.voiceDescription],
      ['cfg', request.cfg],
      ['steps', request.steps],
    ] as const) {
      if (value !== undefined) throw new RpcError('invalid-request', M.notLocalOnly({ modelId: choice.modelId, key }), where);
    }
  }
  const text = request.text;
  if (!text.trim()) throw new RpcError('invalid-request', M.textEmpty());
  const length = codePointLength(text);
  if (length > model.maxInputChars) {
    throw new RpcError(
      'invalid-request',
      M.textTooLong({ length, modelId: choice.modelId, limit: model.maxInputChars }),
      {
        ...where,
        length,
        limit: model.maxInputChars,
      },
    );
  }

  if (model.local) return localSpeechParameters(choice, request, local ?? { plan: planLocalVoice(choice, request), reference: null });

  const voice = request.voice ?? model.defaultVoice;
  if (!voice) {
    throw new RpcError('invalid-request', M.noDefaultVoice({ modelId: choice.modelId }), {
      ...where,
      voices: model.voices.map((v) => v.voiceId),
    });
  }
  const preset = model.voices.some((v) => v.voiceId === voice);
  if (!preset && !model.voiceModes.includes('custom')) {
    throw new RpcError('invalid-request', M.noSuchVoice({ modelId: choice.modelId, voice }), {
      ...where,
      voices: model.voices.map((v) => v.voiceId),
    });
  }

  let language: string | null = null;
  if (request.language !== undefined) {
    language = canonicalLanguageTag(request.language);
    if (!language) throw new RpcError('invalid-request', M.badLanguageTag({ tag: request.language }));
    if (model.languages !== 'any' && !languageListed(model.languages, language)) {
      throw new RpcError('invalid-request', M.languageUnsupported({ modelId: choice.modelId, language }), {
        ...where,
        languages: model.languages,
      });
    }
  }

  const format = request.format ?? model.defaultFormat;
  if (!model.formats.includes(format)) {
    throw new RpcError('invalid-request', M.formatUnsupported({ modelId: choice.modelId, format }), { ...where, formats: model.formats });
  }

  const instructions = request.instructions?.trim() ? request.instructions.trim() : null;
  if (instructions && !model.acceptsInstructions) {
    throw new RpcError('invalid-request', M.noInstructions({ modelId: choice.modelId }), where);
  }

  let speed: number | null = null;
  if (request.speed !== undefined) {
    if (!model.speedRange) throw new RpcError('invalid-request', M.noSpeed({ modelId: choice.modelId }), where);
    if (!(request.speed >= model.speedRange.min && request.speed <= model.speedRange.max)) {
      throw new RpcError('invalid-request', M.speedRange({ min: model.speedRange.min, max: model.speedRange.max }), {
        ...where,
        speedRange: model.speedRange,
      });
    }
    speed = request.speed;
  }

  const seed = checkSeed(request.seed, model.acceptsSeed, choice.modelId, where);
  return { capability: 'synthesizeSpeech', text, voice, language, format, instructions, speed, seed };
}

/** 本地模型：声音按提交时决定的方式冻结；语言、格式、说明、语速、种子与扩散旋钮按模型描述检查。 */
function localSpeechParameters(
  choice: ModelChoice<'synthesizeSpeech'>,
  request: SynthesizeSpeechRequest,
  local: LocalSpeechFreeze,
): SpeechParameters {
  const model: SpeechModelInfo = choice.model;
  const traits = model.local!;
  const where = { providerId: choice.providerId, modelId: choice.modelId };
  const { plan } = local;
  const needsReference = plan.mode === 'clone' || builtinReferenceFile(model, plan) !== null;
  if (needsReference && !local.reference) throw new Error(`Reference recording for local synthesis was not frozen: ${choice.modelId}`);

  let language: string | null = null;
  if (request.language !== undefined) {
    language = canonicalLanguageTag(request.language);
    if (!language) throw new RpcError('invalid-request', M.badLanguageTag({ tag: request.language }));
    if (model.languages !== 'any' && !languageListed(model.languages, language)) {
      throw new RpcError('invalid-request', M.languageUnsupported({ modelId: choice.modelId, language }), {
        ...where,
        languages: model.languages,
      });
    }
  }
  const format = request.format ?? model.defaultFormat;
  if (!model.formats.includes(format)) {
    throw new RpcError('invalid-request', M.formatUnsupported({ modelId: choice.modelId, format }), { ...where, formats: model.formats });
  }
  const instructions = request.instructions?.trim() ? request.instructions.trim() : null;
  if (instructions && !model.acceptsInstructions) {
    throw new RpcError('invalid-request', M.noInstructions({ modelId: choice.modelId }), where);
  }
  const knob = (key: 'speed' | 'cfg' | 'steps', value: number | undefined): number | null => {
    if (value === undefined) return null;
    const range = traits.knobs[key];
    if (!range) throw new RpcError('invalid-request', M.knobUnsupported({ modelId: choice.modelId, key }), where);
    if (!(value >= range.min && value <= range.max)) {
      throw new RpcError('invalid-request', M.knobRange({ key, min: range.min, max: range.max }), { ...where, [key]: range });
    }
    return value;
  };
  const speed = knob('speed', request.speed);
  const cfg = knob('cfg', request.cfg);
  const steps = knob('steps', request.steps);
  const seed = checkSeed(request.seed, model.acceptsSeed, choice.modelId, where);

  const voiceDescription =
    plan.mode === 'describe'
      ? plan.description
      : plan.mode === 'preset' && plan.builtin && traits.builtinVoices === 'description'
        ? plan.builtin.description
        : undefined;
  return {
    capability: 'synthesizeSpeech',
    // 文本原样冻结：读音标注是文本的一部分，由引擎换成自己的写法。
    text: request.text,
    voice: frozenVoiceOf(plan),
    language,
    format,
    instructions,
    speed,
    seed,
    voiceMode: plan.mode,
    ...(needsReference ? { reference: local.reference! } : {}),
    ...(voiceDescription !== undefined ? { voiceDescription } : {}),
    ...(cfg !== null ? { cfg } : {}),
    ...(steps !== null ? { steps } : {}),
  };
}

export function imageParameters(choice: ModelChoice<'generateImage'>, request: GenerateImageRequest): ImageParameters {
  const model: ImageModelInfo = choice.model;
  const where = { providerId: choice.providerId, modelId: choice.modelId };
  const prompt = request.prompt;
  if (!prompt.trim()) throw new RpcError('invalid-request', M.promptEmpty());
  const length = codePointLength(prompt);
  if (length > model.maxPromptChars) {
    throw new RpcError('invalid-request', M.promptTooLong({ length, modelId: choice.modelId, limit: model.maxPromptChars }), {
      ...where,
      length,
      limit: model.maxPromptChars,
    });
  }

  let size = model.defaultSize;
  let aspectRatio: string | null = null;
  if (request.size !== undefined) {
    if (request.size.includes(':')) {
      const found = model.aspectRatios.find((r) => r.ratio === request.size);
      if (!found) {
        throw new RpcError('invalid-request', M.aspectUnsupported({ modelId: choice.modelId, ratio: request.size }), {
          ...where,
          aspectRatios: model.aspectRatios.map((r) => r.ratio),
        });
      }
      size = found.size;
      aspectRatio = found.ratio;
    } else {
      if (!model.sizes.includes(request.size)) {
        throw new RpcError('invalid-request', M.sizeUnsupported({ modelId: choice.modelId, size: request.size }), {
          ...where,
          sizes: model.sizes,
        });
      }
      size = request.size;
    }
  }

  const count = request.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > model.maxCount) {
    throw new RpcError('invalid-request', M.maxCount({ modelId: choice.modelId, max: model.maxCount }), {
      ...where,
      maxCount: model.maxCount,
    });
  }

  const format = request.format ?? model.defaultFormat;
  if (!model.formats.includes(format)) {
    throw new RpcError('invalid-request', M.formatUnsupported({ modelId: choice.modelId, format }), { ...where, formats: model.formats });
  }
  const seed = checkSeed(request.seed, model.acceptsSeed, choice.modelId, where);
  let steps: number | null = null;
  if (request.steps !== undefined) {
    // 去噪步数只有本地文生图接受，范围见模型描述的 `local.steps`。
    const range = model.local?.steps;
    if (!range) throw new RpcError('invalid-request', M.noSteps({ modelId: choice.modelId }), where);
    if (!(Number.isInteger(request.steps) && request.steps >= range.min && request.steps <= range.max)) {
      throw new RpcError('invalid-request', M.stepsRange({ min: range.min, max: range.max }), { ...where, steps: range });
    }
    steps = request.steps;
  }
  return { capability: 'generateImage', prompt, size, aspectRatio, count, format, seed, ...(steps !== null ? { steps } : {}) };
}

function checkSeed(seed: number | undefined, accepts: boolean, modelId: string, where: Record<string, string>): number | null {
  if (seed === undefined) return null;
  if (!accepts) throw new RpcError('invalid-request', M.noSeed({ modelId }), where);
  return seed;
}

function languageListed(languages: string[], tag: string): boolean {
  const lower = tag.toLowerCase();
  const primary = lower.split('-')[0]!;
  return languages.some((l) => l.toLowerCase() === lower || l.toLowerCase() === primary);
}
