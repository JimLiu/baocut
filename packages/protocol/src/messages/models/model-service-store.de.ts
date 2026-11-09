import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const de: ModelsModelServiceStoreMessages = {
  notMigrated: "Schlüssel aus Version 1 wurden noch nicht migriert",
  orderMismatch: "order muss jedes vorhandene Konto dieses Dienstanbieters genau einmal auflisten",
  credentialNotSaved: (p: { reason: string }) => `Zugangsdaten wurden nicht gespeichert: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} hat kein solches Konto: ${p.account}`,
  accountLinked: (p: { home: string }) => `Dieses Konto ist aus ${p.home} verknüpft; ändere oder entferne seinen Schlüssel dort`,
  linkSameHome: 'Konten können nicht aus demselben BaoCut-Ordner verknüpft werden',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} speichert seine Schlüssel in einer Datei, nicht im Schlüsselbund des Systems; verknüpfen lässt sich nur ein Ordner, der den Schlüsselbund nutzt`,
  linkSourceEmpty: (p: { home: string }) => `In ${p.home} wurden keine BaoCut-Einstellungen für Modelldienste gefunden`,
  linkNoMatch: (p: { home: string }) => `${p.home} hat kein passendes Konto`,
  linkedHelperMissing: (p: { home: string }) => `Schlüssel der aus ${p.home} verknüpften Konten lassen sich nicht lesen: Der Anmeldedaten-Helfer der installierten BaoCut-App wurde nicht gefunden`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Das verknüpfte Konto ${p.account} ist nicht mehr in ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `Der Schlüssel des verknüpften Kontos ${p.account} (aus ${p.home}) ist nicht im Schlüsselbund des Systems`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Der Schlüssel des verknüpften Kontos ${p.account} (aus ${p.home}) lässt sich nicht lesen: ${p.reason}`,
};
