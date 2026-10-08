import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const nl: RuntimeStorageFilesMessages = {
  markerNotJson: "geen JSON",
  markerNotObject: "geen object",
  markerFormat: (p: { format: string }) => `format is niet ${p.format}`,
  markerSchemaVersion: "ongeldige schemaVersion",
  markerProjectId: "ongeldige projectId",
  markerCreatedAt: "ongeldige createdAt",
  settingsInvalid: "Ongeldige instellingen",
};
