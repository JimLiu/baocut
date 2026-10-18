import { create } from 'zustand';
import type { Id, ProjectGitStatus } from '@baocut/protocol';

/**
 * 项目设置对话框开着哪个项目（Home 侧栏的项目菜单、版本记录对话框底部的 git 状态条都能打开它），和各项目最近读到的 git 状态。
 * git 状态不推送（版本记录设计 §12.3）：对话框与状态条打开时读，提交、初始化、允许之后用结果里带回的状态；两处共用这一份，
 * 从状态条进项目设置时不必等第二次读。
 */
export interface ProjectSettingsStore {
  projectId: Id | null;
  /** 每打开一次加一：对话框按它换 key，每次打开重新读、清掉上次的结果。 */
  session: number;
  statuses: Record<Id, ProjectGitStatus>;
  open(projectId: Id): void;
  close(): void;
  put(status: ProjectGitStatus): void;
}

export const useProjectSettings = create<ProjectSettingsStore>()((set) => ({
  projectId: null,
  session: 0,
  statuses: {},
  open: (projectId) => set((s) => ({ projectId, session: s.session + 1 })),
  close: () => set({ projectId: null }),
  put: (status) => set((s) => ({ statuses: { ...s.statuses, [status.projectId]: status } })),
}));
