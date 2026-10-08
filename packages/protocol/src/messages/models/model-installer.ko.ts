import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const ko: ModelsModelInstallerMessages = {
  noSpace: '모델 폴더가 있는 디스크의 공간이 부족합니다',
  noManifest: (p: { repo: string; revision: string }) => `${p.repo}@${p.revision}에 대한 기본 제공 매니페스트가 없습니다`,
  untrustedManifest: (p: { repo: string }) => `${p.repo}의 기본 제공 매니페스트에 신뢰할 수 있는 sha256이 없습니다`,
  noBundle: (p: { bundleId: string }) => `해당 모델 번들이 없습니다: ${p.bundleId}`,
};
