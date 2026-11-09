import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const pl: ModelsModelServiceStoreMessages = {
  notMigrated: "Klucze z wersji 1 nie zostały jeszcze przeniesione",
  orderMismatch: "order musi zawierać każde istniejące konto tego dostawcy usług dokładnie raz",
  credentialNotSaved: (p: { reason: string }) => `Nie zapisano danych uwierzytelniających: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} nie ma takiego konta: ${p.account}`,
  accountLinked: (p: { home: string }) => `To konto jest połączone z ${p.home}; zmień lub usuń jego klucz tam`,
  linkSameHome: 'Nie można łączyć kont z tego samego folderu BaoCut',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} trzyma klucze w pliku, a nie w systemowym pęku kluczy; połączyć można tylko folder, który używa pęku kluczy`,
  linkSourceEmpty: (p: { home: string }) => `W ${p.home} nie ma ustawień usług modeli BaoCut`,
  linkNoMatch: (p: { home: string }) => `W ${p.home} nie ma pasującego konta`,
  linkedHelperMissing: (p: { home: string }) => `Nie można odczytać kluczy kont połączonych z ${p.home}: nie znaleziono pomocnika poświadczeń zainstalowanej aplikacji BaoCut`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Połączonego konta ${p.account} nie ma już w ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `Klucza połączonego konta ${p.account} (z ${p.home}) nie ma w systemowym pęku kluczy`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Nie można odczytać klucza połączonego konta ${p.account} (z ${p.home}): ${p.reason}`,
};
