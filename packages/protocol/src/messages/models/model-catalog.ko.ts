import type { ModelsModelCatalogMessages } from './model-catalog.ts';

export const ko: ModelsModelCatalogMessages = {
  backendUnsupported: (p: { backend: string; platform: string; arch: string }) =>
    `${p.backend} 백엔드는 ${p.platform}/${p.arch} 환경을 지원하지 않습니다`,
  relocating: '모델 폴더를 옮기는 중입니다. 옮기기가 끝날 때까지 사용할 수 없습니다',
  missingComponent: (p: { name: string; detail: string }) => `${p.name}(${p.detail})`,
  listSeparator: ', ',
  incomplete: (p: { names: string }) => `빠진 구성 요소: ${p.names}. 설치하면 빠진 구성 요소만 다운로드합니다`,
  workerMissing: 'Model Worker(model-worker)를 찾을 수 없습니다',
  noManifest: (p: { repo: string }) => `${p.repo}에 매니페스트가 없습니다`,
  wrongRevision: (p: { repo: string; revision: string }) => `${p.repo}의 버전이 ${p.revision} 버전과 다릅니다`,
  missingFile: (p: { repo: string; file: string }) => `${p.repo}에 ${p.file} 파일이 없습니다`,
  sizeMismatch: (p: { repo: string; file: string }) => `${p.repo}의 ${p.file} 파일 크기가 일치하지 않습니다`,
  noBundle: (p: { bundleId: string }) => `해당 모델 번들이 없습니다: ${p.bundleId}`,
  moving: '모델 폴더를 옮기는 중입니다',
  notInstalled: (p: { repo: string }) => `${p.repo} 모델이 설치되어 있지 않습니다`,
  noFilesInSubdir: (p: { subdir: string }) => `모델의 ${p.subdir}/ 아래에 파일이 없습니다`,
};
