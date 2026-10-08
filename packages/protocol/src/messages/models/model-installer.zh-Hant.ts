import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const zhHant: ModelsModelInstallerMessages = {
  noSpace: '模型資料夾所在的磁碟空間不足',
  noManifest: (p: { repo: string; revision: string }) => `沒有 ${p.repo}@${p.revision} 的內建資訊清單`,
  untrustedManifest: (p: { repo: string }) => `${p.repo} 的內建資訊清單缺少可信的 sha256`,
  noBundle: (p: { bundleId: string }) => `沒有這個模型套件：${p.bundleId}`,
};
