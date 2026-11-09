import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './model-service-store.zh-Hans.ts';
import { zhHant } from './model-service-store.zh-Hant.ts';
import { ja } from './model-service-store.ja.ts';
import { ko } from './model-service-store.ko.ts';
import { es } from './model-service-store.es.ts';
import { fr } from './model-service-store.fr.ts';
import { de } from './model-service-store.de.ts';
import { nl } from './model-service-store.nl.ts';
import { ptBR } from './model-service-store.pt-BR.ts';
import { it } from './model-service-store.it.ts';
import { ru } from './model-service-store.ru.ts';
import { pl } from './model-service-store.pl.ts';
import { tr } from './model-service-store.tr.ts';
import { vi } from './model-service-store.vi.ts';

/** `packages/models/src/model-service-store.ts` 给人看的文字：服务商账号与凭据的错误。 */
const en = {
  notMigrated: 'Keys from version 1 have not been migrated yet',
  orderMismatch: 'order must list each existing account of this service provider exactly once',
  credentialNotSaved: (p: { reason: string }) => `The credential was not saved: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} has no such account: ${p.account}`,
  accountLinked: (p: { home: string }) => `This account is linked from ${p.home}; change or remove its key there`,
  linkSameHome: 'Accounts cannot be linked from the same BaoCut home',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} keeps its keys in a file, not in the system keychain; only a home that uses the keychain can be linked`,
  linkSourceEmpty: (p: { home: string }) => `No BaoCut model service settings were found in ${p.home}`,
  linkNoMatch: (p: { home: string }) => `${p.home} has no matching account`,
  linkedHelperMissing: (p: { home: string }) => `Keys of accounts linked from ${p.home} can't be read: the credential helper of the installed BaoCut app was not found`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Linked account ${p.account} is no longer in ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `The key of linked account ${p.account} (from ${p.home}) is not in the system keychain`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `The key of linked account ${p.account} (from ${p.home}) can't be read: ${p.reason}`,
};

export type ModelsModelServiceStoreMessages = typeof en;

export const ModelsModelServiceStore = defineCatalog('modelsModelServiceStore', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
