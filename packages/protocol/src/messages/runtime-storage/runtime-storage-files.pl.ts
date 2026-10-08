import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const pl: RuntimeStorageFilesMessages = {
  markerNotJson: "to nie JSON",
  markerNotObject: "to nie obiekt",
  markerFormat: (p) => `format jest inny niż ${p.format}`,
  markerSchemaVersion: "nieprawidłowy schemaVersion",
  markerProjectId: "nieprawidłowy projectId",
  markerCreatedAt: "nieprawidłowy createdAt",
  settingsInvalid: "Nieprawidłowe ustawienia",
};
