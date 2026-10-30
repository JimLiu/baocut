import { create } from 'zustand';
import { applyDirectoryEvent } from '@baocut/client';
import type { Conversation, DirectoryEvent, DirectorySnapshot, Id, Project } from '@baocut/protocol';

/**
 * 目录镜像：项目与会话列表（侧栏的投影）。只由 Runtime 的快照与事件改写，
 * 界面不在这里做乐观修改（架构设计 §11.4）。
 */
export interface DirectoryStore extends DirectorySnapshot {
  ready: boolean;
  /** 收到过几次快照（首次连上与每次重连各一次）：提醒把快照当新的基线，只认两次快照之间的事件（model/attention.ts）。 */
  snapshots: number;
  replace(snapshot: DirectorySnapshot): void;
  apply(event: DirectoryEvent): void;
}

export const useDirectory = create<DirectoryStore>()((set) => ({
  ready: false,
  snapshots: 0,
  projects: [],
  conversations: [],
  replace: (snapshot) =>
    set((s) => ({ ready: true, snapshots: s.snapshots + 1, projects: snapshot.projects, conversations: snapshot.conversations })),
  apply: (event) => set((s) => applyDirectoryEvent(s, event)),
}));

export function useConversationMeta(id: Id | null): Conversation | undefined {
  return useDirectory((s) => (id ? s.conversations.find((c) => c.id === id) : undefined));
}

export function useProject(id: Id | null): Project | undefined {
  return useDirectory((s) => (id ? s.projects.find((p) => p.id === id) : undefined));
}
