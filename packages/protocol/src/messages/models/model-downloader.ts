import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './model-downloader.zh-Hans.ts';
import { zhHant } from './model-downloader.zh-Hant.ts';
import { ja } from './model-downloader.ja.ts';
import { ko } from './model-downloader.ko.ts';
import { es } from './model-downloader.es.ts';
import { fr } from './model-downloader.fr.ts';
import { de } from './model-downloader.de.ts';
import { nl } from './model-downloader.nl.ts';
import { ptBR } from './model-downloader.pt-BR.ts';
import { it } from './model-downloader.it.ts';
import { ru } from './model-downloader.ru.ts';
import { pl } from './model-downloader.pl.ts';
import { tr } from './model-downloader.tr.ts';
import { vi } from './model-downloader.vi.ts';

/** `packages/models/src/model-downloader.ts` 给人看的文字：下载模型文件失败的原因与补救办法。 */
const en = {
  remedyNoSpace: 'The disk that holds the models folder is out of space. Free up enough space (or move the models folder to another disk in Settings), then install again',
  remedyNetwork: "Can't reach the network, or the download was interrupted. Check the network and install again; what's already downloaded resumes. You can also switch mirrors under “Model download source” in “Settings › General”",
  remedyIntegrity: 'A downloaded file does not match the size or sha256 in the manifest (the source or mirror has the wrong content). The bad file was deleted; switch to another download source and install again',
  remedySource: "The download source doesn't have this file or denied access. Check that the mirror set under “Model download source” in “Settings › General” (or the BAOCUT_MODELS_ENDPOINT environment variable) is complete",
  remedyManifestIncomplete: "The built-in manifest for this model bundle lacks a trusted sha256, so it can't be installed. Wait for a BaoCut update",
  downloadFailed: (p: { file: string; reason: string }) => `Couldn't download ${p.file}: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `The size or sha256 of ${p.file} does not match the manifest`,
  sourceHttp: (p: { file: string; status: number }) => `The download source returned HTTP ${p.status} for ${p.file}`,
  diskFull: 'The disk filled up while writing model files',
};

export type ModelsModelDownloaderMessages = typeof en;

export const ModelsModelDownloader = defineCatalog('modelsModelDownloader', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
