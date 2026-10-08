import { defineMessages } from '@baocut/protocol';
import { zhHans } from './transcribe-copy.zh-Hans.ts';
import { zhHant } from './transcribe-copy.zh-Hant.ts';
import { ja } from './transcribe-copy.ja.ts';
import { ko } from './transcribe-copy.ko.ts';
import { es } from './transcribe-copy.es.ts';
import { fr } from './transcribe-copy.fr.ts';
import { de } from './transcribe-copy.de.ts';
import { nl } from './transcribe-copy.nl.ts';
import { ptBR } from './transcribe-copy.pt-BR.ts';
import { it } from './transcribe-copy.it.ts';
import { ru } from './transcribe-copy.ru.ts';
import { pl } from './transcribe-copy.pl.ts';
import { tr } from './transcribe-copy.tr.ts';
import { vi } from './transcribe-copy.vi.ts';

/**
 * 字幕面板「生成字幕」的转录设置的文案（原型 glossary-tool.jsx `AsrHintBlock`、tool-transcribe.jsx）。
 * 与 `subtitle-copy.ts` 分开放：那份里还有翻译的文案，两边各改各的。译文在 `transcribe-copy.zh-Hans.ts`。
 */
const en = {
  title: 'Transcription settings',
  language: 'Language',
  model: 'Speech model',
  manageModels: 'Manage speech models',
  modelsLoading: 'Loading speech models…',
  noDefault: 'No default speech model yet',
  hint: 'Recognition hints',
  glossary: 'Glossary',
  manageGlossary: 'Manage glossaries',
  glossaryLoading: 'Loading glossaries…',
  glossaryEmpty: 'No transcription glossaries yet. Create one in Settings › Glossary to record the correct spelling of names and terms.',
  glossaryFailed: (message: string) => `Couldn’t read the glossaries enabled for this video: ${message}`,
  glossaryNote: 'Check a glossary to enable it for this video; every future transcription uses it. You can undo this.',
  glossaryReadOnly: 'This video can’t be edited right now, so its enabled glossaries can’t be changed.',
  glossaryLimit: (n: number) => `A video can have at most ${n} glossaries enabled`,
  glossaryOn: (name: string) => `Enabled “${name}” for this video`,
  glossaryOff: (name: string) => `Disabled “${name}”`,
  glossaryWriteFailed: (message: string) => `Couldn’t change the enabled glossaries: ${message}`,
  undo: 'Undo',
  prompt: 'Custom prompt',
  promptPlaceholder: 'Optional. For example: An English podcast about LLM inference optimization, hosted by Lin Che with guest Zhou Yuan.',
  how: 'The prompt and the enabled glossaries (correct spellings) are given to the speech model together to help it recognize names and terms. If they exceed the limit, terms at the end are dropped.',
  reuse: 'Assets that are already transcribed reuse that transcript; these settings only apply to assets that still need transcribing.',
};

export type TranscribeSetupMessages = typeof en;
export const TRANSCRIBE_SETUP_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
