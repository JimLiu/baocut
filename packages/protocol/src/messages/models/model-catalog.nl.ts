import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const nl: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `${p.backend}-backend ondersteunt niet ${p.platform}/${p.arch}`,
  relocating: "De modellenmap wordt verplaatst; die kan pas worden gebruikt wanneer dat klaar is",
  missingComponent: (p: { name: string; detail: string }) => `${p.name} (${p.detail})`,
  listSeparator: ", ",
  incomplete: (p: { names: string }) => `Ontbrekende componenten: ${p.names}. Bij het installeren worden alleen de ontbrekende componenten gedownload`,
  workerMissing: "Model Worker (model-worker) is niet gevonden",
  noManifest: (p: { repo: string }) => `${p.repo} heeft geen manifest`,
  wrongRevision: (p: { repo: string; revision: string }) => `De versie van ${p.repo} is niet ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} mist ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `De grootte van ${p.file} in ${p.repo} komt niet overeen`,
  noBundle: (p: { bundleId: string }) => `Dit modelpakket bestaat niet: ${p.bundleId}`,
  moving: "De modellenmap wordt verplaatst",
  notInstalled: (p: { repo: string }) => `Model ${p.repo} is niet geïnstalleerd`,
  noFilesInSubdir: (p: { subdir: string }) => `Het model heeft geen bestanden onder ${p.subdir}/`,
};
