import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './runtime-storage-grants.zh-Hans.ts';
import { zhHant } from './runtime-storage-grants.zh-Hant.ts';
import { ja } from './runtime-storage-grants.ja.ts';
import { ko } from './runtime-storage-grants.ko.ts';
import { es } from './runtime-storage-grants.es.ts';
import { fr } from './runtime-storage-grants.fr.ts';
import { de } from './runtime-storage-grants.de.ts';
import { nl } from './runtime-storage-grants.nl.ts';
import { ptBR } from './runtime-storage-grants.pt-BR.ts';
import { it } from './runtime-storage-grants.it.ts';
import { ru } from './runtime-storage-grants.ru.ts';
import { pl } from './runtime-storage-grants.pl.ts';
import { tr } from './runtime-storage-grants.tr.ts';
import { vi } from './runtime-storage-grants.vi.ts';

/** 数据外发授权与任务预算的错误与说明（`packages/runtime-storage` 的 GrantStore）。 */
const en = {
  localNeedsNoGrant: "Local computation doesn't need a grant",
  dataKindRequired: 'Give at least one kind of data',
  budgetCapRequired: 'A grant with a spending cap needs budgetCap',
  unknownCostNoCap: "A grant with unknown cost can't have a spending cap. To set a cap, use estimate-cap",
  expiryPassed: 'The expiry time has already passed',
  grantNotFound: 'No such grant',
  grantRevoked: "The grant has been revoked and can't be changed. Issue a new one",
  cannotRemoveCap: "A grant with a spending cap can't drop its cap. Revoke it and issue a new grant with unknown cost",
  unknownCostCannotCap: "A grant with unknown cost can't set a spending cap. Revoke it and issue a new estimate-cap grant",
  cannotChangeCurrency: "The currency can't be changed",
  expiryPassedRevoke: 'The expiry time has already passed. To stop it now, revoke it',
  revokeNote:
    "After revoking, no new calls are made, and queued calls are rejected when they start. Data already sent to the provider and costs already incurred can't be undone locally; calls in progress finish as usual and count toward usage.",
  taskCallLimit: "The task budget's call limit must be a positive integer",
  providerGrantPurpose: (p: { label: string }) => `Issued by default when ${p.label} was turned on`,
  invalidCurrency: (p: { currency: string }) => `The currency must be three uppercase letters (ISO 4217): ${p.currency}`,
};

export type RuntimeStorageGrantsMessages = typeof en;

export const RuntimeStorageGrants = defineCatalog('runtimeStorageGrants', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
