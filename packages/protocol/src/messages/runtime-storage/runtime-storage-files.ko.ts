import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const ko: RuntimeStorageFilesMessages = {
  markerNotJson: 'JSON이 아님',
  markerNotObject: '객체가 아님',
  markerFormat: (p) => `format이 ${p.format}이(가) 아님`,
  markerSchemaVersion: '잘못된 schemaVersion',
  markerProjectId: '잘못된 projectId',
  markerCreatedAt: '잘못된 createdAt',
  settingsInvalid: '잘못된 설정',
};
