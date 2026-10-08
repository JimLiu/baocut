import { defineMessages, type Grant } from '@baocut/protocol';
import { zhHans } from './grants-copy.zh-Hans.ts';
import { zhHant } from './grants-copy.zh-Hant.ts';
import { ja } from './grants-copy.ja.ts';
import { ko } from './grants-copy.ko.ts';
import { es } from './grants-copy.es.ts';
import { fr } from './grants-copy.fr.ts';
import { de } from './grants-copy.de.ts';
import { nl } from './grants-copy.nl.ts';
import { ptBR } from './grants-copy.pt-BR.ts';
import { it } from './grants-copy.it.ts';
import { ru } from './grants-copy.ru.ts';
import { pl } from './grants-copy.pl.ts';
import { tr } from './grants-copy.tr.ts';
import { vi } from './grants-copy.vi.ts';

/** `baocut grants` 与 `baocut approvals allow --persist` 的文案（英文是键与类型的来源，译文在 `grants-copy.<语言>.ts`）。 */
const en = {
  /** `baocut grants --help` 的正文。 */
  help: `Usage:
  baocut grants [list]             List data-sharing grants (online and agent providers):
                                   recipient, data kinds, scope, usage, and budget
    --recipient <id>               Only this provider's grants
    --video <video id>             Only grants that cover this video
    --include-ended                Also list revoked, expired, and used-up grants
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   Issue a grant. Data kinds: transcript (transcripts and translations), frames (video frames),
                                   audio (audio), video (original video), document (text and prompts), context (agent context)
    --video <video id|all>         Only cover this video; omitted or all means all videos
    --max-calls <n>                Call limit; unlimited if omitted
    --budget <amount> --currency <currency>
                                   Spending limit: estimated and reserved from the model's pricing;
                                   calls to models without pricing are rejected (BUDGET_UNVERIFIABLE)
    --expires <ISO time>           Expiry time
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   Change a grant; narrowing it, lowering a limit, or moving the expiry
                                   earlier rejects calls queued under the old terms when they start
  baocut grants revoke <id>        Revoke a grant: later calls are no longer allowed; data already
                                   sent and costs already counted are reported as they are
  baocut grants usage <id>         A grant's usage and the tasks that used it (reservations and settlements)`,
  usage:
    'Usage: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]' +
    ' | update <grant id> [options] | revoke <grant id> | usage <grant id>]',
  listSep: ', ',
  missingRecipient: '--recipient is missing (the provider that receives the data, e.g. openai)',
  missingData: (kinds: readonly string[]) => `--data is missing (data kinds, comma-separated: ${kinds.join(', ')})`,
  missingPurpose: '--purpose is missing (one sentence for people to read)',
  recipientFixed: "The recipient can't be changed: revoke this grant and create a new one",
  nothingToUpdate: 'Nothing to change: give --data, --video, --purpose, --max-calls, --budget or --expires',
  persistOnly: '--scope, --max-calls, --budget and --expires only go with --persist',
  scopeChoices: '--scope takes video or all',
  unknownKinds: (unknown: string, kinds: readonly string[]) => `Unknown data kind: ${unknown}. Choose from ${kinds.join(', ')}`,
  maxCallsRange: '--max-calls must be a whole number from 1 to 1000000, or none (no limit)',
  currencyNeedsBudget: '--currency only goes with --budget',
  budgetFormat: '--budget must be a non-negative decimal amount with at most 6 decimal places (e.g. 5 or 2.50)',
  budgetNeedsCurrency: '--budget needs --currency <three-letter currency code, e.g. USD>',
  expiresFormat: '--expires must be an ISO time with a time zone (e.g. 2026-12-31T23:59:59Z), or none',
  stateLabels: {
    active: 'Active',
    expired: 'Expired',
    revoked: 'Revoked',
    exhausted: 'Used up',
  } satisfies Record<Grant['state'], string>,
  originLabels: {
    user: 'granted by you',
    approval: 'granted at approval',
    'provider-enable': 'default when enabled',
  } satisfies Record<Grant['origin'], string>,
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} reserved` : ''}${max !== null ? `/${max}` : ''} ${max === null && calls === 1 && !reserved ? 'call' : 'calls'}`,
  unknownCostCalls: (n: number) => ` (${n} with unknown cost)`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) =>
    `${calls}, ${amount}${reserved ? `+${reserved} reserved` : ''}/${cap} ${currency}`,
  noGrants: 'No grants: calls to online and agent providers will ask for approval (or create one with baocut grants create)',
  scopeVideo: (videoId: string) => `video ${videoId}`,
  scopeAll: 'all videos',
  grantLine: (g: {
    id: string;
    state: string;
    recipient: string;
    kinds: string;
    scope: string;
    taskId: string | null;
    once: boolean;
    usage: string;
    expiresAt: string | null;
    origin: string;
    purpose: string;
  }) =>
    `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, only task ${g.taskId}` : ''}${g.once ? ', this once only' : ''}  usage ${g.usage}${g.expiresAt ? `, expires ${g.expiresAt}` : ''}  (${g.origin}: ${g.purpose})`,
  revoked: (id: string, recipient: string, kinds: string) => `Revoked ${id} (${recipient} ← ${kinds})`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `Already sent: ${calls} ${calls === 1 ? 'call' : 'calls'}${amount ? `, ${amount} counted` : ''}${unknownCostCalls ? ` (${unknownCostCalls} with unknown cost)` : ''}`,
  runningJobs: (jobs: readonly string[]) => `Tasks still running (they'll finish as usual): ${jobs.join(', ')}`,
  noJobs: "(No task has used it yet, or the task records have been cleaned up)",
  settled: (calls: number, amount: string, basis: string) => `settled ${calls} ${calls === 1 ? 'call' : 'calls'} ${amount} (${basis})`,
  unsettled: 'not settled',
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) =>
    `  ${jobId}  ${state}  reserved ${calls} ${calls === 1 ? 'call' : 'calls'} ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) =>
    `    Sends: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (video ${a.videoId})` : ''}: ${a.purpose}${a.estimate ? `, estimated ${a.estimate}` : ', cost unknown'}${a.maxCalls !== null ? `, at most ${a.maxCalls} ${a.maxCalls === 1 ? 'call' : 'calls'}` : ''}${a.reason === 'revoked' ? ', grant revoked or expired' : a.reason === 'unverifiable' ? ", cost can't be estimated" : ''}`,
};

export type GrantsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
