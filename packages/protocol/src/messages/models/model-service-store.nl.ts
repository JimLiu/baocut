import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const nl: ModelsModelServiceStoreMessages = {
  notMigrated: "Sleutels uit versie 1 zijn nog niet gemigreerd",
  orderMismatch: "order moet elk bestaand account van deze dienstaanbieder precies één keer bevatten",
  credentialNotSaved: (p: { reason: string }) => `De inloggegevens zijn niet opgeslagen: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} heeft dit account niet: ${p.account}`,
};
