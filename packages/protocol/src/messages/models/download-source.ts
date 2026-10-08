import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './download-source.zh-Hans.ts';
import { zhHant } from './download-source.zh-Hant.ts';
import { ja } from './download-source.ja.ts';
import { ko } from './download-source.ko.ts';
import { es } from './download-source.es.ts';
import { fr } from './download-source.fr.ts';
import { de } from './download-source.de.ts';
import { nl } from './download-source.nl.ts';
import { ptBR } from './download-source.pt-BR.ts';
import { it } from './download-source.it.ts';
import { ru } from './download-source.ru.ts';
import { pl } from './download-source.pl.ts';
import { tr } from './download-source.tr.ts';
import { vi } from './download-source.vi.ts';

/** `packages/models/src/download-source.ts` 给人看的文字：模型下载来源的错误。 */
const en = {
  invalidEndpoint: (p: { name: string }) => `${p.name} must be a base URL starting with http(s)://, without credentials, query parameters, or a fragment`,
};

export type ModelsDownloadSourceMessages = typeof en;

export const ModelsDownloadSource = defineCatalog('modelsDownloadSource', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
