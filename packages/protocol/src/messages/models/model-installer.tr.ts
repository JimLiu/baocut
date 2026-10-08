import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const tr: ModelsModelInstallerMessages = {
  noSpace: 'Modeller klasörünün bulunduğu disk dolu',
  noManifest: (p: { repo: string; revision: string }) => `${p.repo}@${p.revision} için yerleşik bildirim yok`,
  untrustedManifest: (p: { repo: string }) => `${p.repo} için yerleşik bildirimde güvenilir sha256 yok`,
  noBundle: (p: { bundleId: string }) => `Böyle bir model paketi yok: ${p.bundleId}`,
};
