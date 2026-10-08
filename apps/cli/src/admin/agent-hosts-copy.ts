import { defineMessages } from '@baocut/protocol';
import { zhHans } from './agent-hosts-copy.zh-Hans.ts';
import { zhHant } from './agent-hosts-copy.zh-Hant.ts';
import { ja } from './agent-hosts-copy.ja.ts';
import { ko } from './agent-hosts-copy.ko.ts';
import { es } from './agent-hosts-copy.es.ts';
import { fr } from './agent-hosts-copy.fr.ts';
import { de } from './agent-hosts-copy.de.ts';
import { nl } from './agent-hosts-copy.nl.ts';
import { ptBR } from './agent-hosts-copy.pt-BR.ts';
import { it } from './agent-hosts-copy.it.ts';
import { ru } from './agent-hosts-copy.ru.ts';
import { pl } from './agent-hosts-copy.pl.ts';
import { tr } from './agent-hosts-copy.tr.ts';
import { vi } from './agent-hosts-copy.vi.ts';

/** 外部 Agent 宿主（`agent-hosts.ts`）报的错（英文是键与类型的来源，译文在 `agent-hosts-copy.<语言>.ts`）。 */
const en = {
  missingAgent: (hosts: readonly string[]) => `Missing --agent: one of ${hosts.join(', ')}`,
  unknownAgent: (value: string, hosts: readonly string[]) => `Unknown agent "${value}": only ${hosts.join(', ')}`,
  invalidJson: (file: string, reason: string) => `${file} isn't valid JSON; nothing was changed: ${reason}`,
  notObject: (file: string) => `The top level of ${file} isn't an object; nothing was changed`,
};

export type AgentHostsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
