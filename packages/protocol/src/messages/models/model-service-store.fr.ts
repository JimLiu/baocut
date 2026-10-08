import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const fr: ModelsModelServiceStoreMessages = {
  notMigrated: "Les clés de la version 1 n’ont pas encore été migrées",
  orderMismatch: "order doit lister exactement une fois chaque compte existant de ce fournisseur",
  credentialNotSaved: (p: { reason: string }) => `L’identifiant n’a pas été enregistré : ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} n’a pas ce compte : ${p.account}`,
};
