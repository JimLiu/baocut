import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './job-application.zh-Hans.ts';
import { zhHant } from './job-application.zh-Hant.ts';
import { ja } from './job-application.ja.ts';
import { ko } from './job-application.ko.ts';
import { es } from './job-application.es.ts';
import { fr } from './job-application.fr.ts';
import { de } from './job-application.de.ts';
import { nl } from './job-application.nl.ts';
import { ptBR } from './job-application.pt-BR.ts';
import { it } from './job-application.it.ts';
import { ru } from './job-application.ru.ts';
import { pl } from './job-application.pl.ts';
import { tr } from './job-application.tr.ts';
import { vi } from './job-application.vi.ts';

/** `packages/jobs/src/job-application.ts`：把任务结果应用到视频时的错误。 */
const en = {
  applyFailed: "Couldn't write to the video",
  taskProtected: "The result touches content the task contract marks as do-not-change, so it wasn't written to the video",
  applicationCancelled: "The task has stopped, so the result wasn't applied automatically. The output is kept as a candidate.",
};

export type JobsApplicationMessages = typeof en;

export const JobsApplication = defineCatalog('jobsApplication', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
