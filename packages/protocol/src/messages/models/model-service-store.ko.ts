import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ko: ModelsModelServiceStoreMessages = {
  notMigrated: '버전 1의 키가 아직 마이그레이션되지 않았습니다',
  orderMismatch: 'order에는 이 서비스 공급자의 기존 계정을 각각 정확히 한 번씩 나열해야 합니다',
  credentialNotSaved: (p: { reason: string }) => `자격 증명을 저장하지 않았습니다: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider}에 해당 계정이 없습니다: ${p.account}`,
};
