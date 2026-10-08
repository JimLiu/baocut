import { defineMessages, intlLocale } from '@baocut/protocol';
import { zhHans } from './tools-tts-copy.zh-Hans.ts';
import { zhHant } from './tools-tts-copy.zh-Hant.ts';
import { ja } from './tools-tts-copy.ja.ts';
import { ko } from './tools-tts-copy.ko.ts';
import { es } from './tools-tts-copy.es.ts';
import { fr } from './tools-tts-copy.fr.ts';
import { de } from './tools-tts-copy.de.ts';
import { nl } from './tools-tts-copy.nl.ts';
import { ptBR } from './tools-tts-copy.pt-BR.ts';
import { it } from './tools-tts-copy.it.ts';
import { ru } from './tools-tts-copy.ru.ts';
import { pl } from './tools-tts-copy.pl.ts';
import { tr } from './tools-tts-copy.tr.ts';
import { vi } from './tools-tts-copy.vi.ts';

/** 一位小数的秒数（按界面语言写数字）。 */
export function oneDecimal(n: number): string {
  return new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(n);
}

/** 生成语音工作台的文案（译文在 `tools-tts-copy.<语言>.ts`）。 */
const en = {
  emptyText: 'Write the text to read first',
  /** 念法卡：`name` 是卡上的名字，`style` 填进「风格」，也原样作为风格说明发给模型。 */
  vibes: {
    radio: { name: 'Late-night radio', style: 'Like late-night radio: a little slower, voice kept low' },
    launch: { name: 'Product launch', style: 'A product launch: warmer and more energetic, stressing the key points' },
    bedtime: { name: 'Bedtime story', style: 'A soft bedtime story: slower pace, gentle tone' },
    news: { name: 'News bulletin', style: 'A news bulletin: clear diction, steady rhythm' },
    teach: { name: 'Lesson', style: 'Explain it like a lesson: conversational, pausing at the key points' },
    vlog: { name: 'Upbeat narration', style: 'Light and upbeat, a little faster, with a smile in the voice' },
  },
  statsEmpty: (max: number) => `0 / ${max} characters`,
  stats: (n: number, max: number, segments: number, seconds: string) =>
    `${n} / ${max} characters · ${segments} ${segments === 1 ? 'segment' : 'segments'} · about ${seconds} s`,
  defaultVoiceOption: (name: string) => `Default · ${name}`,
  customVoiceOption: 'Enter a voice ID…',
  presetOnly: (model: string) => `${model} only takes preset voices, so My voices can’t be used`,
  cannotClone: (provider: string) => `${provider} can’t clone · use its preset voices`,
  noConsent: 'Not marked as your own voice or used with permission, so it won’t be uploaded to a third party · add the statement in My voices',
  cloneStale: (provider: string) => `The clone on ${provider} is out of date (the reference recording changed) · upload it again in My voices`,
  notCloned: (provider: string) => `Not cloned on ${provider} yet · upload it once in My voices`,
  customVoice: 'Custom voice',
  deletedVoice: 'Deleted voice',
  myVoices: 'My voices',
  defaultVoice: 'Default voice',
  cannotSpeak: (model: string, language: string) => `${model} can’t read ${language}`,
  voiceDeleted: 'The selected voice was deleted; pick another',
  tooLong: (model: string, max: number) => `${model} takes at most ${max} characters at a time; shorten the text first`,
  enterVoiceId: 'Enter a voice ID first',
  pickVoice: 'Choose a voice first',
  noVoices: 'This model has no voices available',
  seedInteger: 'Seed must be a whole number',
  noModel: 'No speech synthesis model available yet',
  connectFirst: (provider: string) => `Connect ${provider} first`,
  readsMaterial: (model: string, voice: string, name: string) => `${model} · ${voice} · reads the text of “${name}”`,
  estimate: (seconds: string, chars: number) => ` · about ${seconds} s · about ${chars} characters`,
  chars: (n: number) => `${n} ${n === 1 ? 'character' : 'characters'}`,
  speech: 'Speech',
  presetVoices: (n: number) => `${n} preset ${n === 1 ? 'voice' : 'voices'}`,
  customVoiceId: 'Custom voice ID',
  takesStyle: 'Takes style notes',
  speedRange: (min: number, max: number) => `Speed ${min}–${max}×`,
  maxChars: (max: number) => `Up to ${max} characters at a time`,
  headerChip: (provider: string) => `Online · ${provider} · billed by usage`,
};
export type ToolsTtsMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
