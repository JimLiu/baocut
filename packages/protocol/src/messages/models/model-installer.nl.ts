import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const nl: ModelsModelInstallerMessages = {
  noSpace: "De schijf met de modellenmap is vol",
  noManifest: (p: { repo: string; revision: string }) => `Er is geen ingebouwd manifest voor ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `Het ingebouwde manifest voor ${p.repo} mist een vertrouwde sha256`,
  noBundle: (p: { bundleId: string }) => `Dit modelpakket bestaat niet: ${p.bundleId}`,
};
