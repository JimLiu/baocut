import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './translate-subtitles.zh-Hans.ts';
import { zhHant } from './translate-subtitles.zh-Hant.ts';
import { ja } from './translate-subtitles.ja.ts';
import { ko } from './translate-subtitles.ko.ts';
import { es } from './translate-subtitles.es.ts';
import { fr } from './translate-subtitles.fr.ts';
import { de } from './translate-subtitles.de.ts';
import { nl } from './translate-subtitles.nl.ts';
import { ptBR } from './translate-subtitles.pt-BR.ts';
import { it } from './translate-subtitles.it.ts';
import { ru } from './translate-subtitles.ru.ts';
import { pl } from './translate-subtitles.pl.ts';
import { tr } from './translate-subtitles.tr.ts';
import { vi } from './translate-subtitles.vi.ts';

/** `packages/jobs/src/pipelines/translate-subtitles.ts`：「翻译字幕文件」流程的名字、步骤、错误与警告。 */
const en = {
  label: 'Translate subtitle file',
  description:
    'Translates an SRT or WebVTT subtitle file into another language, subtitle by subtitle, and writes a new subtitle file. The number of subtitles and their timecodes stay the same; the result can be bilingual or in another format. The video is not touched.',
  stepRead: 'Read subtitles',
  stepTranslate: 'Translate',
  stepCheck: 'Check',
  stepPublish: 'Publish',
  noStructuredOutput: (p: { model: string }) => `Model ${p.model} doesn't support structured output, so it can't be used for translation`,
  artifactGone: (p: { artifactId: string }) => `Output ${p.artifactId} no longer exists`,
  paramNotAbsolute: (p: { key: string }) => `Parameter ${p.key} should be an absolute path`,
  inputNotSubtitle: 'Parameter input should be an .srt or .vtt file',
  languageInvalid: (p: { key: string }) => `Parameter ${p.key} should be a BCP 47 language tag`,
  bilingualInvalid: 'Parameter bilingual should be true or false',
  fileNotFound: (p: { file: string }) => `Couldn't find the subtitle file ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `The subtitle file is ${p.bytes} bytes, over the limit of ${p.limit}`,
  noText: 'The subtitle file has no text to translate',
  allEmpty: 'Every subtitle is empty',
  markupStripped: (p: { count: number }) =>
    `${p.count} subtitles had inline markup (italics, color, position, and so on) that wasn't kept in the translation`,
  cueNoTranslation: (p: { n: number }) => `Subtitle ${p.n} has no translation`,
  rereadFailed: "Couldn't read back the written subtitles",
  cueCountMismatch: (p: { written: number; original: number }) => `Wrote ${p.written} subtitles; the original file has ${p.original}`,
  timingChanged: (p: { n: number; from: string; to: string }) => `The timecode of subtitle ${p.n} changed: ${p.from} → ${p.to}`,
  cannotMatch: "The translation can't be written as subtitles that match the original file one to one",
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `Converted to SRT: cue settings on ${p.settings} subtitles and ${p.blocks} NOTE, STYLE, and REGION blocks don't fit and weren't kept`,
};

export type JobsTranslateSubtitlesMessages = typeof en;

export const JobsTranslateSubtitles = defineCatalog('jobsTranslateSubtitles', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
