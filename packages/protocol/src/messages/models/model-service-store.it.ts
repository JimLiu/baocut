import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const it: ModelsModelServiceStoreMessages = {
  notMigrated: "Le chiavi della versione 1 non sono ancora state migrate",
  orderMismatch: "order deve elencare ogni account esistente di questo provider di servizi esattamente una volta",
  credentialNotSaved: (p: { reason: string }) => `La credenziale non è stata salvata: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} non ha questo account: ${p.account}`,
  accountLinked: (p: { home: string }) => `Questo account è collegato da ${p.home}; modifica o rimuovi la sua chiave lì`,
  linkSameHome: 'Non si possono collegare account dalla stessa cartella di BaoCut',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} conserva le chiavi in un file, non nel portachiavi di sistema; si può collegare solo una cartella che usa il portachiavi`,
  linkSourceEmpty: (p: { home: string }) => `Nessuna impostazione dei servizi di modelli di BaoCut trovata in ${p.home}`,
  linkNoMatch: (p: { home: string }) => `${p.home} non ha account corrispondenti`,
  linkedHelperMissing: (p: { home: string }) => `Impossibile leggere le chiavi degli account collegati da ${p.home}: assistente credenziali dell’app BaoCut installata non trovato`,
  linkedSourceMissing: (p: { account: string; home: string }) => `L’account collegato ${p.account} non è più in ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `La chiave dell’account collegato ${p.account} (da ${p.home}) non è nel portachiavi di sistema`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Impossibile leggere la chiave dell’account collegato ${p.account} (da ${p.home}): ${p.reason}`,
};
