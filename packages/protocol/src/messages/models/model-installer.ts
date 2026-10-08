import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './model-installer.zh-Hans.ts';
import { zhHant } from './model-installer.zh-Hant.ts';
import { ja } from './model-installer.ja.ts';
import { ko } from './model-installer.ko.ts';
import { es } from './model-installer.es.ts';
import { fr } from './model-installer.fr.ts';
import { de } from './model-installer.de.ts';
import { nl } from './model-installer.nl.ts';
import { ptBR } from './model-installer.pt-BR.ts';
import { it } from './model-installer.it.ts';
import { ru } from './model-installer.ru.ts';
import { pl } from './model-installer.pl.ts';
import { tr } from './model-installer.tr.ts';
import { vi } from './model-installer.vi.ts';

/** `packages/models/src/model-installer.ts` 给人看的文字：安装模型包时的错误。 */
const en = {
  noSpace: 'The disk that holds the models folder is out of space',
  noManifest: (p: { repo: string; revision: string }) => `There is no built-in manifest for ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `The built-in manifest for ${p.repo} lacks a trusted sha256`,
  noBundle: (p: { bundleId: string }) => `No such model bundle: ${p.bundleId}`,
};

export type ModelsModelInstallerMessages = typeof en;

export const ModelsModelInstaller = defineCatalog('modelsModelInstaller', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
