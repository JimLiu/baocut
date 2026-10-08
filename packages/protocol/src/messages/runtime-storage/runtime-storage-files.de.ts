import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const de: RuntimeStorageFilesMessages = {
  markerNotJson: "kein JSON",
  markerNotObject: "kein Objekt",
  markerFormat: (p: { format: string }) => `format ist nicht ${p.format}`,
  markerSchemaVersion: "ungültige schemaVersion",
  markerProjectId: "ungültige projectId",
  markerCreatedAt: "ungültiges createdAt",
  settingsInvalid: "Ungültige Einstellungen",
};
