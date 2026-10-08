import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './generated-import.zh-Hans.ts';
import { zhHant } from './generated-import.zh-Hant.ts';
import { ja } from './generated-import.ja.ts';
import { ko } from './generated-import.ko.ts';
import { es } from './generated-import.es.ts';
import { fr } from './generated-import.fr.ts';
import { de } from './generated-import.de.ts';
import { nl } from './generated-import.nl.ts';
import { ptBR } from './generated-import.pt-BR.ts';
import { it } from './generated-import.it.ts';
import { ru } from './generated-import.ru.ts';
import { pl } from './generated-import.pl.ts';
import { tr } from './generated-import.tr.ts';
import { vi } from './generated-import.vi.ts';

/** `packages/jobs/src/generated-import.ts`：没给名字时生成结果导入视频用的素材名。 */
const en = {
  voiceOverName: (p: { head: string }) => `Voice-over: ${p.head}`,
  imageName: (p: { head: string }) => `Image: ${p.head}`,
};

export type JobsGeneratedImportMessages = typeof en;

export const JobsGeneratedImport = defineCatalog('jobsGeneratedImport', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
