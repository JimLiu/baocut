import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const ja: ModelsModelInstallerMessages = {
  noSpace: 'モデルフォルダがあるディスクの空き容量が不足しています',
  noManifest: (p: { repo: string; revision: string }) => `${p.repo}@${p.revision} の内蔵マニフェストがありません`,
  untrustedManifest: (p: { repo: string }) => `${p.repo} の内蔵マニフェストには信頼できる sha256 がありません`,
  noBundle: (p: { bundleId: string }) => `そのモデルバンドルはありません：${p.bundleId}`,
};
