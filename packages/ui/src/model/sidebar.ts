import { defineMessages, intlLocale, type Conversation, type Id, type Project } from '@baocut/protocol';
import { zhHans } from './sidebar.zh-Hans.ts';
import { zhHant } from './sidebar.zh-Hant.ts';
import { ja } from './sidebar.ja.ts';
import { ko } from './sidebar.ko.ts';
import { es } from './sidebar.es.ts';
import { fr } from './sidebar.fr.ts';
import { de } from './sidebar.de.ts';
import { nl } from './sidebar.nl.ts';
import { ptBR } from './sidebar.pt-BR.ts';
import { it } from './sidebar.it.ts';
import { ru } from './sidebar.ru.ts';
import { pl } from './sidebar.pl.ts';
import { tr } from './sidebar.tr.ts';
import { vi } from './sidebar.vi.ts';

/**
 * Home 侧栏的树（产品设计 §3.1）。从上到下三段：
 * 置顶（钉住的项目与会话，它们同时还在原来的位置）、项目（按最近活动排，下面挂它的会话）、
 * 最近（不属于任何项目的会话）。「在一个列表中」时项目段换成全部会话的一张单表（用户修订）；
 * 「按状态分组」时有状态的会话按要你处理的先后各成一段排在上面，其余的在最后一段「其他会话」。
 */

export type SessionStatus = 'waiting' | 'failed' | 'running' | 'unread';
export type StatusVariant = 'informative' | 'notice' | 'negative' | 'positive' | 'neutral';

/** 侧栏状态灯与汇总的文案（译文在 `sidebar.<语言>.ts`）。 */
const en = {
  status: { answer: 'Waiting for your answer', waiting: 'Waiting for approval', failed: 'Failed', running: 'Running', unread: 'Done, unread' },
  stopping: 'Stopping',
  /** 「按状态分组」的段名：等批准与等回答合成一段；失败、进行中与已完成未读用上面的状态词。 */
  group: { waiting: 'Needs you', rest: 'Other sessions' },
  /** 项目行汇总里的一段，例如「1 个进行中」。 */
  count: {
    answer: (n: number) => `${n} waiting for your answer`,
    waiting: (n: number) => `${n} waiting for approval`,
    failed: (n: number) => `${n} failed`,
    running: (n: number) => `${n} running`,
    unread: (n: number) => `${n} done, unread`,
  },
};
export type SidebarMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

const statusInfo = (key: SessionStatus, variant: StatusVariant) => ({
  get label() {
    return M.status[key];
  },
  variant,
});

const STATUS_INFO: Record<SessionStatus, { readonly label: string; variant: StatusVariant }> = {
  waiting: statusInfo('waiting', 'notice'),
  failed: statusInfo('failed', 'negative'),
  running: statusInfo('running', 'informative'),
  unread: statusInfo('unread', 'positive'),
};

/** 汇总里的先后：要你动手的排前面。 */
const STATUS_ORDER: SessionStatus[] = ['waiting', 'failed', 'running', 'unread'];

export function sessionStatus(conversation: Conversation): SessionStatus | null {
  switch (conversation.activity) {
    case 'awaiting-approval':
    case 'awaiting-answer':
      return 'waiting';
    case 'running':
    case 'stopping':
      return 'running';
    case 'failed':
      return 'failed';
    case 'idle':
      return conversation.unread ? 'unread' : null;
  }
}

/** 会话行第二行的状态灯；没有状态时返回 null，改显示多久前。 */
export function conversationStatus(conversation: Conversation): { label: string; variant: StatusVariant } | null {
  if (conversation.activity === 'stopping') return { label: M.stopping, variant: 'neutral' };
  if (conversation.activity === 'awaiting-answer') return { label: M.status.answer, variant: 'notice' };
  const status = sessionStatus(conversation);
  return status ? STATUS_INFO[status] : null;
}

/** 会话头、标签与摘要上的状态词：进行中、等待批准，或只等智能体的提问时的「等待回答」；别的状态没有。 */
export type LiveWord = 'running' | 'waiting' | 'answer';

export function liveWord(conversation: Conversation): LiveWord | null {
  if (conversation.activity === 'awaiting-answer') return 'answer';
  const status = sessionStatus(conversation);
  return status === 'running' || status === 'waiting' ? status : null;
}

export interface ProjectRow {
  project: Project;
  conversations: Conversation[];
  /** 项目下会话状态的汇总，例如「1 个进行中 · 1 个等待批准」。 */
  summary: string | null;
  lastActiveAt: string;
}

export type PinnedRow = { kind: 'project'; row: ProjectRow } | { kind: 'conversation'; conversation: Conversation };

export interface StatusGroup {
  status: SessionStatus;
  conversations: Conversation[];
}

export interface SidebarTree {
  pinned: PinnedRow[];
  projects: ProjectRow[];
  /** 不属于任何项目的会话（「最近」）。 */
  loose: Conversation[];
  /** 「在一个列表中」：项目下的与不属于项目的会话放在一起。 */
  flat: Conversation[];
  /** 「按状态分组」：`flat` 里有状态的按 `STATUS_ORDER` 分段（空段不列），其余的在 `rest`；段内次序同 `flat`。 */
  byStatus: { groups: StatusGroup[]; rest: Conversation[] };
}

/** 侧栏怎么整理（「⋯ › 整理侧栏」）：按项目分组、在一个列表中、按状态分组。 */
export type SidebarGrouping = 'project' | 'flat' | 'status';

/** 会话排序：最近活动或名称（侧栏「会话排序」）。项目始终按最近活动。 */
export type SidebarSort = 'recent' | 'name';

/** 「按状态分组」一段的段名。 */
export function statusGroupLabel(status: SessionStatus): string {
  return status === 'waiting' ? M.group.waiting : M.status[status];
}

/** 「按状态分组」最后一段的段名；上面没有分段时它就是全部会话。 */
export function restGroupLabel(): string {
  return M.group.rest;
}

const byRecent = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
const byName = (a: Conversation, b: Conversation) => a.title.localeCompare(b.title, intlLocale()) || byRecent(a, b);

export function buildSidebar(projects: readonly Project[], conversations: readonly Conversation[], sort: SidebarSort = 'recent'): SidebarTree {
  const visible = conversations.filter((c) => !c.archived);
  const order = (list: Conversation[]) => list.sort(sort === 'name' ? byName : byRecent);

  const rows: ProjectRow[] = projects
    .filter((project) => !project.archived)
    .map((project) => {
      const own = visible.filter((c) => c.projectId === project.id).sort(byRecent);
      const last = own[0]?.updatedAt ?? project.lastActiveAt;
      return {
        project,
        conversations: order([...own]),
        summary: summarize(own),
        lastActiveAt: last > project.lastActiveAt ? last : project.lastActiveAt,
      };
    })
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

  const pinned: PinnedRow[] = [
    ...rows.filter((row) => row.project.pinned).map((row) => ({ kind: 'project' as const, row })),
    ...visible
      .filter((c) => c.pinned)
      .sort(byRecent)
      .map((conversation) => ({ kind: 'conversation' as const, conversation })),
  ];
  const listed = new Set(rows.map((row) => row.project.id));
  const flat = order(visible.filter((c) => c.projectId === null || listed.has(c.projectId)));
  return {
    pinned,
    projects: rows,
    loose: order(visible.filter((c) => c.projectId === null)),
    flat,
    byStatus: {
      groups: STATUS_ORDER.map((status) => ({ status, conversations: flat.filter((c) => sessionStatus(c) === status) })).filter(
        (group) => group.conversations.length > 0,
      ),
      rest: flat.filter((c) => sessionStatus(c) === null),
    },
  };
}

function summarize(conversations: readonly Conversation[]): string | null {
  const parts = STATUS_ORDER.flatMap((status) => {
    const matched = conversations.filter((c) => sessionStatus(c) === status);
    if (status !== 'waiting') return matched.length ? [M.count[status](matched.length)] : [];
    // 等待里分开数：要批准的与只等回答的。
    const answers = matched.filter((c) => c.activity === 'awaiting-answer').length;
    const approvals = matched.length - answers;
    return [...(approvals ? [M.count.waiting(approvals)] : []), ...(answers ? [M.count.answer(answers)] : [])];
  });
  return parts.length ? parts.join(' · ') : null;
}

/** 「已归档会话」页的一组：一个项目，或不属于任何项目（`project` 为 null）。 */
export interface ArchivedGroup {
  key: string;
  project: Project | null;
  conversations: Conversation[];
}

export interface ArchivedView {
  /** 全部已归档会话的条数（不看筛选）。 */
  total: number;
  /** 筛选后的条数。 */
  count: number;
  groups: ArchivedGroup[];
  /** 有已归档会话的项目，给项目筛选用。 */
  projects: Project[];
  /** 有没有不属于任何项目的已归档会话。 */
  hasLoose: boolean;
}

/** 项目筛选：全部、某个项目的 id，或不属于任何项目。 */
export type ArchivedScope = 'all' | 'none' | Id;

/** 归档时间；早先归档、没记下时间的退回最近活动。 */
export const archivedTime = (c: Conversation): string => c.archivedAt ?? c.updatedAt;

/**
 * Home ›「已归档会话」（产品设计 §3.1）：按项目分组，不属于任何项目的一组放最后；组内按归档时间从近到远，
 * 组按其中最近一次归档排。项目不在列表里的会话算不属于任何项目。
 */
export function buildArchived(
  projects: readonly Project[],
  conversations: readonly Conversation[],
  { query = '', scope = 'all' }: { query?: string; scope?: ArchivedScope } = {},
): ArchivedView {
  const known = new Map(projects.map((p) => [p.id, p]));
  const keyOf = (c: Conversation) => (c.projectId && known.has(c.projectId) ? c.projectId : 'none');
  const all = conversations.filter((c) => c.archived);
  const needle = query.trim().toLocaleLowerCase(intlLocale());
  const hits = all.filter(
    (c) => (scope === 'all' || keyOf(c) === scope) && (!needle || c.title.toLocaleLowerCase(intlLocale()).includes(needle)),
  );
  const byArchived = (a: Conversation, b: Conversation) => archivedTime(b).localeCompare(archivedTime(a));
  const buckets = new Map<string, Conversation[]>();
  for (const c of hits) buckets.set(keyOf(c), [...(buckets.get(keyOf(c)) ?? []), c]);
  const groups = [...buckets].map(([key, list]) => ({ key, project: known.get(key) ?? null, conversations: list.sort(byArchived) }));
  groups.sort((a, b) => Number(a.key === 'none') - Number(b.key === 'none') || byArchived(a.conversations[0]!, b.conversations[0]!));
  const used = new Set(all.map(keyOf));
  return { total: all.length, count: hits.length, groups, projects: projects.filter((p) => used.has(p.id)), hasLoose: used.has('none') };
}
