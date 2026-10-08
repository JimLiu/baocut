import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const zhHans: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) => `${p.backend} 后端不支持 ${p.platform}/${p.arch}`,
  relocating: '正在移动模型目录，移完之前不能用',
  missingComponent: (p: { name: string; detail: string }) => `${p.name}（${p.detail}）`,
  listSeparator: '、',
  incomplete: (p: { names: string }) => `缺少组件：${p.names}；安装只下载缺的组件`,
  workerMissing: '没有找到 Model Worker（model-worker）',
  noManifest: (p: { repo: string }) => `${p.repo} 没有清单`,
  wrongRevision: (p: { repo: string; revision: string }) => `${p.repo} 的版本不是 ${p.revision}`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} 缺少 ${p.file}`,
  sizeMismatch: (p: { repo: string; file: string }) => `${p.repo} 的 ${p.file} 大小不符`,
  noBundle: (p: { bundleId: string }) => `没有这个模型包：${p.bundleId}`,
  moving: '正在移动模型目录',
  notInstalled: (p: { repo: string }) => `模型 ${p.repo} 没有安装`,
  noFilesInSubdir: (p: { subdir: string }) => `模型的 ${p.subdir}/ 下没有文件`,
};
