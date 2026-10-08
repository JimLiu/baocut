import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const fr: ModelsModelInstallerMessages = {
  noSpace: "Le disque contenant le dossier des modèles est plein",
  noManifest: (p: { repo: string; revision: string }) => `Aucun manifeste intégré pour ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `Le manifeste intégré de ${p.repo} n’a pas de sha256 fiable`,
  noBundle: (p: { bundleId: string }) => `Paquet de modèle inconnu : ${p.bundleId}`,
};
