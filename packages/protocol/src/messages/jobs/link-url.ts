import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './link-url.zh-Hans.ts';
import { zhHant } from './link-url.zh-Hant.ts';
import { ja } from './link-url.ja.ts';
import { ko } from './link-url.ko.ts';
import { es } from './link-url.es.ts';
import { fr } from './link-url.fr.ts';
import { de } from './link-url.de.ts';
import { nl } from './link-url.nl.ts';
import { ptBR } from './link-url.pt-BR.ts';
import { it } from './link-url.it.ts';
import { ru } from './link-url.ru.ts';
import { pl } from './link-url.pl.ts';
import { tr } from './link-url.tr.ts';
import { vi } from './link-url.vi.ts';

/** `packages/jobs/src/pipelines/link-url.ts` 给人看的文字。 */
const en = {
  startsWithDash: "A link can't start with -",
  invalidLink: 'Not a valid link',
  httpOnly: 'Only http(s):// links are accepted',
  credentials: "Links can't include a username or password",
  noHost: 'The link has no host name',
  privateAddress: "Can't import from local, link-local, or private network addresses",
  redacted: '[link]',
  unresolvable: (p: { host: string }) => `Can't resolve host name ${p.host}: check the network and the link`,
  noAddresses: (p: { host: string }) => `Host name ${p.host} has no addresses`,
  resolvesPrivate: (p: { host: string }) => `${p.host} resolves to a local, link-local, or private network address; can't import from it`,
};

export type JobsLinkUrlMessages = typeof en;

export const JobsLinkUrl = defineCatalog('jobsLinkUrl', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
