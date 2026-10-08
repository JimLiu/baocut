import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const zhHans: RuntimeStorageFilesMessages = {
  markerNotJson: '不是 JSON',
  markerNotObject: '不是对象',
  markerFormat: (p) => `format 不是 ${p.format}`,
  markerSchemaVersion: 'schemaVersion 无效',
  markerProjectId: 'projectId 无效',
  markerCreatedAt: 'createdAt 无效',
  settingsInvalid: '设置不合法',
};
