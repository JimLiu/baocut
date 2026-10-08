import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const fr: RuntimeStorageFilesMessages = {
  markerNotJson: "pas du JSON",
  markerNotObject: "pas un objet",
  markerFormat: (p: { format: string }) => `format n’est pas ${p.format}`,
  markerSchemaVersion: "schemaVersion invalide",
  markerProjectId: "projectId invalide",
  markerCreatedAt: "createdAt invalide",
  settingsInvalid: "Réglages invalides",
};
