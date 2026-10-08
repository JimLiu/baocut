import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const zhHant: RuntimeStorageFilesMessages = {
  markerNotJson: '不是 JSON',
  markerNotObject: '不是物件',
  markerFormat: (p) => `format 不是 ${p.format}`,
  markerSchemaVersion: 'schemaVersion 無效',
  markerProjectId: 'projectId 無效',
  markerCreatedAt: 'createdAt 無效',
  settingsInvalid: '設定無效',
};
