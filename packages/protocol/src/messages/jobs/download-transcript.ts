import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './download-transcript.zh-Hans.ts';
import { zhHant } from './download-transcript.zh-Hant.ts';
import { ja } from './download-transcript.ja.ts';
import { ko } from './download-transcript.ko.ts';
import { es } from './download-transcript.es.ts';
import { fr } from './download-transcript.fr.ts';
import { de } from './download-transcript.de.ts';
import { nl } from './download-transcript.nl.ts';
import { ptBR } from './download-transcript.pt-BR.ts';
import { it } from './download-transcript.it.ts';
import { ru } from './download-transcript.ru.ts';
import { pl } from './download-transcript.pl.ts';
import { tr } from './download-transcript.tr.ts';
import { vi } from './download-transcript.vi.ts';

/** `packages/jobs/src/pipelines/download-transcript.ts` 给人看的文字。 */
const en = {
  fileTranscribeUnavailable: 'File transcription is unavailable',
  notCompleted: "Transcription didn't complete; the video file was kept",
  resultMissing: "Can't find the transcription result",
  tooManySameName: (p: { name: string }) => `Too many files with the same name in the output folder: ${p.name}`,
};

export type JobsDownloadTranscriptMessages = typeof en;

export const JobsDownloadTranscript = defineCatalog('jobsDownloadTranscript', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
