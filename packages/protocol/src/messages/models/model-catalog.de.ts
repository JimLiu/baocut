import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const de: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `${p.backend}-Backend unterstützt nicht ${p.platform}/${p.arch}`,
  relocating: "Der Modellordner wird verschoben; er kann erst nach Abschluss verwendet werden",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ", ",
  incomplete: (p: { names: string }) => `Fehlende Komponenten: ${p.names}. Bei der Installation werden nur fehlende Komponenten heruntergeladen`,
  workerMissing: "Model Worker (model-worker) wurde nicht gefunden",
  noManifest: (p: { repo: string }) => `${p.repo} hat kein Manifest`,
  wrongRevision: (p: { repo: string; revision: string }) => `Die Version von ${p.repo} ist nicht ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} fehlt: ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `Die Größe von ${p.file} in ${p.repo} stimmt nicht überein`,
  noBundle: (p: { bundleId: string }) => `Kein solches Modellpaket: ${p.bundleId}`,
  moving: "Der Modellordner wird verschoben",
  notInstalled: (p: { repo: string }) => `Modell ${p.repo} ist nicht installiert`,
  noFilesInSubdir: (p: { subdir: string }) => `Das Modell hat keine Dateien unter ${p.subdir}/`,
};
