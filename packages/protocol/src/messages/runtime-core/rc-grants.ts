import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-grants.zh-Hans.ts';
import { zhHant } from './rc-grants.zh-Hant.ts';
import { ja } from './rc-grants.ja.ts';
import { ko } from './rc-grants.ko.ts';
import { es } from './rc-grants.es.ts';
import { fr } from './rc-grants.fr.ts';
import { de } from './rc-grants.de.ts';
import { nl } from './rc-grants.nl.ts';
import { ptBR } from './rc-grants.pt-BR.ts';
import { it } from './rc-grants.it.ts';
import { ru } from './rc-grants.ru.ts';
import { pl } from './rc-grants.pl.ts';
import { tr } from './rc-grants.tr.ts';
import { vi } from './rc-grants.vi.ts';

/** 外发的数据种类在英文里的说法（`kinds` 参数是逗号分隔的种类代码，按读者的语言展开）。 */
const EN_KINDS: Readonly<Record<string, string>> = {
  transcript: 'transcripts and translations',
  frames: 'video frames and thumbnails',
  audio: 'audio',
  video: 'the original video',
  document: 'text and prompts',
  context: 'agent conversation context',
};

function enKinds(codes: string): string {
  const labels = codes
    .split(',')
    .filter(Boolean)
    .map((k) => EN_KINDS[k] ?? k);
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels);
}

/** 授权与预算（grants/）的错误与补救说明。英文是键与类型的来源，译文在 `rc-grants.<语言>.ts`。 */
const en = {
  dataKinds: (p: { kinds: string }) => enKinds(p.kinds),

  // 提交时的拒绝（grantRpcError）
  grantLapsed: (p: { kinds: string; label: string; expired: boolean }) =>
    `The grant to send ${enKinds(p.kinds)} to ${p.label} has ${p.expired ? 'expired' : 'been revoked'}`,
  grantRequired: (p: { kinds: string; label: string }) => `Sending ${enKinds(p.kinds)} to ${p.label} needs the user's grant`,
  grantCallsUsedUp: (p: { used: number; max: number | null }) =>
    `The grant's call limit (${p.used}/${p.max}) is used up, so this call would exceed the budget`,
  grantAmountUsedUp: "The grant's amount limit is used up, so this call would exceed the budget",
  budgetUnverifiable: (p: { label: string }) =>
    `The grant has an amount limit, but this ${p.label} model has no reliable price, so staying within it can't be guaranteed`,
  taskCallsUsedUp: (p: { used: number; max: number | null }) =>
    `This task's call budget (${p.used}/${p.max}) is used up, so this call would exceed the task budget`,
  taskAmountUsedUp: (p: { amount: string; currency: string }) =>
    `This task's amount budget (${p.amount} ${p.currency}) is used up, so this call would exceed the task budget`,
  taskBudgetUnverifiable: (p: { currency: string }) =>
    `This task's budget has an amount limit, but this call's cost can't be estimated in ${p.currency}, so staying within it can't be guaranteed`,
  combined: (p: { message: string; others: number }) =>
    `${p.message} (${p.others} more ${p.others === 1 ? 'transfer also needs' : 'transfers also need'} a grant)`,

  // 补救（remedy.hint）
  hintRevoked:
    "Revoked or expired grants aren't restored automatically. Ask the user to grant access again in BaoCut's Settings, or to approve this once in the session.",
  hintRequired:
    "Sending data out needs the user's grant (by data type, recipient, scope, and purpose). Ask the user to issue a grant in BaoCut's Settings, or to approve this once in the session.",
  hintExhausted:
    "A used-up budget isn't raised automatically. Ask the user to raise this grant's limit, or wait for calls in progress to finish (failed and cancelled calls release their reservations).",
  hintUnverifiable:
    'When the cost can\'t be estimated, the user can only approve each call (amount unknown), or issue a per-call grant with an unknown amount.',
  hintTaskExhausted:
    "A used-up task budget isn't raised automatically. Ask the user to raise this task's budget in the task contract, or wait for calls in progress to finish (failed and cancelled calls release their reservations).",
  hintTaskUnverifiable:
    "When a task budget has an amount limit, only calls whose cost can be estimated in the same currency are accepted, and it also can't be guaranteed once there are calls with unknown amounts or other currencies. Ask the user to remove the task budget's amount limit (keeping only the call limit), or switch to a model with a price.",
  hintServiceAuto:
    "An external service's auto level isn't a grant to send data out. Ask the user to issue a grant for this provider in BaoCut (data types, scope, and budget), or change the service level to ask to approve each call.",

  // 命令里的占位（按发出时的语言写进 remedy.commands）
  placeholderPurpose: '<purpose>',
  placeholderMaxCalls: '<higher call count>',
  placeholderBudget: '<higher amount>',
  placeholderCalls: '<call count>',

  // 任务开始时（JobError）
  grantLapsedBeforeStart: (p: { state: string }) =>
    `The grant ${p.state === 'expired' ? 'expired' : p.state === 'revoked' ? 'was revoked' : 'was narrowed'} before the task started, so no data was sent`,
  grantInvalidBeforeStart: 'The grant became invalid before the task started, so no data was sent',
  retrySkipped: (p: { reason: string }) => `The automatic retry didn't run: ${p.reason}`,
  ledgerUnsaved: "The grant ledger couldn't be written to disk, so no data was sent",
  providerDisabledBeforeStart: 'The provider was turned off before the task started, so no data was sent',

  // 授权服务（grant-service、pipeline-grants）
  noSuchGrant: 'No such grant',
  toolPurpose: (p: { tool: string }) => `Tool "${p.tool}"`,
  pipelinePurpose: (p: { label: string }) => `Pipeline "${p.label}"`,
};

export type RcGrantsMessages = typeof en;

export const RcGrants = defineCatalog('rcGrants', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
