import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const vi: RuntimeStorageFilesMessages = {
markerNotJson: 'không phải JSON', markerNotObject: 'không phải đối tượng', markerFormat: (p) => `format không phải ${p.format}`, markerSchemaVersion: 'schemaVersion không hợp lệ', markerProjectId: 'projectId không hợp lệ', markerCreatedAt: 'createdAt không hợp lệ', settingsInvalid: 'Cài đặt không hợp lệ',
};
