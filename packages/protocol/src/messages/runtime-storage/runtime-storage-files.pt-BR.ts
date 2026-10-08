import type { RuntimeStorageFilesMessages } from './runtime-storage-files.ts';

export const ptBR: RuntimeStorageFilesMessages = {
  markerNotJson: "não é JSON",
  markerNotObject: "não é um objeto",
  markerFormat: (p) => `format não é ${p.format}`,
  markerSchemaVersion: "schemaVersion inválido",
  markerProjectId: "projectId inválido",
  markerCreatedAt: "createdAt inválido",
  settingsInvalid: "Configurações inválidas",
};
