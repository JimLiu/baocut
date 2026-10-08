import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const pl: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `Element ${p.backend} – backend nie obsługuje ${p.platform}/${p.arch}`,
  relocating: "Folder modeli jest przenoszony; nie można go używać do zakończenia",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ", ",
  incomplete: (p: { names: string }) => `Brak komponentów: ${p.names}. Instalacja pobiera tylko brakujące komponenty`,
  workerMissing: "Nie znaleziono Model Worker (model-worker)",
  noManifest: (p: { repo: string }) => `${p.repo} nie ma manifestu`,
  wrongRevision: (p: { repo: string; revision: string }) => `Wersja ${p.repo} nie jest ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} nie zawiera ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `Rozmiar ${p.file} w ${p.repo} nie jest zgodny`,
  noBundle: (p: { bundleId: string }) => `Brak takiego pakietu modelu: ${p.bundleId}`,
  moving: "Folder modeli jest przenoszony",
  notInstalled: (p: { repo: string }) => `Model ${p.repo} nie jest zainstalowany`,
  noFilesInSubdir: (p: { subdir: string }) => `Model nie ma plików w ${p.subdir}/`,
};
