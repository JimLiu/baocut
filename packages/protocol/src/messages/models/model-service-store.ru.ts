import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ru: ModelsModelServiceStoreMessages = {
  notMigrated: "Ключи из версии 1 ещё не перенесены",
  orderMismatch: "order должен содержать каждый существующий аккаунт этого поставщика сервисов ровно один раз",
  credentialNotSaved: (p: { reason: string }) => `Учётные данные не сохранены: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} — нет такого аккаунта: ${p.account}`,
};
