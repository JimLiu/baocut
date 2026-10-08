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
import type { BundleDefinition } from './bundle-registry.ts';
import { appFileMissing } from './model-assets.ts';
import { sha256File } from './model-catalog.ts';
import type { ModelChoice } from './model-selection.ts';
import { BUILTIN_VOICES, builtinVoice, builtinVoiceFile, defaultBuiltinVoice, type BuiltinVoice } from './speech-voices.ts';
import type { JobInput, SynthesizeOptions, SynthesizeVoice } from './worker-contract.ts';

/**
 * 本地语音合成（架构设计 §6.1、§6.3）：把 `synthesize` 模型包描述成 `local` Provider 的 `synthesizeSpeech` 模型，
 * 在提交时决定声音方式（不换成别的声音），执行时换成 Worker 的 `job.run` 参数（Model Worker 协议规范 §2.5.2）。
 */

/**
 * 本地模型单次请求的文本上限（按码点计）。引擎内部按句切分，这个上限只挡住一次任务里过长的文本，超过时在提交时拒绝，
 * 不截断：长文由调用方分段提交。
 */
export const LOCAL_SPEECH_MAX_CHARS = 2000;

/** `synthesize` 模型包的 `synthesizeSpeech` 模型描述。 */
export function localSpeechModelInfo(def: BundleDefinition, status: ModelBundleStatus, usable: boolean): SpeechModelInfo {
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
    ...(onCpu(def, status) ? { notes: cpuNote(def) } : {}),
    ...(!usable && status.detail ? { detail: status.detail, ...(status.detailRef ? { detailRef: status.detailRef } : {}) } : {}),
  };
}

/** candle 的模型包在 CPU 上跑（Worker 没有报告 CUDA）。 */
function onCpu(def: BundleDefinition, status: ModelBundleStatus): boolean {
  return def.backend === 'candle' && (status.device ?? def.device) === 'cpu';
}

/**
 * candle 在 CPU 上合成有多慢，按模型（`bundleId` 的 `@` 前一段）。数字是本机（Apple M 系列、16 GiB，`--release`）的实测
 * （架构设计 §6.5）：Qwen3-TTS 0.6B 2.9 秒用 162 秒、5.0 秒用 268 秒；IndexTTS 2.5 每句 3.4–4.9 秒用 420–625 秒；
 * OmniVoice 22 秒用 646 秒；GPT-SoVITS 9 秒用 56 秒（含加载）。没有实测的照实写「这只没有实测」，不编数字。
 */
const CPU_PACE: Record<string, () => Localized> = {
  'qwen3-tts-0.6b-base': M.paceQwen06,
  'qwen3-tts-0.6b-customvoice': M.paceQwen06,
  'qwen3-tts-1.7b-base': M.paceQwen17,
  'qwen3-tts-1.7b-customvoice': M.paceQwen17,
  'qwen3-tts-1.7b-voicedesign': M.paceQwen17,
  indextts2: M.paceIndexTts2,
  'index-tts2.5': M.paceIndexTts25,
  'gpt-sovits-v2': M.paceGptSovits,
  voxcpm2: M.paceVoxcpm2,
  omnivoice: M.paceOmnivoice,
};

/**
 * 耗时的提示（与文生图的同一个 `notes`）：candle 合成在 CPU 上只用到一两个核（与旧版相同），比实时慢几倍到上百倍，照实说。
 * CUDA 没有实测；Worker 报告 CUDA 时不写这句，与 MLX 的同一只模型一样。
 */
// `notes` 没有引用字段：按生成时的语言存文本。
function cpuNote(def: BundleDefinition): string {
  const pace = (CPU_PACE[def.bundleId.split('@')[0]!] ?? M.paceDefault)();
  return M.cpuNote({ pace }).text;
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

/**
 * 冻结的参数 → Worker 的 `job.run`（`synthesize`）。有参考录音就是 `clone`（内置音色也是），有描述就是 `describe`，
 * 其余是模型的说话人。参考录音的摘要是提交时读出的；执行前由调用方再核对一次文件。
 */
export function synthesizeRunOf(parameters: {
  text: string;
  voice: string;
  language: string | null;
  instructions: string | null;
  speed: number | null;
  seed: number | null;
  reference?: FrozenSpeechReference;
  voiceDescription?: string;
  cfg?: number;
  steps?: number;
}): { input: JobInput | null; options: SynthesizeOptions } {
  let voice: SynthesizeVoice;
  let input: JobInput | null = null;
  if (parameters.reference) {
    voice = { mode: 'clone', transcript: parameters.reference.transcript };
    input = { file: parameters.reference.path, contentHash: parameters.reference.sha256, track: 0 };
  } else if (parameters.voiceDescription !== undefined) {
    voice = { mode: 'describe', description: parameters.voiceDescription };
  } else {
    voice = { mode: 'preset', id: parameters.voice };
  }
  return {
    input,
    options: {
      text: parameters.text,
      language: parameters.language,
      voice,
      instructions: parameters.instructions,
      speed: parameters.speed,
      cfg: parameters.cfg ?? null,
      steps: parameters.steps ?? null,
      seed: parameters.seed,
    },
  };
}
