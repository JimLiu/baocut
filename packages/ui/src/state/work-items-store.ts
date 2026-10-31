import { create } from 'zustand';
import { applyWorkItemsEvent, type BaoCutClient } from '@baocut/client';
import type { Id, ThreadReport, WorkItem, WorkItemsEvent, WorkItemsSnapshot } from '@baocut/protocol';

/**
 * 频道任务的镜像（docs/design/bot-mode 技术方案 §16.2、§17.2）：按频道存 `work-items:<id>` 主题的快照，懒订阅——
 * 只订阅当前打开的频道与有「等你」的频道（`model/bot.ts` 的 `wantedWorkItemChannels`），由 Bot 页调 `syncWorkItemSubscriptions`。
 * 转换记录不进快照：任务详情按需经 `workItems.get` 取，`transitions` 只记每条任务收到过几次转换事件，详情据此重取。
 */
export interface WorkItemsStore {
  byChannel: Record<Id, WorkItemsSnapshot>;
  transitions: Record<Id, number>;
  replace(channelId: Id, snapshot: WorkItemsSnapshot): void;
  apply(channelId: Id, event: WorkItemsEvent): void;
  drop(channelId: Id): void;
}

export const useWorkItems = create<WorkItemsStore>()((set) => ({
  byChannel: {},
  transitions: {},
  replace: (channelId, snapshot) => set((s) => ({ byChannel: { ...s.byChannel, [channelId]: snapshot } })),
  apply: (channelId, event) =>
    set((s) => {
      const transitions =
        event.type === 'work-item.transition'
          ? { ...s.transitions, [event.transition.workItemId]: (s.transitions[event.transition.workItemId] ?? 0) + 1 }
          : s.transitions;
      const current = s.byChannel[channelId];
      if (!current) return { transitions };
      const next = applyWorkItemsEvent(current, event);
      return next === current ? { transitions } : { transitions, byChannel: { ...s.byChannel, [channelId]: next } };
    }),
  drop: (channelId) =>
    set((s) => {
      const byChannel = { ...s.byChannel };
      delete byChannel[channelId];
      return { byChannel };
    }),
}));

const NO_ITEMS: readonly WorkItem[] = [];
const NO_REPORTS: readonly ThreadReport[] = [];

export function useChannelWorkItems(channelId: Id | null): readonly WorkItem[] {
  return useWorkItems((s) => (channelId ? (s.byChannel[channelId]?.items ?? NO_ITEMS) : NO_ITEMS));
}

export function useChannelReports(channelId: Id | null): readonly ThreadReport[] {
  return useWorkItems((s) => (channelId ? (s.byChannel[channelId]?.reports ?? NO_REPORTS) : NO_REPORTS));
}

export function useWorkItemsLoaded(channelId: Id | null): boolean {
  return useWorkItems((s) => (channelId ? channelId in s.byChannel : false));
}

/** 在已订阅的频道里找一条任务（线程卡只知道任务 id）。 */
export function findWorkItem(state: Pick<WorkItemsStore, 'byChannel'>, id: Id): WorkItem | undefined {
  for (const snapshot of Object.values(state.byChannel)) {
    const found = snapshot.items.find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}

export function useWorkItem(id: Id | null): WorkItem | undefined {
  return useWorkItems((s) => (id ? findWorkItem(s, id) : undefined));
}

/** 这条任务收到过几次转换事件：详情页据此重取转换记录。 */
export function useTransitionTick(id: Id | null): number {
  return useWorkItems((s) => (id ? (s.transitions[id] ?? 0) : 0));
}

// ---- 订阅 ----

const subscriptions = new Map<Id, () => void>();

/**
 * 让订阅的频道正好是 `wanted`：多的退订并丢掉镜像（不再收事件，留着会过时），少的订上。传空数组即全部退订。
 */
export function syncWorkItemSubscriptions(client: Pick<BaoCutClient, 'subscribeWorkItems'>, wanted: readonly Id[]): void {
  const keep = new Set(wanted);
  for (const [channelId, unsubscribe] of subscriptions) {
    if (keep.has(channelId)) continue;
    unsubscribe();
    subscriptions.delete(channelId);
    useWorkItems.getState().drop(channelId);
  }
  for (const channelId of keep) {
    if (subscriptions.has(channelId)) continue;
    subscriptions.set(
      channelId,
      client.subscribeWorkItems(channelId, {
        snapshot: (snapshot) => useWorkItems.getState().replace(channelId, snapshot),
        event: (event) => useWorkItems.getState().apply(channelId, event),
      }),
    );
  }
}

/** 现在订着的频道（测试与诊断用）。 */
export function subscribedWorkItemChannels(): Id[] {
  return [...subscriptions.keys()].sort();
}
