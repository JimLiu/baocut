import { defineMessages, intlLocale, type Conversation, type Project } from '@baocut/protocol';
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
 * 最近（不属于任何项目的会话）。「在一个列表中」时项目段换成全部会话的一张单表（用户修订）。
 */

export type SessionStatus = 'waiting' | 'failed' | 'running' | 'unread';
export type StatusVariant = 'informative' | 'notice' | 'negative' | 'positive' | 'neutral';

/** 侧栏状态灯与汇总的文案（译文在 `sidebar.<语言>.ts`）。 */
const en = {
  status: { waiting: 'Waiting for approval', failed: 'Failed', running: 'Running', unread: 'Done, unread' },
  stopping: 'Stopping',
  /** 项目行汇总里的一段，例如「1 个进行中」。 */
  count: {
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
  const status = sessionStatus(conversation);
  return status ? STATUS_INFO[status] : null;
}

export interface ProjectRow {
  project: Project;
  conversations: Conversation[];
  /** 项目下会话状态的汇总，例如「1 个进行中 · 1 个等待批准」。 */
  summary: string | null;
  lastActiveAt: string;
}

export type PinnedRow = { kind: 'project'; row: ProjectRow } | { kind: 'conversation'; conversation: Conversation };

export interface SidebarTree {
  pinned: PinnedRow[];
  projects: ProjectRow[];
  /** 不属于任何项目的会话（「最近」）。 */
  loose: Conversation[];
  /** 「在一个列表中」：项目下的与不属于项目的会话放在一起。 */
  flat: Conversation[];
}

/** 会话排序：最近活动或名称（侧栏「会话排序」）。项目始终按最近活动。 */
export type SidebarSort = 'recent' | 'name';

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
  return {
    pinned,
    projects: rows,
    loose: order(visible.filter((c) => c.projectId === null)),
    flat: order(visible.filter((c) => c.projectId === null || listed.has(c.projectId))),
  };
}

function summarize(conversations: readonly Conversation[]): string | null {
  const parts = STATUS_ORDER.flatMap((status) => {
    const n = conversations.filter((c) => sessionStatus(c) === status).length;
    return n ? [M.count[status](n)] : [];
  });
  return parts.length ? parts.join(' · ') : null;
}
