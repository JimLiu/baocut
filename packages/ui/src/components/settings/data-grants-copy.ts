import { defineMessages } from '@baocut/protocol';
import { zhHans } from './data-grants-copy.zh-Hans.ts';
import { zhHant } from './data-grants-copy.zh-Hant.ts';
import { ja } from './data-grants-copy.ja.ts';
import { ko } from './data-grants-copy.ko.ts';
import { es } from './data-grants-copy.es.ts';
import { fr } from './data-grants-copy.fr.ts';
import { de } from './data-grants-copy.de.ts';
import { nl } from './data-grants-copy.nl.ts';
import { ptBR } from './data-grants-copy.pt-BR.ts';
import { it } from './data-grants-copy.it.ts';
import { ru } from './data-grants-copy.ru.ts';
import { pl } from './data-grants-copy.pl.ts';
import { tr } from './data-grants-copy.tr.ts';
import { vi } from './data-grants-copy.vi.ts';

/**
 * 设置 › 隐私 ›「数据外发授权」（data-grants.tsx）的文案。英文是键与类型的来源，译文在 `data-grants-copy.<语言>.ts`。
 * 撤销授权是 Revoke，不是界面通用的「撤销」（Undo）。
 */
const en = {
  title: 'Data sharing grants',
  showEnded: (count: number) => `Show ended (${count})`,
  lead: "Data sent to cloud providers needs a grant: one is issued by default when you enable a provider, and another when you choose “Always allow” during approval. After you revoke one, no new calls send data out; data and charges already sent can't be taken back. Local models need no grant.",
  loading: 'Loading grants…',
  disconnected: 'Not connected to Runtime',
  revoke: 'Revoke',
  noActive: 'No active grants',
  none: 'No grants yet',
  emptyDesc: 'Grants appear here once you enable a cloud provider, or choose “Always allow” during approval.',
  revokeTitle: (name: string) => `Revoke “${name}”?`,
  revokeFailed: (message: string) => `Couldn't revoke: ${message}`,
  cancel: 'Cancel',
};

export type DataGrantsMessages = typeof en;

export const GRANTS_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
