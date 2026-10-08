import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './harness-agents.zh-Hans.ts';
import { zhHant } from './harness-agents.zh-Hant.ts';
import { ja } from './harness-agents.ja.ts';
import { ko } from './harness-agents.ko.ts';
import { es } from './harness-agents.es.ts';
import { fr } from './harness-agents.fr.ts';
import { de } from './harness-agents.de.ts';
import { nl } from './harness-agents.nl.ts';
import { ptBR } from './harness-agents.pt-BR.ts';
import { it } from './harness-agents.it.ts';
import { ru } from './harness-agents.ru.ts';
import { pl } from './harness-agents.pl.ts';
import { tr } from './harness-agents.tr.ts';
import { vi } from './harness-agents.vi.ts';

/** Agent、发送、任务合同与审批相关的拒绝原因（`packages/harness`）。`agent` 是 Agent 的显示名。 */
const en = {
  listSeparator: ', ',
  noDriver: (p: { id: string }) => `No Agent is registered with id ${p.id}`,
  probeFailed: (p: { error: string }) => `Detection failed: ${p.error}`,
  cannotChangeAgent: "This session has already started, so its Agent can't be changed. Start a new session to choose another.",
  noBudgetLedger: "This Runtime has no task budget ledger, so budgets can't be set",
  driverGone: (p: { id: string }) =>
    `Agent ${p.id} was removed or isn't registered, so this session can't send anymore. Start a new session with another Agent.`,
  driverUnverified: (p: { agent: string }) =>
    `${p.agent} hasn't passed BaoCut's integration tests yet. Only its detection results are shown, and it can't start sessions.`,
  fullAccessOnly: (p: { agent: string; fullAccess: string; current: string }) =>
    `${p.agent} can't ask for approval step by step, so it only runs in "${p.fullAccess}" mode (currently "${p.current}"). Switch to "${p.fullAccess}" and send again, or use another Agent.`,
  runtimeStopping: 'The Runtime is stopping',
  sessionBusy: 'A task is still running in this session. Stop it or wait for it to finish.',
  sessionBusyOther: 'This session is running another task. Stop it or wait for it to finish.',
  oldTaskNotStopped: "The old task hasn't stopped yet. Try again later",
  attachmentsUnsupported: "This version can't send image attachments yet",
  attachmentDuplicate: 'Each attachment can be included only once per message',
  tooManyImages: (p: { max: number }) => `A message can include at most ${p.max} images`,
  imagesUnsupported: "This Agent doesn't support images",
  contractRevisionMissing: (p: { revision: number; latest: number }) =>
    `The task contract has no revision ${p.revision} (latest is ${p.latest})`,
  taskEnded: "The task has ended (or is stopping), so its contract can't be changed. To change the goal, use tasks.changeGoal",
  contractRevisionStale: (p: { latest: number; expected: number }) =>
    `The contract is already at revision ${p.latest}, not ${p.expected}. Read it again before changing it`,
  checkMissing: (p: { id: string }) => `The task contract has no such check: ${p.id}`,
  taskNotFound: (p: { id: string }) => `Task not found: ${p.id}`,
  approvalNotFound: (p: { id: string }) => `Approval not found: ${p.id}`,
  builtinId: (p: { id: string }) => `${p.id} is a built-in Agent id. Choose another`,
  agentExists: (p: { id: string }) => `An Agent with id ${p.id} already exists`,
  builtinNotRemovable: (p: { agent: string }) => `${p.agent} is built in and can't be removed. You can turn it off in Settings`,
  agentMissing: (p: { id: string }) => `No Agent has id ${p.id}`,
  providersUnsupported: "This Runtime can't add or remove Agents",
  modelMissing: (p: { agent: string; model: string; choices: string }) => `${p.agent} has no model "${p.model}". Choose from ${p.choices}`,
  effortMissing: (p: { model: string; effort: string; choices: string }) =>
    `Model "${p.model}" has no reasoning effort "${p.effort}". Choose from ${p.choices}`,
  effortUnsupported: (p: { model: string }) => `Model "${p.model}" doesn't have reasoning effort levels`,
  approvalNoGrant: "This approval doesn't send data out, so it can't include a grant choice",
  contractFieldsReadonly: (p: { fields: string }) =>
    `The Agent can't change these task contract fields: ${p.fields}. Only the user decides access mode, permission scope, budget, and protected ranges`,
};

export type HarnessAgentsMessages = typeof en;

export const HarnessAgents = defineCatalog('harnessAgents', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
