import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './audio-cpp-catalog.zh-Hans.ts';
import { zhHant } from './audio-cpp-catalog.zh-Hant.ts';
import { ja } from './audio-cpp-catalog.ja.ts';
import { ko } from './audio-cpp-catalog.ko.ts';
import { es } from './audio-cpp-catalog.es.ts';
import { fr } from './audio-cpp-catalog.fr.ts';
import { de } from './audio-cpp-catalog.de.ts';
import { nl } from './audio-cpp-catalog.nl.ts';
import { ptBR } from './audio-cpp-catalog.pt-BR.ts';
import { it } from './audio-cpp-catalog.it.ts';
import { ru } from './audio-cpp-catalog.ru.ts';
import { pl } from './audio-cpp-catalog.pl.ts';
import { tr } from './audio-cpp-catalog.tr.ts';
import { vi } from './audio-cpp-catalog.vi.ts';

/** `packages/models/src/audio-cpp-catalog.ts` 与 `added-models.ts` 给人看的文字：audio.cpp 模型目录的许可说明与添加模型时的错误。 */
const en = {
  noLicense: 'No license listed',
  licenseMissing: "audio.cpp's license table doesn't list this model; check its license before commercial use",
  licenseCommercial: (p: { name: string }) => `${p.name}: commercial use allowed, per the audio.cpp license table`,
  licenseNonCommercial: (p: { name: string }) => `${p.name}: non-commercial use only, per the audio.cpp license table`,
  licenseConditional: (p: { name: string }) => `${p.name}: commercial use comes with conditions; read the license before commercial use`,
  licenseUnclear: (p: { name: string }) => `${p.name}: it isn't clear whether commercial use is allowed; check the license before commercial use`,
  licenseCustom: "You chose this file yourself, so its license isn't known; check it before commercial use",
  customLicenseName: 'Unknown license',
  unknownPackage: (p: { id: string }) => `audio.cpp's model catalog has no package ${p.id}`,
  builtinPackage: (p: { id: string }) => `${p.id} is already built in; install it from the model list`,
  idleFamily: (p: { family: string }) => `BaoCut can't use ${p.family} models yet`,
  noCustomFamily: (p: { family: string }) => `A file of your own can't be added as ${p.family}: only speech models that run from a single GGUF file can`,
  notHfAddress: 'Not a Hugging Face file address: paste the web address of the file, or write owner/repo/file.gguf',
  notGguf: 'Only .gguf files can be added; add multi-file models from the list',
  notLfs: (p: { file: string }) => `${p.file} isn't stored with Git LFS, so its checksum can't be read; download it yourself and add it as a file on this computer`,
  fileNotFound: (p: { file: string; repo: string }) => `${p.repo} has no file ${p.file}`,
  unreachable: (p: { repo: string; detail: string }) => `Couldn't read ${p.repo} from the download source (${p.detail})`,
  localUnreadable: "That file can't be read: it may have been moved, or it isn't a regular file",
  notAdded: (p: { bundleId: string }) => `${p.bundleId} is built in, so it can't be removed from the list`,
  stillInstalled: 'Delete the downloaded model first, then remove it from the list',
  installing: 'The model is downloading; stop the download first',
};

export type ModelsAudioCppCatalogMessages = typeof en;

export const ModelsAudioCppCatalog = defineCatalog('modelsAudioCppCatalog', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
