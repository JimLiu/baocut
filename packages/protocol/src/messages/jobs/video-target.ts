import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './video-target.zh-Hans.ts';
import { zhHant } from './video-target.zh-Hant.ts';
import { ja } from './video-target.ja.ts';
import { ko } from './video-target.ko.ts';
import { es } from './video-target.es.ts';
import { fr } from './video-target.fr.ts';
import { de } from './video-target.de.ts';
import { nl } from './video-target.nl.ts';
import { ptBR } from './video-target.pt-BR.ts';
import { it } from './video-target.it.ts';
import { ru } from './video-target.ru.ts';
import { pl } from './video-target.pl.ts';
import { tr } from './video-target.tr.ts';
import { vi } from './video-target.vi.ts';

/** `packages/jobs/src/pipelines/video-target.ts` 给人看的文字。 */
const en = {
  stepLabel: 'Resolve target',
  notSameVideo: 'refers to a different video than videoId',
  targetShapeOneOf: 'must be one of { videoId }, { entryId }, or { create }',
  createUnsupported: "This pipeline can't create a video: give an existing video (videoId or entryId)",
  createShape: 'must be { projectId, name? } or { conversationId, name? }',
  mediaNotAllowed: "can't be given: the media is this pipeline's result",
  unknownField: (p: { key: string }) => `has an unknown field ${p.key}`,
  scopeOnlyOne: 'accepts only one of projectId and conversationId',
  scopeRequired: 'needs projectId or conversationId',
  nameLength: 'must be 1 to 200 characters',
  mediaPath: 'must be an absolute path to a local media file',
};

export type JobsVideoTargetMessages = typeof en;

export const JobsVideoTarget = defineCatalog('jobsVideoTarget', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
