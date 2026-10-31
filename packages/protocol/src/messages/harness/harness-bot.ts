import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './harness-bot.zh-Hans.ts';
import { zhHant } from './harness-bot.zh-Hant.ts';
import { ja } from './harness-bot.ja.ts';
import { ko } from './harness-bot.ko.ts';
import { es } from './harness-bot.es.ts';
import { fr } from './harness-bot.fr.ts';
import { de } from './harness-bot.de.ts';
import { nl } from './harness-bot.nl.ts';
import { ptBR } from './harness-bot.pt-BR.ts';
import { it } from './harness-bot.it.ts';
import { ru } from './harness-bot.ru.ts';
import { pl } from './harness-bot.pl.ts';
import { tr } from './harness-bot.tr.ts';
import { vi } from './harness-bot.vi.ts';

/** Bot 模式在 Harness 里的文字（docs/design/bot-mode 技术方案 §4.2、§8.1）。 */
const en = {
  roleLocked: 'This conversation belongs to a Bot channel or task. Change it from the channel or task settings instead.',
  unattendedNeedsApprovals: (p: { agent: string }) =>
    `${p.agent} can't ask for approval step by step, so this step needs you to be here to run.`,
};

export type HarnessBotMessages = typeof en;

export const HarnessBot = defineCatalog('harnessBot', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
