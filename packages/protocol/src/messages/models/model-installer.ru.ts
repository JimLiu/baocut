import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const ru: ModelsModelInstallerMessages = {
  noSpace: "На диске с папкой моделей нет свободного места",
  noManifest: (p: { repo: string; revision: string }) => `Нет встроенного манифеста для ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `Во встроенном манифесте для ${p.repo} отсутствует доверенный sha256`,
  noBundle: (p: { bundleId: string }) => `Нет такого пакета модели: ${p.bundleId}`,
};
