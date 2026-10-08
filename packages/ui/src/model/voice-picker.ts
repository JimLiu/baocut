import { defineMessages, type LibraryEntrySummary } from '@baocut/protocol';
import {
  customVoiceAllowed,
  libraryIdOf,
  libraryVoiceBlock,
  libraryVoiceKey,
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
import { VOICE_CLONE_PROVIDERS } from './voices-library.ts';

/** 音色选择器的文案（译文在 `voice-picker.<语言>.ts`）。「我的声音」是设置里那一页的名字。 */
const en = {
  clonedOn: (provider: string) => `Cloned on ${provider} · synthesized with this clone`,
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
};
export type VoicePickerMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 共享音色选择器的分组（设计稿 voice-picker.jsx、model-cloud-tts.js `pickerGroups` / `valueLine`）：云端模型下是
 * 默认 · 我的声音（按这家的克隆状态置灰，末尾「克隆新音色…」）· 这家的音色 · 手填音色 ID · 临时用一段。
 * 「克隆新音色…」只是去 设置 › 模型 › 语音合成 › 我的声音（克隆在那里建）；「临时用一段」这一版的合成接口不收临时参考音频，置灰写原因。
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

/** 这家能不能克隆：Runtime 现在只有 ElevenLabs 有克隆接口。 */
function canClone(option: Pick<SpeechOption, 'providerId'>): boolean {
  return VOICE_CLONE_PROVIDERS.includes(option.providerId);
}

/** 我的声音里一只的说明：用得了时说用哪家的克隆，用不了时就是原因。 */
export function libraryVoiceLine(voice: LibraryEntrySummary, option: SpeechOption): { ok: boolean; line: string } {
  const block = libraryVoiceBlock(voice, option);
  return block ? { ok: false, line: block } : { ok: true, line: M.clonedOn(option.provider) };
}

/** 选择器的分组。`voices` 为 null（还没读到我的声音）时那一组只留「克隆新音色…」并写「正在读取」。 */
export function voicePickerGroups(option: SpeechOption, voices: MyVoices): VoicePickerGroup[] {
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
    const st = libraryVoiceLine(v, option);
    return { key: libraryVoiceKey(v.id), label: v.name, description: st.line, disabled: !st.ok };
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
  if (canClone(option)) {
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

/** 选中后写在控件下面的一句（设计稿 `valueLine`）：这只模型会怎么用它。 */
export function voiceValueLine(draft: Pick<TtsDraft, 'voice'>, option: SpeechOption, voices: MyVoices): string {
  const info = option.info;
  const key = voiceKeyFor(draft, info);
  const id = libraryIdOf(key);
  if (id !== null) {
    if (!voices) return M.loadingMine;
    const voice = voices.find((v) => v.id === id);
    return voice ? libraryVoiceLine(voice, option).line : M.voiceDeleted;
  }
  if (key === 'custom') return M.customLine;
  if (key.startsWith('preset:')) {
    const voiceId = key.slice('preset:'.length);
    const name = presetName(option, voiceId);
    return M.presetLine(option.provider, name === voiceId ? null : voiceId);
  }
  return info.defaultVoice ? M.defaultLine(option.provider, presetName(option, info.defaultVoice)) : M.noDefault;
}

/** 「克隆声音」进来时先选哪只：草稿里已经是我的声音就留着；否则这家用得了的第一只，再是第一只；一只都没有时 null。 */
export function cloneVoiceKey(draft: Pick<TtsDraft, 'voice'>, option: SpeechOption | null, voices: MyVoices): VoiceKey | null {
  if (libraryIdOf(draft.voice) !== null) return draft.voice;
  if (!voices?.length) return null;
  const usable = option ? voices.find((v) => !libraryVoiceBlock(v, option)) : undefined;
  return libraryVoiceKey((usable ?? voices[0]!).id);
}
