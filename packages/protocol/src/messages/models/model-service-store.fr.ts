import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const fr: ModelsModelServiceStoreMessages = {
  notMigrated: "Les clés de la version 1 n’ont pas encore été migrées",
  orderMismatch: "order doit lister exactement une fois chaque compte existant de ce fournisseur",
  credentialNotSaved: (p: { reason: string }) => `L’identifiant n’a pas été enregistré : ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} n’a pas ce compte : ${p.account}`,
  accountLinked: (p: { home: string }) => `Ce compte est lié depuis ${p.home} ; modifiez ou supprimez sa clé là-bas`,
  linkSameHome: 'Impossible de lier des comptes depuis le même dossier BaoCut',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} garde ses clés dans un fichier, pas dans le trousseau du système ; seul un dossier qui utilise le trousseau peut être lié`,
  linkSourceEmpty: (p: { home: string }) => `Aucun réglage de services de modèles BaoCut trouvé dans ${p.home}`,
  linkNoMatch: (p: { home: string }) => `${p.home} n’a aucun compte correspondant`,
  linkedHelperMissing: (p: { home: string }) => `Impossible de lire les clés des comptes liés depuis ${p.home} : l’assistant d’identifiants de l’app BaoCut installée est introuvable`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Le compte lié ${p.account} n’est plus dans ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `La clé du compte lié ${p.account} (depuis ${p.home}) n’est pas dans le trousseau du système`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Impossible de lire la clé du compte lié ${p.account} (depuis ${p.home}) : ${p.reason}`,
};
