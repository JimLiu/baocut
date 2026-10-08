import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const zhHant: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `${p.backend} 後端不支援 ${p.platform}/${p.arch}`,
  relocating: '模型資料夾正在搬移，搬移完成前無法使用',
  missingComponent: (p: { name: string; detail: string }) => `${p.name}（${p.detail}）`,
  listSeparator: '、',
  incomplete: (p: { names: string }) => `缺少元件：${p.names}。安裝時只會下載缺少的元件`,
  workerMissing: '找不到 Model Worker（model-worker）',
  noManifest: (p: { repo: string }) => `${p.repo} 沒有資訊清單`,
  wrongRevision: (p: { repo: string; revision: string }) => `${p.repo} 的版本不是 ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} 缺少 ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `${p.repo} 中 ${p.file} 的大小不符`,
  noBundle: (p: { bundleId: string }) => `沒有這個模型套件：${p.bundleId}`,
  moving: '模型資料夾正在搬移',
  notInstalled: (p: { repo: string }) => `模型 ${p.repo} 尚未安裝`,
  noFilesInSubdir: (p: { subdir: string }) => `模型的 ${p.subdir}/ 下沒有檔案`,
};
