import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './local-image.zh-Hans.ts';
import { zhHant } from './local-image.zh-Hant.ts';
import { ja } from './local-image.ja.ts';
import { ko } from './local-image.ko.ts';
import { es } from './local-image.es.ts';
import { fr } from './local-image.fr.ts';
import { de } from './local-image.de.ts';
import { nl } from './local-image.nl.ts';
import { ptBR } from './local-image.pt-BR.ts';
import { it } from './local-image.it.ts';
import { ru } from './local-image.ru.ts';
import { pl } from './local-image.pl.ts';
import { tr } from './local-image.tr.ts';
import { vi } from './local-image.vi.ts';

/** `packages/models/src/local-image.ts` 给人看的文字：本地文生图模型的耗时提示。 */
const en = {
  slowCpu: (p: { steps: number }) => `Generates on this computer's CPU with ${p.steps} steps: a 1024² image takes several hours, and even 512² takes about an hour; much faster with an NVIDIA GPU (CUDA)`,
  slowLocal: (p: { steps: number }) => `Generates on this computer with ${p.steps} steps: each image takes a few minutes to over ten minutes`,
};

export type ModelsLocalImageMessages = typeof en;

export const ModelsLocalImage = defineCatalog('modelsLocalImage', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
