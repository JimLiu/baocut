import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ko: ModelsModelServiceStoreMessages = {
  notMigrated: '버전 1의 키가 아직 마이그레이션되지 않았습니다',
  orderMismatch: 'order에는 이 서비스 공급자의 기존 계정을 각각 정확히 한 번씩 나열해야 합니다',
  credentialNotSaved: (p: { reason: string }) => `자격 증명을 저장하지 않았습니다: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider}에 해당 계정이 없습니다: ${p.account}`,
  accountLinked: (p: { home: string }) => `이 계정은 ${p.home}에서 연결되었습니다. 키를 바꾸거나 지우려면 그쪽에서 하세요`,
  linkSameHome: '같은 BaoCut 홈에서는 계정을 연결할 수 없습니다',
  linkSourceFileBacked: (p: { home: string }) => `${p.home}은(는) 키를 시스템 키체인이 아닌 파일에 저장합니다. 키체인을 쓰는 홈만 연결할 수 있습니다`,
  linkSourceEmpty: (p: { home: string }) => `${p.home}에서 BaoCut 모델 서비스 설정을 찾지 못했습니다`,
  linkNoMatch: (p: { home: string }) => `${p.home}에 일치하는 계정이 없습니다`,
  linkedHelperMissing: (p: { home: string }) => `${p.home}에서 연결한 계정의 키를 읽을 수 없습니다. 설치된 BaoCut 앱의 자격 증명 도우미를 찾지 못했습니다`,
  linkedSourceMissing: (p: { account: string; home: string }) => `연결된 계정 ${p.account}이(가) 더 이상 ${p.home}에 없습니다`,
  linkedKeyMissing: (p: { account: string; home: string }) => `연결된 계정 ${p.account}(${p.home}에서)의 키가 시스템 키체인에 없습니다`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `연결된 계정 ${p.account}(${p.home}에서)의 키를 읽을 수 없습니다: ${p.reason}`,
};
