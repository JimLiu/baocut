import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './model-catalog.zh-Hans.ts';
import { zhHant } from './model-catalog.zh-Hant.ts';
import { ja } from './model-catalog.ja.ts';
import { ko } from './model-catalog.ko.ts';
import { es } from './model-catalog.es.ts';
import { fr } from './model-catalog.fr.ts';
import { de } from './model-catalog.de.ts';
import { nl } from './model-catalog.nl.ts';
import { ptBR } from './model-catalog.pt-BR.ts';
import { it } from './model-catalog.it.ts';
import { ru } from './model-catalog.ru.ts';
import { pl } from './model-catalog.pl.ts';
import { tr } from './model-catalog.tr.ts';
import { vi } from './model-catalog.vi.ts';

/** `packages/models/src/model-catalog.ts` 给人看的文字：模型包不可用的原因与取模型包描述时的错误。 */
const en = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `The ${p.backend} backend does not support ${p.platform}/${p.arch}`,
  relocating: "The models folder is being moved; it can't be used until the move finishes",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ', ',
  incomplete: (p: { names: string }) => `Missing components: ${p.names}. Installing downloads only the missing components`,
  workerMissing: 'Model Worker (model-worker) was not found',
  noManifest: (p: { repo: string }) => `${p.repo} has no manifest`,
  wrongRevision: (p: { repo: string; revision: string }) => `The version of ${p.repo} is not ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} is missing ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `The size of ${p.file} in ${p.repo} does not match`,
  noBundle: (p: { bundleId: string }) => `No such model bundle: ${p.bundleId}`,
  moving: 'The models folder is being moved',
  notInstalled: (p: { repo: string }) => `Model ${p.repo} is not installed`,
  noFilesInSubdir: (p: { subdir: string }) => `The model has no files under ${p.subdir}/`,
};

export type ModelsModelCatalogMessages = typeof en;

export const ModelsModelCatalog = defineCatalog('modelsModelCatalog', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
