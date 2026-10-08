import { defineMessages, type CheckResult, type TaskContract } from '@baocut/protocol';
import { zhHans } from './tasks-copy.zh-Hans.ts';
import { zhHant } from './tasks-copy.zh-Hant.ts';
import { ja } from './tasks-copy.ja.ts';
import { ko } from './tasks-copy.ko.ts';
import { es } from './tasks-copy.es.ts';
import { fr } from './tasks-copy.fr.ts';
import { de } from './tasks-copy.de.ts';
import { nl } from './tasks-copy.nl.ts';
import { ptBR } from './tasks-copy.pt-BR.ts';
import { it } from './tasks-copy.it.ts';
import { ru } from './tasks-copy.ru.ts';
import { pl } from './tasks-copy.pl.ts';
import { tr } from './tasks-copy.tr.ts';
import { vi } from './tasks-copy.vi.ts';

/** `baocut tasks` 的文案（英文是键与类型的来源，译文在 `tasks-copy.<语言>.ts`）。 */
const en = {
  /** `baocut tasks --help` 的正文。 */
  help: `Usage:
  baocut tasks contract <task id> [--revision <n>]
                                   Show a task contract: goal, scope, constraints, do-not-change list,
                                   deliverables, access mode, budget and usage, acceptance checks and results
  baocut tasks history <task id>   Revision history of the contract (who changed which fields, and when)
  baocut tasks list --conversation <session id>
                                   Latest contract of each task in a session`,
  usage: 'Usage: baocut tasks contract <task id> [--revision <n>] | history <task id> | list --conversation <session id>',
  revisionPositive: '--revision must be a positive whole number',
  changeBy: { user: 'you', agent: 'the agent', runtime: 'Runtime (default)' } satisfies Record<TaskContract['change']['by'], string>,
  changeReason: {
    created: 'created',
    updated: 'changed',
    mode: 'switched access mode',
    goal: 'changed the goal',
  } satisfies Record<TaskContract['change']['reason'], string>,
  outcomeLabels: { passed: 'Passed', failed: 'Failed', skipped: 'Skipped' } satisfies Record<CheckResult['outcome'], string>,
  change: (by: string, reason: string, fields: readonly string[], at: string) =>
    `${reason} by ${by}${fields.length > 0 ? `: ${fields.join(', ')}` : ''}, ${at}`,
  wholeVideo: 'the whole video',
  entity: (id: string) => `entity ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `${paths.join(', ')} of entity ${id}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) =>
    `frames ${from}–${to} of sequence ${sequenceId}${trackIds.length ? ` (tracks ${trackIds.join(', ')})` : ''}`,
  protection: (id: string, videoId: string, what: string, note: string | null) =>
    `${id}  video ${videoId}: ${what}${note ? ` (${note})` : ''}`,
  noBudget: "No limit (only each grant's budget applies)",
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} reserved` : ''}${max !== null ? `/${max}` : ''} ${max === null && calls === 1 && !reserved ? 'call' : 'calls'}`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) =>
    `${calls}${spent ? `, ${spent} spent` : ''}${reserved ? `, ${reserved} reserved` : ''}${cap ? `, cap ${cap}` : ''}${unknownCostCalls ? ` (${unknownCostCalls} with unknown cost)` : ''}`,
  latest: 'latest',
  latestIs: (revision: number) => `latest is revision ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) =>
    `Task ${taskId}  contract revision ${revision} (${latest})  ${change}`,
  goal: (goal: string) => `Goal: ${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) =>
    `Session: ${conversationId}  Video: ${videoId ?? 'none'}${baseRevision ? ` (version ${baseRevision})` : ''}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) =>
    `Scope: ${s.videoId ? `video ${s.videoId}` : 'no video specified'}${s.sequenceId ? `, sequence ${s.sequenceId}` : ''}${s.itemIds.length ? `, selected ${s.itemIds.join(', ')}` : ''}${s.range ? `, ${s.range.from}–${s.range.to} s` : ''}`,
  access: (mode: string, scopeRef: string) => `Access mode: ${mode}  Permission scope: ${scopeRef}`,
  budgetLine: (budget: string) => `Budget: ${budget}`,
  supersedes: (taskId: string, stopped: boolean) =>
    `Supersedes: task ${taskId} (the old task's work ${stopped ? 'was stopped' : 'is kept as a candidate'})`,
  constraints: (empty: boolean): string => (empty ? 'Constraints: none' : 'Constraints:'),
  protectedRefs: (empty: boolean): string => (empty ? "Don't change: none" : "Don't change:"),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? ` (${language})` : ''}`,
  deliverables: (items: readonly string[]) => (items.length ? `Deliverables: ${items.join(', ')}` : 'Deliverables: not specified'),
  checks: (empty: boolean): string => (empty ? 'Acceptance checks: none' : 'Acceptance checks:'),
  outcome: (label: string, byAgent: boolean, note: string | null) =>
    `${label} (recorded by ${byAgent ? 'the agent' : 'you'}${note ? `: ${note}` : ''})`,
  notRecorded: 'not recorded',
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) =>
    `  ${id}  [${kind}${required ? ', required' : ''}] ${description} — ${outcome}`,
  noContracts: 'No contracts',
  historyLine: (revision: number, change: string, mode: string) => `Revision ${revision}  ${change}  mode ${mode}`,
  noTasks: 'This session has no tasks yet',
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  revision ${revision}  ${mode}  ${goal}`,
};

export type TasksMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
