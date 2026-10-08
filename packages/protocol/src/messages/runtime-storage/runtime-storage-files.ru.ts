import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const ru: RuntimeStorageFilesMessages = {
  markerNotJson: "не JSON",
  markerNotObject: "не объект",
  markerFormat: (p) => `format не равен ${p.format}`,
  markerSchemaVersion: "недопустимый schemaVersion",
  markerProjectId: "недопустимый projectId",
  markerCreatedAt: "недопустимый createdAt",
  settingsInvalid: "Недопустимые настройки",
};
