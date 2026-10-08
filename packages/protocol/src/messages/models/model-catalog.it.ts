import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const it: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `${p.backend} non supporta come backend ${p.platform}/${p.arch}`,
  relocating: "La cartella dei modelli viene spostata; non può essere usata fino al termine dello spostamento",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ", ",
  incomplete: (p: { names: string }) => `Componenti mancanti: ${p.names}. L’installazione scarica solo i componenti mancanti`,
  workerMissing: "Model Worker (model-worker) non è stato trovato",
  noManifest: (p: { repo: string }) => `${p.repo} non ha un manifesto`,
  wrongRevision: (p: { repo: string; revision: string }) => `${p.repo} ha una versione diversa da ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} non ha ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `${p.repo}: ${p.file} ha una dimensione non corrispondente`,
  noBundle: (p: { bundleId: string }) => `Nessun pacchetto di modelli corrispondente: ${p.bundleId}`,
  moving: "La cartella dei modelli viene spostata",
  notInstalled: (p: { repo: string }) => `Il modello ${p.repo} non è installato`,
  noFilesInSubdir: (p: { subdir: string }) => `Il modello non ha file in ${p.subdir}/`,
};
