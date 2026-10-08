import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const zhHans: ModelsModelInstallerMessages = {
  noSpace: '模型目录所在的磁盘空间不足',
  noManifest: (p: { repo: string; revision: string }) => `没有 ${p.repo}@${p.revision} 的内置清单`,
  untrustedManifest: (p: { repo: string }) => `${p.repo} 的内置清单缺少可信的 sha256`,
  noBundle: (p: { bundleId: string }) => `没有这个模型包：${p.bundleId}`,
};
