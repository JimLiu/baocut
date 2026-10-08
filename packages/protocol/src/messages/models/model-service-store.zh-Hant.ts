import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const zhHant: ModelsModelServiceStoreMessages = {
  notMigrated: '第 1 版的金鑰尚未遷移',
  orderMismatch: 'order 必須恰好列出這個供應商現有的每個帳號各一次',
  credentialNotSaved: (p: { reason: string }) => `憑證未儲存：${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} 沒有這個帳號：${p.account}`,
};
