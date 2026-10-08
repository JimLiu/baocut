import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const zhHans: ModelsModelServiceStoreMessages = {
  notMigrated: '第 1 版的密钥还没有迁移',
  orderMismatch: 'order 要恰好列出这个服务商现有的每个账号一次',
  credentialNotSaved: (p: { reason: string }) => `凭据没有保存：${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} 没有这个账号：${p.account}`,
};
