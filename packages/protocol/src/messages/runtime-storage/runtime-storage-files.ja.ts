import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const ja: RuntimeStorageFilesMessages = {
  markerNotJson: 'JSON ではない',
  markerNotObject: 'オブジェクトではない',
  markerFormat: (p) => `format が ${p.format} ではない`,
  markerSchemaVersion: 'schemaVersion が無効',
  markerProjectId: 'projectId が無効',
  markerCreatedAt: 'createdAt が無効',
  settingsInvalid: '設定が無効です',
};
