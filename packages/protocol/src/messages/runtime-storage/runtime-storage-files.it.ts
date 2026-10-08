import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const it: RuntimeStorageFilesMessages = {
  markerNotJson: "non è JSON",
  markerNotObject: "non è un oggetto",
  markerFormat: (p) => `format non è ${p.format}`,
  markerSchemaVersion: "schemaVersion non valido",
  markerProjectId: "projectId non valido",
  markerCreatedAt: "createdAt non valido",
  settingsInvalid: "Impostazioni non valide",
};
