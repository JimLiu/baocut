import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const ptBR: ModelsModelInstallerMessages = {
  noSpace: "O disco que contém a pasta de modelos está sem espaço",
  noManifest: (p: { repo: string; revision: string }) => `Não há manifesto integrado para ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `${p.repo} tem um manifesto integrado sem sha256 confiável`,
  noBundle: (p: { bundleId: string }) => `Não existe este pacote de modelo: ${p.bundleId}`,
};
