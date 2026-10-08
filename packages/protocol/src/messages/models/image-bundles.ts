import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './image-bundles.zh-Hans.ts';
import { zhHant } from './image-bundles.zh-Hant.ts';
import { ja } from './image-bundles.ja.ts';
import { ko } from './image-bundles.ko.ts';
import { es } from './image-bundles.es.ts';
import { fr } from './image-bundles.fr.ts';
import { de } from './image-bundles.de.ts';
import { nl } from './image-bundles.nl.ts';
import { ptBR } from './image-bundles.pt-BR.ts';
import { it } from './image-bundles.it.ts';
import { ru } from './image-bundles.ru.ts';
import { pl } from './image-bundles.pl.ts';
import { tr } from './image-bundles.tr.ts';
import { vi } from './image-bundles.vi.ts';

/** `packages/models/src/image-bundles.ts` 给人看的文字：文生图模型包的许可摘要（模型名、许可证名、厂商名不翻译）。 */
const en = {
  qwenImageLicense: 'Non-commercial use only (research / evaluation); commercial use requires a separate request to Qwen. The MLX bundle is a derivative and falls under the same license',
};

export type ModelsImageBundlesMessages = typeof en;

export const ModelsImageBundles = defineCatalog('modelsImageBundles', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
