import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const nl: ModelsModelServiceStoreMessages = {
  notMigrated: "Sleutels uit versie 1 zijn nog niet gemigreerd",
  orderMismatch: "order moet elk bestaand account van deze dienstaanbieder precies één keer bevatten",
  credentialNotSaved: (p: { reason: string }) => `De inloggegevens zijn niet opgeslagen: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} heeft dit account niet: ${p.account}`,
  accountLinked: (p: { home: string }) => `Dit account is gekoppeld vanuit ${p.home}; wijzig of verwijder de sleutel daar`,
  linkSameHome: 'Accounts kunnen niet worden gekoppeld vanuit dezelfde BaoCut-map',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} bewaart zijn sleutels in een bestand, niet in de sleutelhanger van het systeem; alleen een map die de sleutelhanger gebruikt kan worden gekoppeld`,
  linkSourceEmpty: (p: { home: string }) => `Geen BaoCut-instellingen voor modeldiensten gevonden in ${p.home}`,
  linkNoMatch: (p: { home: string }) => `${p.home} heeft geen overeenkomend account`,
  linkedHelperMissing: (p: { home: string }) => `Sleutels van accounts die vanuit ${p.home} zijn gekoppeld kunnen niet worden gelezen: de inloggegevenshelper van de geïnstalleerde BaoCut-app is niet gevonden`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Gekoppeld account ${p.account} staat niet meer in ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `De sleutel van gekoppeld account ${p.account} (uit ${p.home}) staat niet in de sleutelhanger van het systeem`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `De sleutel van gekoppeld account ${p.account} (uit ${p.home}) kan niet worden gelezen: ${p.reason}`,
};
