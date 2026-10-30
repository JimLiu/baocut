import { create } from 'zustand';
import { applyConversationEvent, prependConversationPage } from '@baocut/client';
import type { ConversationEvent, ConversationPage, ConversationSnapshot, Id, TimelineItem } from '@baocut/protocol';

/**
 * 会话内容镜像，按会话 ID 存放（架构设计 §11.4）。归约是纯函数，未变的条目保持同一引用，
 * 条目组件用 memo 就只在自己变化时重绘。
 */
export interface TimelineStore {
  byConversationId: Record<Id, ConversationSnapshot>;
  replace(id: Id, snapshot: ConversationSnapshot): void;
  apply(id: Id, event: ConversationEvent): void;
  /** 往前翻到的一页（`before`：请求时已载入那一段的起点）。 */
  prepend(id: Id, before: number, page: ConversationPage): void;
  drop(id: Id): void;
}

export const useTimeline = create<TimelineStore>()((set) => ({
  byConversationId: {},
  replace: (id, snapshot) => set((s) => ({ byConversationId: { ...s.byConversationId, [id]: snapshot } })),
  apply: (id, event) =>
    set((s) => {
      const current = s.byConversationId[id];
      if (!current) return s;
      const next = applyConversationEvent(current, event);
      const byConversationId = { ...s.byConversationId };
      if (next) byConversationId[id] = next;
      else delete byConversationId[id];
      return { byConversationId };
    }),
  prepend: (id, before, page) =>
    set((s) => {
      const current = s.byConversationId[id];
      if (!current) return s;
      const next = prependConversationPage(current, before, page);
      return next === current ? s : { byConversationId: { ...s.byConversationId, [id]: next } };
    }),
  drop: (id) =>
    set((s) => {
      const byConversationId = { ...s.byConversationId };
      delete byConversationId[id];
      return { byConversationId };
    }),
}));

const EMPTY: readonly TimelineItem[] = [];

export function useTimelineItems(id: Id | null): readonly TimelineItem[] {
  return useTimeline((s) => (id ? (s.byConversationId[id]?.items ?? EMPTY) : EMPTY));
}

/** 已载入那一段之前还有没有更早的条目（快照只给了最近几个回合，`offset > 0`）。 */
export function useTimelineHasEarlier(id: Id | null): boolean {
  return useTimeline((s) => (id ? (s.byConversationId[id]?.offset ?? 0) > 0 : false));
}

export function useTimelineLoaded(id: Id | null): boolean {
  return useTimeline((s) => (id ? id in s.byConversationId : false));
}
