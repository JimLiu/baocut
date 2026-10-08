import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './model-assets.zh-Hans.ts';
import { zhHant } from './model-assets.zh-Hant.ts';
import { ja } from './model-assets.ja.ts';
import { ko } from './model-assets.ko.ts';
import { es } from './model-assets.es.ts';
import { fr } from './model-assets.fr.ts';
import { de } from './model-assets.de.ts';
import { nl } from './model-assets.nl.ts';
import { ptBR } from './model-assets.pt-BR.ts';
import { it } from './model-assets.it.ts';
import { ru } from './model-assets.ru.ts';
import { pl } from './model-assets.pl.ts';
import { tr } from './model-assets.tr.ts';
import { vi } from './model-assets.vi.ts';

/** `packages/models/src/model-assets.ts` 给人看的文字：随应用分发的文件缺失。 */
const en = {
  appFileMissing: (p: { what: string }) => `The ${p.what} that comes with the app is missing or unreadable, so BaoCut is not fully installed. Reinstall BaoCut`,
};

export type ModelsModelAssetsMessages = typeof en;

export const ModelsModelAssets = defineCatalog('modelsModelAssets', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
