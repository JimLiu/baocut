import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './subtitle-file.zh-Hans.ts';
import { zhHant } from './subtitle-file.zh-Hant.ts';
import { ja } from './subtitle-file.ja.ts';
import { ko } from './subtitle-file.ko.ts';
import { es } from './subtitle-file.es.ts';
import { fr } from './subtitle-file.fr.ts';
import { de } from './subtitle-file.de.ts';
import { nl } from './subtitle-file.nl.ts';
import { ptBR } from './subtitle-file.pt-BR.ts';
import { it } from './subtitle-file.it.ts';
import { ru } from './subtitle-file.ru.ts';
import { pl } from './subtitle-file.pl.ts';
import { tr } from './subtitle-file.tr.ts';
import { vi } from './subtitle-file.vi.ts';

/** `packages/jobs/src/pipelines/subtitle-file.ts` 给人看的文字。 */
const en = {
  tooLarge: (p: { bytes: number; limit: number }) => `The subtitle file is ${p.bytes} bytes, over the limit of ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `More than ${p.limit} subtitles`,
  invalidAt: (p: { line: number; problem: string }) => `Subtitle file line ${p.line}: ${p.problem}`,
  nul: "The file contains NUL characters and doesn't look like text subtitles",
  vttHeader: 'A WebVTT file must start with WEBVTT',
  vttHeaderBlank: 'Leave a blank line after the WEBVTT header before the subtitles',
  empty: 'The file has no subtitles',
  noTiming: 'This block has text but no timing line',
  tooManyIdLines: 'Only one number or identifier line can come before the timing line',
  srtIndex: (p: { id: string }) => `An SRT index line must be a number: ${p.id}`,
  badTiming: (p: { timing: string }) => `Malformed timing line: ${p.timing}`,
  endBeforeStart: 'The end time is before the start time',
  timingInText: 'A timing line appears in the subtitle text (a blank line may be missing between two subtitles)',
  cueTooLong: (p: { max: number }) => `A subtitle text is longer than ${p.max} characters`,
  minuteSecondRange: 'Minutes or seconds exceed 59',
};

export type JobsSubtitleFileMessages = typeof en;

export const JobsSubtitleFile = defineCatalog('jobsSubtitleFile', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
