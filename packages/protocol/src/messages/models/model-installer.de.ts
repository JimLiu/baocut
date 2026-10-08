import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const de: ModelsModelInstallerMessages = {
  noSpace: "Die Festplatte mit dem Modellordner ist voll",
  noManifest: (p: { repo: string; revision: string }) => `Kein integriertes Manifest für ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `Im integrierten Manifest für ${p.repo} fehlt ein vertrauenswürdiger sha256`,
  noBundle: (p: { bundleId: string }) => `Kein solches Modellpaket: ${p.bundleId}`,
};
