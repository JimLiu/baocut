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
};

export type ModelsModelServiceStoreMessages = typeof en;

export const ModelsModelServiceStore = defineCatalog('modelsModelServiceStore', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
