import { defineMessages, type RiskLevel } from '@baocut/protocol';
import { zhHans } from './approvals-copy.zh-Hans.ts';
import { zhHant } from './approvals-copy.zh-Hant.ts';
import { ja } from './approvals-copy.ja.ts';
import { ko } from './approvals-copy.ko.ts';
import { es } from './approvals-copy.es.ts';
import { fr } from './approvals-copy.fr.ts';
import { de } from './approvals-copy.de.ts';
import { nl } from './approvals-copy.nl.ts';
import { ptBR } from './approvals-copy.pt-BR.ts';
import { it } from './approvals-copy.it.ts';
import { ru } from './approvals-copy.ru.ts';
import { pl } from './approvals-copy.pl.ts';
import { tr } from './approvals-copy.tr.ts';
import { vi } from './approvals-copy.vi.ts';

/** 访问模式的命令行写法与 `baocut approvals` 的文案（英文是键与类型的来源，译文在 `approvals-copy.<语言>.ts`）。 */
const en = {
  /** `baocut approvals --help` 的正文。 */
  help: `Usage:
  baocut approvals                 List pending approvals, from sessions and from external services
  baocut approvals allow <id>      Allow a pending approval; approvals that share data
                                   are allowed only this once by default (amount unknown)
    --persist                      Also issue a standing grant (the same data sharing won't ask again)
    --scope <video|all>            Scope of the standing grant: the video of this call (default) or all videos
    --max-calls <n>                Call limit for the standing grant
    --budget <amount> --currency <currency>
                                   Spending limit for the standing grant (only for models with pricing;
                                   calls whose cost can't be estimated need approval each time)
    --expires <ISO time>           When the standing grant expires
  baocut approvals deny <id>       Deny a pending approval`,
  persistNeedsAllow: '--persist only goes with allow',
  alreadyResolved: (id: string) => `Approval ${id} was already handled, timed out or cancelled (or doesn't exist)`,
  allowed: (id: string) => `Allowed ${id}`,
  denied: (id: string) => `Denied ${id}`,
  unknownMode: (value: string, flags: readonly string[]) => `Unknown access mode: ${value}. --mode takes ${flags.join(', ')}`,
  mode: (label: string, flag: string) => `${label} (${flag})`,
  usage: 'Usage: baocut approvals [list | allow <approval id> | deny <approval id>]',
  riskLabels: { read: 'Read', edit: 'Edit', command: 'Command', high: 'High risk' } satisfies Record<RiskLevel, string>,
  none: 'No pending approvals',
  fromSession: (title: string) => `Session "${title}"`,
  fromService: (serviceId: string, clientName: string) => `Service ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `mode ${mode}`,
  basisLevel: (level: string) => `level ${level}`,
  approvalLine: (a: {
    id: string;
    who: string;
    action: string;
    targets: readonly string[];
    risk: string;
    summary: string;
    basis: string;
    secondsLeft: number | null;
  }) =>
    `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, denied automatically in ${a.secondsLeft} s`})`,
  runCommand: (command: string) => `Run command: ${command}`,
  changeFiles: (files: readonly string[]) => `Change files: ${files.join(', ')}`,
  callTool: (tool: string, files: readonly string[]) => `Call ${tool}${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};

export type ApprovalsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
