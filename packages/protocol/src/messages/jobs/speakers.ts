import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './speakers.zh-Hans.ts';
import { zhHant } from './speakers.zh-Hant.ts';
import { ja } from './speakers.ja.ts';
import { ko } from './speakers.ko.ts';
import { es } from './speakers.es.ts';
import { fr } from './speakers.fr.ts';
import { de } from './speakers.de.ts';
import { nl } from './speakers.nl.ts';
import { ptBR } from './speakers.pt-BR.ts';
import { it } from './speakers.it.ts';
import { ru } from './speakers.ru.ts';
import { pl } from './speakers.pl.ts';
import { tr } from './speakers.tr.ts';
import { vi } from './speakers.vi.ts';

/** `packages/jobs/src/pipelines/speakers.ts`：「识别说话人」流程与应用提案。 */
const en = {
  /** 流程名，也是应用提案那笔事务的标签。 */
  label: 'Identify speakers',
  description:
    'Tells apart the speakers in an existing transcript in the video by voice (local model, no re-transcription). The result is a proposal; after it is confirmed, apply it with edits.applySpeakers.',
  stepDiarize: 'Tell speakers apart',
  stepPropose: 'Organize results',
  videoNotOpen: 'The video is not open',
  notFromAsset: "This transcript doesn't belong to an asset in the video, so speakers can't be told apart by voice",
  modelMissing: 'This computer has no speaker diarization model',
  modelNotInstalled: "The speaker diarization model isn't installed yet. Download it first.",
  transcriptUnreadable: "Couldn't read the transcript",
  videoClosed: 'The video was closed',
  transcriptGone: 'The transcript is no longer in the video',
  noWords: 'The transcript has no words',
  untimedWords: "The transcript has words without timing, so speakers can't be told apart by voice",
  sourceMissing: "Couldn't find the asset's source file",
  hashMismatch: "The hash of speakers.json doesn't match the one the Worker reported",
  wordCountMismatch: "speakers.json doesn't have the same number of words as the transcript",
  transcriptChanged: 'The transcript changed after speakers were identified. Identify speakers again.',
  translationChanged: 'A translation changed after speakers were identified. Identify speakers again.',
  unknownSpeaker: "This speaker isn't in the proposal",
  nameInvalid: (p: { max: number }) => `Speaker names can't be empty and can be at most ${p.max} characters`,
  applyFailed: "Couldn't apply the proposal",
};

export type JobsSpeakersMessages = typeof en;

export const JobsSpeakers = defineCatalog('jobsSpeakers', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
