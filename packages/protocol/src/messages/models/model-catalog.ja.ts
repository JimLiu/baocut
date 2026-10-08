import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const ja: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) =>
    `${p.backend} バックエンドは ${p.platform}/${p.arch} に対応していません`,
  relocating: 'モデルフォルダを移動中です。移動が終わるまで使えません',
  missingComponent: (p: { name: string; detail: string }) => `${p.name}（${p.detail}）`,
  listSeparator: '、',
  incomplete: (p: { names: string }) => `不足しているコンポーネント：${p.names}。インストールでは不足分だけをダウンロードします`,
  workerMissing: 'Model Worker（model-worker）が見つかりません',
  noManifest: (p: { repo: string }) => `${p.repo} にマニフェストがありません`,
  wrongRevision: (p: { repo: string; revision: string }) => `${p.repo} のバージョンが ${p.revision} ではありません`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo} に ${p.file} がありません`,
  sizeMismatch: (p: { repo: string; file: string }) => `${p.repo} の ${p.file} のサイズが一致しません`,
  noBundle: (p: { bundleId: string }) => `そのモデルバンドルはありません：${p.bundleId}`,
  moving: 'モデルフォルダを移動中です',
  notInstalled: (p: { repo: string }) => `モデル ${p.repo} はインストールされていません`,
  noFilesInSubdir: (p: { subdir: string }) => `モデルの ${p.subdir}/ にファイルがありません`,
};
