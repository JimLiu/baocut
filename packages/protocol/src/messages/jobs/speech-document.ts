import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './speech-document.zh-Hans.ts';
import { zhHant } from './speech-document.zh-Hant.ts';
import { ja } from './speech-document.ja.ts';
import { ko } from './speech-document.ko.ts';
import { es } from './speech-document.es.ts';
import { fr } from './speech-document.fr.ts';
import { de } from './speech-document.de.ts';
import { nl } from './speech-document.nl.ts';
import { ptBR } from './speech-document.pt-BR.ts';
import { it } from './speech-document.it.ts';
import { ru } from './speech-document.ru.ts';
import { pl } from './speech-document.pl.ts';
import { tr } from './speech-document.tr.ts';
import { vi } from './speech-document.vi.ts';

/** `packages/jobs/src/speech-document.ts`：写进视频的转写文档名与缺省的说话人名。 */
const en = {
  documentName: 'Transcript',
  speakerName: (p: { n: number }) => `Speaker ${p.n}`,
};

export type JobsSpeechDocumentMessages = typeof en;

export const JobsSpeechDocument = defineCatalog('jobsSpeechDocument', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
