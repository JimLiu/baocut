import {
  live,
  RpcError,
  type FrozenSpeechReference,
  type Localized,
  type LocalSpeechTraits,
  type ModelBundleStatus,
  type SpeechModelInfo,
  type SpeechVoice,
  type SpeechVoiceDescription,
  type SynthesizeSpeechRequest,
} from '@baocut/protocol';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ModelsLocalSpeech as M } from '@baocut/protocol/messages/models/local-speech.ts';
import { parseLibraryVoice } from '@baocut/runtime-storage/library';
import type { BundleDefinition, SpeechBundleProfile } from './bundle-registry.ts';
import type { SpeechParameters } from './generation-options.ts';
import { appFileMissing } from './model-assets.ts';
import { sha256File } from './model-catalog.ts';
import type { ModelChoice } from './model-selection.ts';
import { BUILTIN_VOICES, builtinVoice, builtinVoiceFile, defaultBuiltinVoice, type BuiltinVoice } from './speech-voices.ts';
import { renderReadings, type DroppedReading } from './speech-readings.ts';

/**
 * 本地语音合成（架构设计 §6.1、§6.3）：把 `synthesize` 模型包描述成 `local` Provider 的 `synthesizeSpeech` 模型，
 * 在提交时决定声音方式（不换成别的声音），执行时换成内置 audio.cpp 服务的请求（`audioCppSpeechRequestOf`）。
 */

/**
 * 本地模型单次请求的文本上限（按码点计）。引擎内部按句切分，这个上限只挡住一次任务里过长的文本，超过时在提交时拒绝，
 * 不截断：长文由调用方分段提交。
 */
export const LOCAL_SPEECH_MAX_CHARS = 2000;

/**
 * `synthesize` 模型包的 `synthesizeSpeech` 模型描述。`backend` 是合成服务此刻会用的后端（`LocalSpeechProvider.backend`，不知道时
 * null）：`cpu` 时带耗时提示（`notes`）。
 */
export function localSpeechModelInfo(
  def: BundleDefinition,
  status: ModelBundleStatus,
  usable: boolean,
  backend: string | null = null,
): SpeechModelInfo {
  const profile = def.speech!;
  const builtin = profile.presets === 'builtin-reference' || profile.presets === 'builtin-description';
  const voices: SpeechVoice[] =
    profile.presets === 'model'
      ? (profile.speakers ?? []).map((id) => ({ voiceId: id, label: id, source: 'model' as const }))
      : builtin
        ? BUILTIN_VOICES.map((v) => ({ voiceId: v.id, label: v.id, source: 'builtin' as const, language: v.language }))
        : [];
  const local: LocalSpeechTraits = {
    family: profile.family,
    sampleRate: profile.sampleRate,
    slow: profile.slow,
    builtinVoices: profile.presets === 'builtin-reference' ? 'reference' : profile.presets === 'builtin-description' ? 'description' : null,
    reference: profile.reference,
    voiceDescription: profile.voiceDescription,
    instructions: profile.instructions,
    emotion: profile.emotion,
    knobs: profile.knobs,
    maxDurationSec: profile.maxDurationSec,
    readings: profile.readings,
    license: def.license!,
  };
  return {
    modelId: def.bundleId,
    label: def.label,
    voices,
    defaultVoice: voices[0]?.voiceId ?? null,
    voiceModes: [...profile.voiceModes],
    languages: profile.languages === 'any' ? 'any' : [...profile.languages],
    maxInputChars: LOCAL_SPEECH_MAX_CHARS,
    formats: ['wav'],
    defaultFormat: 'wav',
    acceptsInstructions: profile.instructions !== null,
    speedRange: profile.knobs.speed ? { min: profile.knobs.speed.min, max: profile.knobs.speed.max } : null,
    acceptsSeed: profile.acceptsSeed,
    cost: 'free-local',
    available: usable,
    local,
    ...(backend === 'cpu' ? { notes: cpuNote(def) } : {}),
    ...(!usable && status.detail ? { detail: status.detail, ...(status.detailRef ? { detailRef: status.detailRef } : {}) } : {}),
  };
}

/**
 * audio.cpp 在 CPU 上合成有多慢，按模型包。只写实测过的：2026-10-15 在 Apple M4（10 核、16 GB）上强制 `cpu` 后端、8 线程
 * （Runtime 在这台机器上的默认），OmniVoice Q8 合成 10.8 秒的中文用 94 秒、13.3 秒的英文用 123 秒，约为音频长度的 9 倍
 * （Metal 约 1.35 倍）。别的模型包没有在 CPU 上实测，走 `paceDefault`，只说没有实测，不按参数量推算（架构设计 §6.5、
 * Model Worker 协议规范 §4.4）。
 */
const CPU_PACE: Record<string, () => Localized> = {
  'omnivoice@audio-cpp-q8': M.paceOmnivoice,
};

/** 耗时的提示（与文生图同一个 `notes`）：合成服务的后端是 CPU 时照实说。 */
// `notes` 没有引用字段：按生成时的语言存文本。
function cpuNote(def: BundleDefinition): string {
  const pace = (CPU_PACE[def.bundleId] ?? M.paceDefault)();
  return M.cpuNote({ pace: pace.text }).text;
}

/**
 * 提交时决定的声音（还没读文件）：
 * - `preset`：模型的说话人或内置音色（`builtin` 不为 null）；
 * - `clone`：参考录音来自请求的文件，或音色库条目（`library:<id>`，由任务管理器读出固定版本的录音与原文）；
 * - `describe`：一句描述。
 */
export type LocalVoicePlan =
  | { mode: 'preset'; voice: string; builtin: BuiltinVoice | null }
  | { mode: 'clone'; source: 'file'; path: string; transcript: string | null }
  | { mode: 'clone'; source: 'library'; libraryId: string }
  | { mode: 'describe'; description: string };

/** 按模型的描述决定声音方式；模型不支持请求的方式时拒绝，不换成别的声音。 */
export function planLocalVoice(choice: ModelChoice<'synthesizeSpeech'>, request: SynthesizeSpeechRequest): LocalVoicePlan {
  const model = choice.model;
  const local = model.local!;
  const where = { providerId: choice.providerId, modelId: choice.modelId };
  const given = [request.voice, request.reference, request.voiceDescription].filter((v) => v !== undefined).length;
  if (given > 1) throw new RpcError('invalid-request', M.oneVoiceSource(), where);
  const requireMode = (mode: 'preset' | 'clone' | 'describe', what: Localized) => {
    if (model.voiceModes.includes(mode)) return;
    throw new RpcError('invalid-request', M.modeUnsupported({ modelId: choice.modelId, what, mode }), {
      ...where,
      voiceMode: mode,
      voiceModes: model.voiceModes,
    });
  };

  const libraryId = parseLibraryVoice(request.voice);
  if (libraryId !== null) {
    requireMode('clone', M.modeClone());
    return { mode: 'clone', source: 'library', libraryId };
  }
  if (request.reference) {
    requireMode('clone', M.modeClone());
    const transcript = request.reference.transcript?.trim() ? request.reference.transcript.trim() : null;
    checkReferenceTranscript(choice.model, transcript);
    if (transcript && local.reference && !local.reference.acceptsTranscript) {
      throw new RpcError('invalid-request', M.noReferenceTranscript({ modelId: choice.modelId }), where);
    }
    return { mode: 'clone', source: 'file', path: request.reference.file, transcript };
  }
  if (request.voiceDescription !== undefined) {
    requireMode('describe', M.modeDescribe());
    const description = request.voiceDescription.trim();
    if (!description) throw new RpcError('invalid-request', M.descriptionEmpty(), where);
    checkDescription(description, local.voiceDescription, choice.modelId, where);
    return { mode: 'describe', description };
  }

  if (!model.voiceModes.includes('preset')) {
    const need = model.voiceModes.includes('describe') ? 'voiceDescription' : 'reference';
    throw new RpcError('invalid-request', M.noPresetVoice({ modelId: choice.modelId, need }), {
      ...where,
      voiceModes: model.voiceModes,
    });
  }
  if (request.voice !== undefined) {
    const listed = model.voices.find((v) => v.voiceId === request.voice);
    if (!listed) {
      throw new RpcError('invalid-request', M.noSuchVoice({ modelId: choice.modelId, voice: request.voice }), {
        ...where,
        voices: model.voices.map((v) => v.voiceId),
      });
    }
    return { mode: 'preset', voice: listed.voiceId, builtin: listed.source === 'builtin' ? builtinVoice(listed.voiceId) : null };
  }
  // 不指定声音：内置音色按请求的语言挑（没有那种语言时取第一只），模型的说话人用 `defaultVoice`。
  if (local.builtinVoices) {
    const voice = defaultBuiltinVoice(request.language ?? null);
    return { mode: 'preset', voice: voice.id, builtin: voice };
  }
  if (!model.defaultVoice) throw new RpcError('invalid-request', M.noDefaultVoice({ modelId: choice.modelId }), where);
  return { mode: 'preset', voice: model.defaultVoice, builtin: null };
}

/** 封闭词表：逗号分隔（半角或全角），每项必须在词表里（英文不分大小写），每类至多一项。 */
function checkDescription(description: string, spec: SpeechVoiceDescription | null, modelId: string, where: Record<string, string>): void {
  if (!spec || spec.kind === 'free') return;
  const seen = new Set<string>();
  // i18n-ignore: 解析描述用的全角逗号
  for (const raw of description.split(/[,，]/)) {
    const term = raw.trim().toLowerCase();
    if (!term) continue;
    const category = spec.categories.find((c) => Object.values(c.terms).some((list) => list.some((t) => t.toLowerCase() === term)));
    if (!category) {
      throw new RpcError('invalid-request', M.termNotInVocabulary({ modelId, term: raw.trim() }), {
        ...where,
        term: raw.trim(),
        vocabulary: spec.categories,
      });
    }
    if (seen.has(category.category)) {
      throw new RpcError('invalid-request', M.onePerCategory({ modelId, category: category.category }), {
        ...where,
        category: category.category,
      });
    }
    seen.add(category.category);
  }
  if (seen.size === 0) throw new RpcError('invalid-request', M.descriptionEmpty(), where);
}

/** 要冻结的参考录音：请求给出的文件（`path`），或内置音色随应用分发的录音（`asset`；`path` 在用时求，找不到模型数据目录时 null）。 */
export type ReferenceToFreeze =
  | { source: 'file'; path: string; transcript: string | null }
  | { source: 'builtin'; voiceId: string; asset: string; path: string | null; transcript: string | null };

/**
 * 内置音色要不要读参考录音：克隆模型的内置音色是一段随应用分发的录音（`builtin`），其余情况不用文件。
 * 返回要冻结的文件（任务管理器读出摘要）。不读文件、不抛错。
 */
export function builtinReferenceFile(
  model: SpeechModelInfo,
  plan: LocalVoicePlan,
): Extract<ReferenceToFreeze, { source: 'builtin' }> | null {
  if (plan.mode !== 'preset' || !plan.builtin || model.local?.builtinVoices !== 'reference') return null;
  const voice = plan.builtin;
  return { source: 'builtin', voiceId: voice.id, asset: voice.asset, path: builtinVoiceFile(voice), transcript: voice.transcript };
}

/** 内置音色的录音在错误里叫什么（给人看）：每次读都按当前语言生成，嵌进句子时带着引用。 */
export const BUILTIN_REFERENCE_LABEL: Localized = live(() => M.builtinReferenceLabel());

/** 请求给出的参考录音读不出来（`INPUT_UNREADABLE`）：句子里只说文件名，完整路径在 `details.file`。 */
export function referenceUnreadableMessage(file: string): Localized {
  return M.referenceUnreadable({ name: path.basename(file) });
}

/**
 * 参考录音：提交时读出摘要与长度。读不出（不存在、不是文件）时，请求给出的文件是 `invalid-request`（`INPUT_UNREADABLE`），
 * 内置音色的录音是 `conflict`（`APP_FILE_MISSING`，安装不完整）。
 */
export async function freezeReferenceFile(reference: ReferenceToFreeze): Promise<FrozenSpeechReference> {
  const { source, path: file, transcript } = reference;
  const unreadable = () =>
    reference.source === 'builtin'
      ? appFileMissing(BUILTIN_REFERENCE_LABEL, reference.asset, reference.path)
      : new RpcError('invalid-request', referenceUnreadableMessage(reference.path), {
          code: 'INPUT_UNREADABLE',
          reference: 'file',
          file: reference.path,
        });
  if (file === null) throw unreadable();
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw unreadable();
  const hex = await sha256File(file).catch(() => null);
  if (hex === null) throw unreadable();
  return { source, path: file, sha256: `sha256:${hex}`, byteLength: stat.size, transcript };
}

/** 冻结参数里的 `voice`：预设是音色 ID；克隆与描述没有音色 ID，记下来源（音色库条目照原样）。 */
export function frozenVoiceOf(plan: LocalVoicePlan): string {
  switch (plan.mode) {
    case 'preset':
      return plan.voice;
    case 'clone':
      return plan.source === 'library' ? `library:${plan.libraryId}` : 'reference';
    case 'describe':
      return 'description';
  }
}

/** audio.cpp 服务（`audiocpp_server`）的一次合成请求：`POST /v1/audio/speech` 的 JSON，以及没能按注记念的读音。 */
export interface AudioCppSpeechRequest {
  body: {
    model: string;
    input: string;
    voice_ref?: string;
    reference_text?: string;
    seed?: number;
    options: Record<string, string | number | boolean>;
  };
  dropped: DroppedReading[];
}

/** 服务配置里合成模型的 ID（每个服务进程只配一个模型）。 */
export const AUDIO_CPP_SPEECH_MODEL_ID = 'speech';

/**
 * 冻结的参数 → audio.cpp 服务的请求（架构设计 §6.1、§6.3）。有参考录音就是克隆（内置音色也是），有描述就是按描述造声，其余是
 * 模型的说话人；参考录音由调用方先核对摘要、转成 WAV（`referenceWav`）。提交时已经按模型描述检查过声音方式与旋钮，这里只换写法：
 *
 * - 文本：读音标注按模型包的 `readings` 渲染（`speech-readings.ts`）；VoxCPM2 的风格说明接在正文前（`(说明)正文`）。
 * - 语言：请求的语言整个或主语言子标签在引擎认得的语言里时才给，否则由模型自己判断。
 * - 声音：克隆给 `voice_ref` 与原文（IndexTTS 不读原文；Qwen3-TTS Base 没有原文时只用说话人向量 `x_vector_only_mode`）；
 *   描述与 Qwen3-TTS CustomVoice 的语气说明都是 `instruct`；CustomVoice 的说话人是 `voice_id`。
 * - 语速：OmniVoice 是 `speed`，IndexTTS 2.5 是目标时长的倍率 `duration_scale`（语速的倒数）；引导强度与步数是
 *   `guidance_scale` 与 `num_inference_steps`。
 */
export function audioCppSpeechRequestOf(
  parameters: SpeechParameters,
  profile: SpeechBundleProfile,
  referenceWav: string | null,
): AudioCppSpeechRequest {
  const engine = profile.engine;
  const family = engine.family;
  const rendered = renderReadings(parameters.text, profile.readings);
  const options: Record<string, string | number | boolean> = {};
  const instructions = parameters.instructions?.trim() || null;
  let input = rendered.text;
  if (instructions && (family === 'voxcpm2' || engine.instructionsAs === 'prefix')) input = `(${instructions})${input}`;
  else if (instructions) options.instruct = instructions;

  const language = engineLanguage(parameters.language, engine.languages);
  if (language !== null) options.language = language;
  if (engine.chunkSize !== undefined) options.text_chunk_size = engine.chunkSize;

  const body: AudioCppSpeechRequest['body'] = { model: AUDIO_CPP_SPEECH_MODEL_ID, input, options };
  if (parameters.reference) {
    if (referenceWav === null) throw new Error('audio.cpp clone request without a converted reference');
    body.voice_ref = referenceWav;
    const transcript = parameters.reference.transcript?.trim() || null;
    if (transcript && family !== 'index_tts2') body.reference_text = transcript;
    else if (family === 'qwen3_tts') options.x_vector_only_mode = true;
  } else if (parameters.voiceDescription !== undefined) {
    options.instruct = parameters.voiceDescription;
  } else if (profile.presets === 'model') {
    options.voice_id = parameters.voice;
  }

  if (parameters.speed !== null) {
    if (family === 'index_tts2') options.duration_scale = 1 / parameters.speed;
    else options.speed = parameters.speed;
  }
  if (parameters.cfg !== undefined) options.guidance_scale = parameters.cfg;
  if (parameters.steps !== undefined) options.num_inference_steps = parameters.steps;
  if (parameters.seed !== null) body.seed = parameters.seed;
  // 添加的模型：只发上游规格列出的参数（引擎遇到不认得的参数会报错），参考原文同理。内置模型族的写法（上面按族名的分支）对同一族
  // 的添加模型照样适用：引擎是同一个。
  if (engine.options) {
    const known = new Set(engine.options);
    for (const key of Object.keys(options)) if (!known.has(key)) delete options[key];
    if (body.reference_text !== undefined && !known.has('reference_text')) delete body.reference_text;
  }
  return { body, dropped: rendered.dropped };
}

/** 请求的语言（BCP 47）在引擎认得的语言 ID 里的写法：整个标签或主语言子标签（不分大小写），都不在时 null。 */
export function engineLanguage(language: string | null, known: readonly string[] | undefined): string | null {
  if (language === null || !known?.length) return null;
  const tag = language.toLowerCase();
  if (known.includes(tag)) return tag;
  const primary = tag.split('-')[0]!;
  return known.includes(primary) ? primary : null;
}

/** 合成结果的峰值上限 −1 dBFS（满幅为 1）：`10^(−1/20)`。 */
export const SPEECH_PEAK_CEILING = 0.8912509;

/**
 * 合成结果的峰值上限（原 Model Worker 的 `PeakLimited`）：整段峰值高于 `SPEECH_PEAK_CEILING` 时等比缩到它，只缩不放、不做压缩。
 * 只处理 16 位 PCM 与 32 位浮点的 WAV（audio.cpp 服务输出 16 位 PCM）；别的格式、解析不了的原样返回。原地改写 `bytes`，返回乘上去的
 * 增益（没缩时 null）。引擎量化成 16 位时已经削平的样本救不回来，这里只保证交出去的文件不贴满幅。
 */
export function limitSpeechPeak(bytes: Buffer): number | null {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
  let format = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      format = bytes.readUInt16LE(body);
      if (format === 0xfffe && size >= 40 && body + 26 <= bytes.length) format = bytes.readUInt16LE(body + 24);
      bits = bytes.readUInt16LE(body + 14);
    } else if (id === 'data') {
      const end = Math.min(body + size, bytes.length);
      if (format === 1 && bits === 16) return scalePeak(body, end, 2, (at) => bytes.readInt16LE(at) / 32_768, (at, v) => bytes.writeInt16LE(Math.round(v * 32_767), at));
      if (format === 3 && bits === 32) return scalePeak(body, end, 4, (at) => bytes.readFloatLE(at), (at, v) => bytes.writeFloatLE(v, at));
      return null;
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function scalePeak(
  start: number,
  end: number,
  width: number,
  read: (at: number) => number,
  write: (at: number, value: number) => void,
): number | null {
  const last = end - ((end - start) % width);
  let peak = 0;
  for (let at = start; at < last; at += width) {
    const value = read(at);
    if (!Number.isFinite(value)) write(at, 0);
    else if (Math.abs(value) > peak) peak = Math.abs(value);
  }
  if (peak <= SPEECH_PEAK_CEILING) return null;
  const gain = SPEECH_PEAK_CEILING / peak;
  for (let at = start; at < last; at += width) {
    write(at, Math.max(-SPEECH_PEAK_CEILING, Math.min(SPEECH_PEAK_CEILING, read(at) * gain)));
  }
  return gain;
}

/** A model requiring ICL reference text must not silently synthesize without it. */
export function checkReferenceTranscript(model: SpeechModelInfo, transcript: string | null | undefined): void {
  if (model.local?.reference?.requiresTranscript && !transcript?.trim()) {
    throw new RpcError('invalid-request', M.referenceTranscriptRequired(), {
      modelId: model.modelId, reason: 'reference-transcript-required',
    });
  }
}
