import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './video-create.zh-Hans.ts';
import { zhHant } from './video-create.zh-Hant.ts';
import { ja } from './video-create.ja.ts';
import { ko } from './video-create.ko.ts';
import { es } from './video-create.es.ts';
import { fr } from './video-create.fr.ts';
import { de } from './video-create.de.ts';
import { nl } from './video-create.nl.ts';
import { ptBR } from './video-create.pt-BR.ts';
import { it } from './video-create.it.ts';
import { ru } from './video-create.ru.ts';
import { pl } from './video-create.pl.ts';
import { tr } from './video-create.tr.ts';
import { vi } from './video-create.vi.ts';

/** `packages/jobs/src/pipelines/video-create.ts` 给人看的文字。 */
const en = {
  videoClosed: 'The video was closed, so nothing was imported: open the video and try again',
  noAsset: "The import didn't return an asset",
  notCompleted: (p: { state: string }) => `Transcription didn't complete (${p.state})`,
};

export type JobsVideoCreateMessages = typeof en;

export const JobsVideoCreate = defineCatalog('jobsVideoCreate', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
