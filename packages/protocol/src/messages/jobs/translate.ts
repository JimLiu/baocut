import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './translate.zh-Hans.ts';
import { zhHant } from './translate.zh-Hant.ts';
import { ja } from './translate.ja.ts';
import { ko } from './translate.ko.ts';
import { es } from './translate.es.ts';
import { fr } from './translate.fr.ts';
import { de } from './translate.de.ts';
import { nl } from './translate.nl.ts';
import { ptBR } from './translate.pt-BR.ts';
import { it } from './translate.it.ts';
import { ru } from './translate.ru.ts';
import { pl } from './translate.pl.ts';
import { tr } from './translate.tr.ts';
import { vi } from './translate.vi.ts';

/** `packages/jobs/src/pipelines/translate.ts`：「翻译」流程的名字、步骤、错误与写进视频的名字。 */
const en = {
  label: 'Translate',
  description:
    'Translates a transcript in the video sentence by sentence into another language and writes the result as a new translation document. A text model does the work; no agent is started.',
  stepFreezeSource: 'Read source',
  stepTranslate: 'Translate',
  stepAssemble: 'Assemble translation',
  stepWrite: 'Write to video',
  videoNotOpen: 'The video is not open',
  noStructuredOutput: (p: { model: string }) => `Model ${p.model} doesn't support structured output, so it can't be used for translation`,
  workerMismatch: "The Speech Worker's translation doesn't match the frozen source",
  targetLanguageInvalid: 'Parameter targetLanguage should be a BCP 47 language tag',
  flagInvalid: (p: { key: string }) => `Parameter ${p.key} should be true or false`,
  bilingualNeedsCaptions: 'Parameter bilingual can only be given when captions is true (adding a subtitle layer)',
  noDocument: (p: { documentId: string }) => `The video has no document ${p.documentId}`,
  notSpeech: (p: { documentId: string; kind: string }) =>
    `Document ${p.documentId} is ${p.kind}; only transcripts (speech) can be translated`,
  noTranscript: 'The video has no transcript. Transcribe it before translating.',
  multipleTranscripts: 'The video has more than one transcript. Use documentId to choose which one to translate.',
  videoClosed: 'The video was closed',
  sourceGone: 'The source document is no longer in the video',
  noSentences: 'The transcript has no sentences to translate',
  sameLanguage: (p: { source: string; target: string }) =>
    `The transcript language ${p.source} is the same as the target language ${p.target}, so no translation is needed`,
  workerMissing: "Couldn't find the Speech Worker (speech-worker). Run npm run build:engine first.",
  /** 写进视频的名字：新的译文文档。 */
  documentName: (p: { language: string }) => `Translation ${p.language}`,
  videoClosedKept: 'The video was closed. The translation is kept in the outputs.',
  sourceChanged:
    'The source document changed during translation, so nothing was written to the video. Retrying translates the current version of the source document.',
  /** 写进视频的编辑历史：写入译文的事务标签。 */
  transactionLabel: (p: { language: string }) => `Translate to ${p.language}`,
  noDocumentId: "The translation was written to the video, but its document ID wasn't returned",
  rejected: 'The transaction to write to the video was rejected. The translation is kept in the outputs.',
};

export type JobsTranslateMessages = typeof en;

export const JobsTranslate = defineCatalog('jobsTranslate', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
