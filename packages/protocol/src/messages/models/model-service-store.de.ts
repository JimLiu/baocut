import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const de: ModelsModelServiceStoreMessages = {
  notMigrated: "Schlüssel aus Version 1 wurden noch nicht migriert",
  orderMismatch: "order muss jedes vorhandene Konto dieses Dienstanbieters genau einmal auflisten",
  credentialNotSaved: (p: { reason: string }) => `Zugangsdaten wurden nicht gespeichert: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} hat kein solches Konto: ${p.account}`,
};
