import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ja: ModelsModelServiceStoreMessages = {
  notMigrated: 'バージョン 1 のキーはまだ移行されていません',
  orderMismatch: 'order には、このプロバイダの既存のアカウントをそれぞれちょうど 1 回ずつ列挙する必要があります',
  credentialNotSaved: (p: { reason: string }) => `認証情報は保存されませんでした：${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} にそのアカウントはありません：${p.account}`,
};
