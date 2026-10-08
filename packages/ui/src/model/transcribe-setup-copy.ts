import { defineMessages } from '@baocut/protocol';
import { zhHans } from './transcribe-setup-copy.zh-Hans.ts';
import { zhHant } from './transcribe-setup-copy.zh-Hant.ts';
import { ja } from './transcribe-setup-copy.ja.ts';
import { ko } from './transcribe-setup-copy.ko.ts';
import { es } from './transcribe-setup-copy.es.ts';
import { fr } from './transcribe-setup-copy.fr.ts';
import { de } from './transcribe-setup-copy.de.ts';
import { nl } from './transcribe-setup-copy.nl.ts';
import { ptBR } from './transcribe-setup-copy.pt-BR.ts';
import { it } from './transcribe-setup-copy.it.ts';
import { ru } from './transcribe-setup-copy.ru.ts';
import { pl } from './transcribe-setup-copy.pl.ts';
import { tr } from './transcribe-setup-copy.tr.ts';
import { vi } from './transcribe-setup-copy.vi.ts';

/** 「生成字幕」转录设置的文案（model/transcribe-setup.ts；译文在 `transcribe-setup-copy.<语言>.ts`）。 */
const en = {
  notConnected: 'Not connected',
  unavailable: 'Unavailable',
  autoDetect: 'Detect automatically',
  hintNoModel: 'It isn’t known yet which speech model will be used. Choose one above to see whether it accepts recognition hints.',
  /** `alt`：收识别提示、能换的另一只模型；没有时 null。 */
  hintUnsupported: (model: string, alt: string | null) =>
    `${model} doesn’t accept recognition hints, so glossaries and the prompt can’t be used in this step and will be skipped when transcribing.${alt ? ` To use them while transcribing, switch to ${alt}.` : ''}`,
  /** 预算那一行：送给哪只模型、提示词几个字、几个术语、拼好约多少字、放不下几条。 */
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `${b.custom}-character prompt` : 'no prompt';
    const dropped = b.dropped ? ` · ${b.dropped} more don’t fit; glossaries listed first go in first` : '';
    return `Sent to ${model}: ${custom} + ${b.terms} ${b.terms === 1 ? 'term' : 'terms'} · about ${b.chars} / ${max} characters${dropped}`;
  },
  glossaryGone: 'No longer in the glossary library · not used this time',
  glossaryTranslation: 'Translation glossary; not used for transcription · not used this time',
  anyLanguage: 'Any language',
  termCount: (count: number) => `${count} ${count === 1 ? 'term' : 'terms'}`,
  noDefaultModel: 'No default speech model yet',
  defaultModel: (label: string) => `${label} (default)`,
  autoDetectLanguage: 'Detect language automatically',
  glossaries: (count: number) => `${count} ${count === 1 ? 'glossary' : 'glossaries'}`,
  hasPrompt: 'With prompt',
  noDefaultFacts: 'No default speech model yet. Choose one, or set a default on the Models page. If you start without choosing, you’ll be told what’s missing.',
  modelUnusable: 'This model can’t be used right now',
  acceptsHint: 'Accepts recognition hints',
  noHint: 'No recognition hints',
  followDefault: (facts: string) => `Uses the default · ${facts}`,
};
export type TranscribeSetupMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
