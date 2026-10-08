import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './usage-report.zh-Hans.ts';
import { zhHant } from './usage-report.zh-Hant.ts';
import { ja } from './usage-report.ja.ts';
import { ko } from './usage-report.ko.ts';
import { es } from './usage-report.es.ts';
import { fr } from './usage-report.fr.ts';
import { de } from './usage-report.de.ts';
import { nl } from './usage-report.nl.ts';
import { ptBR } from './usage-report.pt-BR.ts';
import { it } from './usage-report.it.ts';
import { ru } from './usage-report.ru.ts';
import { pl } from './usage-report.pl.ts';
import { tr } from './usage-report.tr.ts';
import { vi } from './usage-report.vi.ts';

/** `packages/models/src/usage-report.ts` 给人看的文字：用量报告里的行名。 */
const en = {
  noAccount: (p: { provider: string }) => `${p.provider} (no account)`,
};

export type ModelsUsageReportMessages = typeof en;

export const ModelsUsageReport = defineCatalog('modelsUsageReport', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
