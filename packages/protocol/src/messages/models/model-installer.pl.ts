import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const pl: ModelsModelInstallerMessages = {
  noSpace: "Na dysku z folderem modeli zabrakło miejsca",
  noManifest: (p: { repo: string; revision: string }) => `Brak wbudowanego manifestu dla ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `Wbudowany manifest dla ${p.repo} nie ma zaufanego sha256`,
  noBundle: (p: { bundleId: string }) => `Brak takiego pakietu modelu: ${p.bundleId}`,
};
