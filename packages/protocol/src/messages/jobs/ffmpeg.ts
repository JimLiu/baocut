import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './ffmpeg.zh-Hans.ts';
import { zhHant } from './ffmpeg.zh-Hant.ts';
import { ja } from './ffmpeg.ja.ts';
import { ko } from './ffmpeg.ko.ts';
import { es } from './ffmpeg.es.ts';
import { fr } from './ffmpeg.fr.ts';
import { de } from './ffmpeg.de.ts';
import { nl } from './ffmpeg.nl.ts';
import { ptBR } from './ffmpeg.pt-BR.ts';
import { it } from './ffmpeg.it.ts';
import { ru } from './ffmpeg.ru.ts';
import { pl } from './ffmpeg.pl.ts';
import { tr } from './ffmpeg.tr.ts';
import { vi } from './ffmpeg.vi.ts';

/** `packages/jobs/src/pipelines/ffmpeg.ts` 给人看的文字。 */
const en = {
  notFound: (p: { command: string; remedy: string }) => `Can't find ${p.command}: ${p.remedy}`,
  ffmpegBroken: "ffmpeg isn't working properly",
  probeFailed: (p: { file: string }) => `ffprobe can't read ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg exited with ${p.code}`,
};

export type JobsFfmpegMessages = typeof en;

export const JobsFfmpeg = defineCatalog('jobsFfmpeg', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
