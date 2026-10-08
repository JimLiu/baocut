import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const pl: ModelsModelServiceStoreMessages = {
  notMigrated: "Klucze z wersji 1 nie zostały jeszcze przeniesione",
  orderMismatch: "order musi zawierać każde istniejące konto tego dostawcy usług dokładnie raz",
  credentialNotSaved: (p: { reason: string }) => `Nie zapisano danych uwierzytelniających: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} nie ma takiego konta: ${p.account}`,
};
