import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './common.zh-Hans.ts';
import { zhHant } from './common.zh-Hant.ts';
import { ja } from './common.ja.ts';
import { ko } from './common.ko.ts';
import { es } from './common.es.ts';
import { fr } from './common.fr.ts';
import { de } from './common.de.ts';
import { nl } from './common.nl.ts';
import { ptBR } from './common.pt-BR.ts';
import { it } from './common.it.ts';
import { ru } from './common.ru.ts';
import { pl } from './common.pl.ts';
import { tr } from './common.tr.ts';
import { vi } from './common.vi.ts';

/** `packages/jobs` 各处共用的片段：列表分隔符、「说明：原因」这类组合句。 */
const en = {
  /** 把几个 ID、名字连成一串时的分隔符（在用的时候读）。 */
  listSeparator: ', ',
  /** 一句说明后面接上原因（原因可以是别的消息引用，也可以是第三方原话）。 */
  withCause: (p: { message: string; cause: string }) => `${p.message}: ${p.cause}`,
};

export type JobsCommonMessages = typeof en;

export const JobsCommon = defineCatalog('jobsCommon', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
