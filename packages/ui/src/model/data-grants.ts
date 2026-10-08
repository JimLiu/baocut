import { defineMessages, GRANT_DATA_KIND_LABELS, live, type Grant, type GrantRevokeResult, type GrantState, type Money } from '@baocut/protocol';
import { zhHans } from './data-grants.zh-Hans.ts';
import { zhHant } from './data-grants.zh-Hant.ts';
import { ja } from './data-grants.ja.ts';
import { ko } from './data-grants.ko.ts';
import { es } from './data-grants.es.ts';
import { fr } from './data-grants.fr.ts';
import { de } from './data-grants.de.ts';
import { nl } from './data-grants.nl.ts';
import { ptBR } from './data-grants.pt-BR.ts';
import { it } from './data-grants.it.ts';
import { ru } from './data-grants.ru.ts';
import { pl } from './data-grants.pl.ts';
import { tr } from './data-grants.tr.ts';
import { vi } from './data-grants.vi.ts';

const times = (n: number) => (n === 1 ? '1 call' : `${n} calls`);

/** 数据外发授权的文案（英文是键与类型的来源，译文在 `data-grants.zh-Hans.ts`）。 */
const en = {
  state: { active: 'Active', expired: 'Expired', revoked: 'Revoked', exhausted: 'Limit reached' } as Record<GrantState, string>,
  kindList: (kinds: readonly string[]) => kinds.join(', '),
  noKinds: 'No data types',
  origin: {
    'provider-enable': 'Granted by default when the provider was turned on',
    approval: 'Granted on approval',
    user: 'Granted manually',
  } as Record<Grant['origin'], string>,
  oneVideoNamed: (name: string) => `Only the video “${name}”`,
  oneVideo: 'Only one video',
  allVideos: 'All videos',
  oneTask: 'Only one task',
  budgetCap: (amount: string) => `Spending limit ${amount}`,
  budgetUnknown: 'Cost unknown, counted by calls only',
  once: 'This time only',
  unlimited: 'Unlimited calls',
  maxCalls: (n: number) => `Up to ${times(n)}`,
  revokedOn: (day: string) => `Revoked ${day}`,
  expiredOn: (day: string) => `Expired ${day}`,
  expiresOn: (day: string) => `Expires ${day}`,
  neverUsed: 'Not used yet',
  usedWithAmount: (calls: number, amount: string) => `Used ${times(calls)} (${amount})`,
  used: (calls: number) => `Used ${times(calls)}`,
  reservedWithAmount: (calls: number, amount: string) => `${times(calls)} in progress (${amount} reserved)`,
  reserved: (calls: number) => `${times(calls)} in progress`,
  unknownCost: (calls: number) => `${times(calls)} with unknown cost`,
  usageSeparator: ', ',
  revokeConfirm: (running: number, sent: number) =>
    [
      'After you revoke it, new calls and queued calls that use this grant will be refused.',
      running ? `The ${times(running)} already running will finish normally.` : '',
      sent ? `Data already sent in ${times(sent)}, and any costs incurred, can’t be taken back.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  revoked: 'Revoked',
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `Previously sent ${times(calls)}${amount ? ` (${amount}${unknownCostCalls ? `, plus ${times(unknownCostCalls)} with unknown cost` : ''})` : ''}`,
  runningJobs: (n: number) => (n === 1 ? '1 running task will finish normally' : `${n} running tasks will finish normally`),
};
export type DataGrantsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 设置 → 隐私里的「数据外发授权」（架构设计 §12.5）：读 `grants` 主题里的每条授权，说清给了谁、哪些数据、多大范围、
 * 预算与用量；撤销之后已经交出的数据与费用照实说，无法抹除。设计稿没有这一块，样式沿用设置页的分组与行。
 */

const STATE_LABEL: Record<GrantState, string> = live(() => M.state);

export function grantStateLabel(state: GrantState): string {
  return STATE_LABEL[state];
}

/** 有效的在前，同一组里新发放的在前。`includeEnded` 为 false 时只列有效的。 */
export function listedGrants(grants: readonly Grant[], includeEnded: boolean): Grant[] {
  return grants
    .filter((g) => includeEnded || g.state === 'active')
    .sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active') || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** 已结束（到期、撤销、用完）的条数：「显示已结束的」旁边的数。 */
export function endedCount(grants: readonly Grant[]): number {
  return grants.filter((g) => g.state !== 'active').length;
}

/** 接收方的名字：服务商在模型视图里的名字；没有时 `custom:名字` 取名字、`agent:codex` 写 Codex，其余照写 ID。 */
export function recipientName(recipient: string, labels: ReadonlyMap<string, string>): string {
  const known = labels.get(recipient);
  if (known) return known;
  if (recipient.startsWith('custom:')) return recipient.slice('custom:'.length) || recipient;
  if (recipient.startsWith('agent:')) {
    const name = recipient.slice('agent:'.length);
    return name ? name[0]!.toUpperCase() + name.slice(1) : recipient;
  }
  return recipient;
}

/** 「OpenAI · 文稿与译文、文本与提示词」。 */
export function grantTitle(grant: Pick<Grant, 'recipient' | 'dataKinds'>, labels: ReadonlyMap<string, string>): string {
  const kinds = M.kindList(grant.dataKinds.map((k) => GRANT_DATA_KIND_LABELS[k]));
  return `${recipientName(grant.recipient, labels)} · ${kinds || M.noKinds}`;
}

const money = (m: Money) => `${m.amount} ${m.currency}`;

const ORIGIN_LABEL: Record<Grant['origin'], string> = live(() => M.origin);

/** 日期写到天（本地时区）：「2026-10-05」。 */
function day(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 说明行：范围、预算、次数、用量、来源、到期，按顺序用「·」连起来。
 * `videoName` 是范围里那个视频的名字（Space 里找不到时 null，写「一个视频」）。
 */
export function grantFacts(grant: Grant, videoName: string | null): string {
  const facts: string[] = [];
  facts.push(grant.scope.videoId ? (videoName ? M.oneVideoNamed(videoName) : M.oneVideo) : M.allVideos);
  if (grant.taskId) facts.push(M.oneTask);
  if (grant.budgetMode === 'estimate-cap' && grant.budgetCap) facts.push(M.budgetCap(money(grant.budgetCap)));
  else facts.push(M.budgetUnknown);
  facts.push(grant.once ? M.once : grant.maxCalls === null ? M.unlimited : M.maxCalls(grant.maxCalls));
  facts.push(usageLine(grant));
  facts.push(ORIGIN_LABEL[grant.origin]);
  if (grant.state === 'revoked' && grant.revokedAt) facts.push(M.revokedOn(day(grant.revokedAt)));
  else if (grant.expiresAt) facts.push(grant.state === 'expired' ? M.expiredOn(day(grant.expiresAt)) : M.expiresOn(day(grant.expiresAt)));
  return facts.join(' · ');
}

/** 用量：「已用 3 次（0.42 USD）」「还没用过」；预留中的、金额未知的也照写。 */
export function usageLine(grant: Pick<Grant, 'usage' | 'budgetCap'>): string {
  const u = grant.usage;
  const currency = grant.budgetCap?.currency ?? '';
  const parts: string[] = [];
  if (!u.calls && !u.reservedCalls) return M.neverUsed;
  if (u.calls) parts.push(u.amount !== null && currency ? M.usedWithAmount(u.calls, `${u.amount} ${currency}`) : M.used(u.calls));
  if (u.reservedCalls)
    parts.push(u.reservedAmount !== null && currency ? M.reservedWithAmount(u.reservedCalls, `${u.reservedAmount} ${currency}`) : M.reserved(u.reservedCalls));
  if (u.unknownCostCalls) parts.push(M.unknownCost(u.unknownCostCalls));
  return parts.join(M.usageSeparator);
}

/** 撤销前的确认：撤销拦得住什么、拦不住什么。 */
export function revokeConfirmText(grant: Pick<Grant, 'usage'>): string {
  return M.revokeConfirm(grant.usage.reservedCalls, grant.usage.calls);
}

/** 撤销之后的一句：Runtime 报的已交出部分与还在跑的任务。 */
export function revokeResultLine(result: GrantRevokeResult): string {
  const { calls, amount, unknownCostCalls } = result.alreadySent;
  const parts = [M.revoked];
  if (calls) parts.push(M.sentBefore(calls, amount ? money(amount) : null, unknownCostCalls));
  if (result.runningJobs.length) parts.push(M.runningJobs(result.runningJobs.length));
  return parts.join(' · ');
}
