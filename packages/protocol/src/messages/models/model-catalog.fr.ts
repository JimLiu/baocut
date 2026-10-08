import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const fr: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `La version de ${p.backend} : moteur ne prenant pas en charge ${p.platform}/${p.arch}`,
  relocating: "Le dossier des modèles est déplacé ; inutilisable jusqu’à la fin du déplacement",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ", ",
  incomplete: (p: { names: string }) => `Composants manquants : ${p.names}. L’installation télécharge seulement les composants manquants`,
  workerMissing: "Model Worker (model-worker) introuvable",
  noManifest: (p: { repo: string }) => `${p.repo} n’a aucun manifeste`,
  wrongRevision: (p: { repo: string; revision: string }) => `La version de ${p.repo} n’est pas ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} n’a pas ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `La taille de ${p.file} en ${p.repo} ne correspond pas`,
  noBundle: (p: { bundleId: string }) => `Paquet de modèle inconnu : ${p.bundleId}`,
  moving: "Le dossier des modèles est en cours de déplacement",
  notInstalled: (p: { repo: string }) => `Le modèle ${p.repo} n’est pas installé`,
  noFilesInSubdir: (p: { subdir: string }) => `Le modèle n’a aucun fichier sous ${p.subdir}/`,
};
