import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './runtime-storage-files.zh-Hans.ts';
import { zhHant } from './runtime-storage-files.zh-Hant.ts';
import { ja } from './runtime-storage-files.ja.ts';
import { ko } from './runtime-storage-files.ko.ts';
import { es } from './runtime-storage-files.es.ts';
import { fr } from './runtime-storage-files.fr.ts';
import { de } from './runtime-storage-files.de.ts';
import { nl } from './runtime-storage-files.nl.ts';
import { ptBR } from './runtime-storage-files.pt-BR.ts';
import { it } from './runtime-storage-files.it.ts';
import { ru } from './runtime-storage-files.ru.ts';
import { pl } from './runtime-storage-files.pl.ts';
import { tr } from './runtime-storage-files.tr.ts';
import { vi } from './runtime-storage-files.vi.ts';

/** 项目标记与偏好设置文件的校验说明（`packages/runtime-storage` 的 project-marker、settings-store）。 */
const en = {
  markerNotJson: 'not JSON',
  markerNotObject: 'not an object',
  markerFormat: (p: { format: string }) => `format isn't ${p.format}`,
  markerSchemaVersion: 'invalid schemaVersion',
  markerProjectId: 'invalid projectId',
  markerCreatedAt: 'invalid createdAt',
  settingsInvalid: 'Invalid settings',
};

export type RuntimeStorageFilesMessages = typeof en;

export const RuntimeStorageFiles = defineCatalog('runtimeStorageFiles', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
