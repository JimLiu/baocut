import { defineMessages, type JobRecord, type LibraryEntrySummary } from '@baocut/protocol';
import {
  customVoiceAllowed,
  libraryIdOf,
  libraryVoiceAllowed,
  libraryVoiceBlock,
  libraryVoiceKey,
  speechCanClone,
  voiceKeyFor,
  type MyVoices,
  type SpeechOption,
  type TtsDraft,
  type VoiceKey,
} from './tools-tts.ts';
import { zhHans } from './voice-picker.zh-Hans.ts';
import { zhHant } from './voice-picker.zh-Hant.ts';
import { ja } from './voice-picker.ja.ts';
import { ko } from './voice-picker.ko.ts';
import { es } from './voice-picker.es.ts';
import { fr } from './voice-picker.fr.ts';
import { de } from './voice-picker.de.ts';
import { nl } from './voice-picker.nl.ts';
import { ptBR } from './voice-picker.pt-BR.ts';
import { it } from './voice-picker.it.ts';
import { ru } from './voice-picker.ru.ts';
import { pl } from './voice-picker.pl.ts';
import { tr } from './voice-picker.tr.ts';
import { vi } from './voice-picker.vi.ts';
import { cloneRows, type CloneAttempt, type CloneProvider } from './voices-library.ts';

/** 音色选择器的文案（译文在 `voice-picker.<语言>.ts`）。「我的声音」是设置里那一页的名字。 */
const en = {
  clonedOn: (provider: string) => `Cloned on ${provider} · synthesized with this clone`,
  localReference: 'Synthesized on this computer from this voice’s reference recording · nothing is uploaded',
  defaultVoice: 'Default voice',
  providerPreset: (provider: string, name: string) => `${provider}’s ${name}`,
  loadingMine: 'Loading My voices…',
  cloneNew: 'Clone a new voice…',
  cloneNewHint: 'Record one or import from a file in Settings › Models › Speech synthesis › My voices',
  myVoices: 'My voices',
  providerVoices: (provider: string) => `${provider} voices`,
  customVoice: 'Enter a voice ID…',
  customVoiceHint: 'A voice ID from your provider account',
  tempReference: 'Use a recording once…',
  tempReferenceHint: 'This version’s synthesis API doesn’t take a one-off reference recording yet · save it to My voices and clone it first',
  other: 'Other',
  voiceDeleted: 'This voice was deleted · pick another, or go back to the default',
  customLine: 'Passed to the provider as is for it to check; you can also create a cloned voice in My voices and choose it',
  presetLine: (provider: string, voiceId: string | null) => (voiceId === null ? `${provider} voice` : `${provider} voice · ${voiceId}`),
  defaultLine: (provider: string, name: string) => `If you don’t choose, ${provider}’s default voice (${name}) is used`,
  noDefault: 'This model has no default voice; choose one first',
  /** 云端：我的声音里的一只还没在这家建好克隆（选它就去补那一步，`act` 接在原因后面）。 */
  cloneUploading: (provider: string) => `Uploading to ${provider} · usually ready within half a minute, then it can be used`,
  cloneNoConsent: 'Not marked as your own voice or used with permission · not uploaded to third parties',
  cloneNoConsentClip: (provider: string) => `${provider} needs the speaker to read a consent statement aloud`,
  cloneFailed: (provider: string) => `The last upload to ${provider} didn’t create the clone`,
  cloneStale: (provider: string) => `The reference recording changed · it needs uploading to ${provider} again`,
  notCloned: (provider: string) => `Not cloned on ${provider} yet · the reference recording needs uploading`,
  notClonedClip: (provider: string) => `Not cloned on ${provider} yet · the sample and consent recording need uploading`,
  actUpload: 'pick it to upload',
  actDeclare: 'pick it to add a statement',
  actAuthorize: 'pick it to record one',
  actDiagnose: 'pick it to see why and what to do',
  readyFirst: 'it can be used once the clone is ready',
  fixUpload: (provider: string) => `Upload to ${provider}`,
  fixDeclare: 'Say whose voice it is',
  fixAuthorize: 'Record consent statement',
  fixDiagnose: 'See why',
  declareTitle: (name: string) => `Whose voice is “${name}”?`,
  declareBody: (provider: string) =>
    `Before uploading to ${provider} to create a clone, confirm this is your own voice or that the speaker gave permission. It’s recorded on this voice, so other providers won’t ask again. Please don’t upload a voice without permission.`,
  declareConfirm: 'It’s me, or I have permission',
  declareFailed: (message: string) => `Couldn’t save the statement: ${message}`,
  cancel: 'Cancel',
};
export type VoicePickerMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 共享音色选择器的分组（设计稿 voice-picker.jsx、model-cloud-tts.js `pickerGroups` / `valueLine`）：云端模型下是
 * 默认 · 我的声音（按这家的克隆状态置灰，末尾「克隆新音色…」）· 这家的音色 · 手填音色 ID · 临时用一段。
 * 「克隆新音色…」只是去 设置 › 模型 › 语音合成 › 我的声音（克隆在那里建）；「临时用一段」这一版的合成接口不收临时参考音频，置灰写原因；
 * 要授权声明录音的（Gemini）没有这一项：一段录音建不了，得先在我的声音里录样本与授权声明。
 */

/** 不是音色、是动作的两项。 */
export const CLONE_NEW = 'clone-new';
export const TEMP_REFERENCE = 'temp-reference';

export interface VoicePickerItem {
  /** 音色的选法（`VoiceKey`），或 `CLONE_NEW` / `TEMP_REFERENCE`。 */
  key: string;
  label: string;
  description: string | null;
  disabled: boolean;
  /** 我的声音里还用不了、但补得上的一只：选上它之后怎么补（`wait` 只是等它建好）。 */
  fix?: CloneFix | null;
}

export interface VoicePickerGroup {
  id: 'default' | 'mine' | 'presets' | 'other';
  /** 默认那一组不写标题。 */
  title: string | null;
  items: VoicePickerItem[];
}

function presetName(option: SpeechOption, voiceId: string): string {
  return option.info.voices.find((v) => v.voiceId === voiceId)?.label ?? voiceId;
}

/**
 * 云端下我的声音里一只还用不了、但补得上时，选它之后怎么补（设计稿 model-cloud-tts.js `cloneStatus` 的 `fix`）：
 * `upload` 就地确认后上传；`declare` 就地补一句本人声明（再接着走下一步）；`authorize` 带着回程去我的声音补录授权声明（存好就上传）；
 * `diagnose` 上次没建成，带着回程去我的声音看原因与一键办法；`wait` 正在上传，选上等它建好。Runtime 只用有效克隆合成，
 * 没有「第一次用时自动上传」。样本太短在这里看不出来（摘要里没有时长），上传时被拒后走 `diagnose`。
 */
export type CloneFix = 'upload' | 'declare' | 'authorize' | 'diagnose' | 'wait';

/** 这次运行里的克隆进展：克隆任务（`jobs` 主题）与界面发起的上传（state/voice-clone-store.ts）。 */
export interface CloneActivity {
  jobs: readonly JobRecord[];
  attempts: Readonly<Record<string, CloneAttempt>>;
}

const IDLE: CloneActivity = { jobs: [], attempts: {} };

export interface LibraryVoiceStatus {
  /** 现在就能用这只模型合成。 */
  ok: boolean;
  /** 用得了时说怎么用（本机用参考录音、云端用哪家的克隆），用不了时是现状。 */
  line: string;
  /** 用不了但补得上时怎么补；用得了、或补不上（只收预置音色、这家不能克隆）时 null。 */
  fix: CloneFix | null;
  /** 选择器上接在现状后面的半句：选它会怎样。 */
  act: string | null;
}

type CloneOption = Pick<SpeechOption, 'providerId' | 'provider' | 'modelId' | 'info' | 'voiceClone'>;

/**
 * 我的声音里的一只在这只模型上的现状。顺序：补不上的（只收预置音色、这家不能克隆）→ 正在上传 → 没有本人声明 →
 * 有效克隆（用得了）→ 这家要授权声明录音而没有 → 上次没建成 → 参考录音换过 → 还没建过。
 */
export function libraryVoiceStatus(voice: LibraryEntrySummary, option: CloneOption, activity: CloneActivity = IDLE): LibraryVoiceStatus {
  const block = libraryVoiceBlock(voice, option);
  if (!block) return { ok: true, line: option.info.local ? M.localReference : M.clonedOn(option.provider), fix: null, act: null };
  const recorded = voice.clones?.some((c) => c.providerId === option.providerId);
  if (!libraryVoiceAllowed(option.info) || (!recorded && !speechCanClone(option))) return { ok: false, line: block, fix: null, act: null };
  const p = option.provider;
  const provider: CloneProvider = {
    providerId: option.providerId,
    label: p,
    available: true,
    detail: null,
    requiresConsentClip: !!option.voiceClone?.requiresConsentClip,
    sourceSeconds: option.voiceClone?.sourceSeconds ?? null,
  };
  const row = cloneRows(voice, [provider], activity.jobs, activity.attempts).find((r) => r.providerId === option.providerId);
  const needs = (line: string, fix: CloneFix, act: string | null): LibraryVoiceStatus => ({ ok: false, line, fix, act });
  if (row?.running) return needs(M.cloneUploading(p), 'wait', null);
  if (!voice.consentDeclared) return needs(M.cloneNoConsent, 'declare', M.actDeclare);
  if (provider.requiresConsentClip && !voice.consentClip) return needs(M.cloneNoConsentClip(p), 'authorize', M.actAuthorize);
  if (row?.failure) return needs(M.cloneFailed(p), 'diagnose', M.actDiagnose);
  if (row?.state === 'stale') return needs(M.cloneStale(p), 'upload', M.actUpload);
  return needs(provider.requiresConsentClip ? M.notClonedClip(p) : M.notCloned(p), 'upload', M.actUpload);
}

/** 值那一行后面的按钮：补哪一步就写哪一步（`wait` 没有按钮，转圈）。 */
export function cloneFixLabel(fix: Exclude<CloneFix, 'wait'>, provider: string): string {
  switch (fix) {
    case 'upload':
      return M.fixUpload(provider);
    case 'declare':
      return M.fixDeclare;
    case 'authorize':
      return M.fixAuthorize;
    case 'diagnose':
      return M.fixDiagnose;
  }
}

/** 就地补本人声明的确认框（选择器里选了没有声明的一只）。 */
export const declareCopy = {
  title: (name: string) => M.declareTitle(name),
  body: (provider: string) => M.declareBody(provider),
  get confirm() {
    return M.declareConfirm;
  },
  get cancel() {
    return M.cancel;
  },
  failed: (message: string) => M.declareFailed(message),
};

/**
 * 选择器的分组。`voices` 为 null（还没读到我的声音）时那一组只留「克隆新音色…」并写「正在读取」。我的声音里还用不了、
 * 但补得上的照样能选（说明后面写选它会怎样），只有补不上的置灰。
 */
export function voicePickerGroups(option: SpeechOption, voices: MyVoices, activity: CloneActivity = IDLE): VoicePickerGroup[] {
  const info = option.info;
  const groups: VoicePickerGroup[] = [];
  if (info.defaultVoice) {
    groups.push({
      id: 'default',
      title: null,
      items: [{ key: 'default', label: M.defaultVoice, description: M.providerPreset(option.provider, presetName(option, info.defaultVoice)), disabled: false }],
    });
  }
  const mine: VoicePickerItem[] = (voices ?? []).map((v) => {
    const st = libraryVoiceStatus(v, option, activity);
    return {
      key: libraryVoiceKey(v.id),
      label: v.name,
      description: st.act ? `${st.line} · ${st.act}` : st.line,
      disabled: !st.ok && !st.fix,
      fix: st.fix,
    };
  });
  if (!voices) mine.push({ key: 'mine-loading', label: M.loadingMine, description: null, disabled: true });
  mine.push({ key: CLONE_NEW, label: M.cloneNew, description: M.cloneNewHint, disabled: false });
  groups.push({ id: 'mine', title: M.myVoices, items: mine });
  if (info.voices.length) {
    groups.push({
      id: 'presets',
      title: M.providerVoices(option.provider),
      items: info.voices.map((v) => ({ key: `preset:${v.voiceId}`, label: v.label, description: v.label === v.voiceId ? null : v.voiceId, disabled: false })),
    });
  }
  const other: VoicePickerItem[] = [];
  if (customVoiceAllowed(info)) other.push({ key: 'custom', label: M.customVoice, description: M.customVoiceHint, disabled: false });
  if (speechCanClone(option) && !option.voiceClone?.requiresConsentClip) {
    other.push({ key: TEMP_REFERENCE, label: M.tempReference, description: M.tempReferenceHint, disabled: true });
  }
  if (other.length) groups.push({ id: 'other', title: M.other, items: other });
  return groups;
}

/** 选择器上选中的那一项：我的声音里删了的那只不在清单里，返回 null（控件显示占位）。 */
export function pickerSelection(draft: Pick<TtsDraft, 'voice'>, option: SpeechOption, voices: MyVoices): VoiceKey | null {
  const key = voiceKeyFor(draft, option.info);
  const id = libraryIdOf(key);
  if (id !== null) return voices?.some((v) => v.id === id) ? key : null;
  return voicePickerGroups(option, voices).some((g) => g.items.some((i) => i.key === key && !i.disabled)) ? key : null;
}

/**
 * 选中后写在控件下面的一句（设计稿 `valueLine`）：这只模型会怎么用它。选中的我的声音还没在这家建好时写现状与「建好才能合成」
 * （按钮由 `selectedCloneFix` 给），在传时只写在传。
 */
export function voiceValueLine(draft: Pick<TtsDraft, 'voice'>, option: SpeechOption, voices: MyVoices, activity: CloneActivity = IDLE): string {
  const info = option.info;
  const key = voiceKeyFor(draft, info);
  const id = libraryIdOf(key);
  if (id !== null) {
    if (!voices) return M.loadingMine;
    const voice = voices.find((v) => v.id === id);
    if (!voice) return M.voiceDeleted;
    const st = libraryVoiceStatus(voice, option, activity);
    return st.ok || !st.fix || st.fix === 'wait' ? st.line : `${st.line} · ${M.readyFirst}`;
  }
  if (key === 'custom') return M.customLine;
  if (key.startsWith('preset:')) {
    const voiceId = key.slice('preset:'.length);
    const name = presetName(option, voiceId);
    return M.presetLine(option.provider, name === voiceId ? null : voiceId);
  }
  return info.defaultVoice ? M.defaultLine(option.provider, presetName(option, info.defaultVoice)) : M.noDefault;
}

/** 选中的是我的声音、还没在这家建好但补得上：那只与怎么补（值那一行的按钮与转圈）；别的时候 null。 */
export function selectedCloneFix(
  draft: Pick<TtsDraft, 'voice'>,
  option: SpeechOption,
  voices: MyVoices,
  activity: CloneActivity = IDLE,
): { voice: LibraryEntrySummary; fix: CloneFix } | null {
  const id = libraryIdOf(voiceKeyFor(draft, option.info));
  const voice = id !== null ? voices?.find((v) => v.id === id) : undefined;
  if (!voice) return null;
  const st = libraryVoiceStatus(voice, option, activity);
  return st.fix ? { voice, fix: st.fix } : null;
}

/** 「克隆声音」进来时先选哪只：草稿里已经是我的声音就留着；否则这家用得了的第一只，再是第一只；一只都没有时 null。 */
export function cloneVoiceKey(draft: Pick<TtsDraft, 'voice'>, option: SpeechOption | null, voices: MyVoices): VoiceKey | null {
  if (libraryIdOf(draft.voice) !== null) return draft.voice;
  if (!voices?.length) return null;
  const usable = option ? voices.find((v) => !libraryVoiceBlock(v, option)) : undefined;
  return libraryVoiceKey((usable ?? voices[0]!).id);
}
