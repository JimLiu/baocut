import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const it: ModelsModelServiceStoreMessages = {
  notMigrated: "Le chiavi della versione 1 non sono ancora state migrate",
  orderMismatch: "order deve elencare ogni account esistente di questo provider di servizi esattamente una volta",
  credentialNotSaved: (p: { reason: string }) => `La credenziale non è stata salvata: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} non ha questo account: ${p.account}`,
};
