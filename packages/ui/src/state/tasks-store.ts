import { create } from 'zustand';
import { applyTasksEvent } from '@baocut/client';
import type { ConversationActivity, PendingApproval, TaskSummary, TasksEvent, TasksSnapshot } from '@baocut/protocol';
import { SC } from './state-copy.ts';

/**
 * 任务镜像（任务中心与标题栏的任务胶囊）。只由 Runtime 的快照与事件改写。
 * `approvals`：待处理的审批，会话的与对外服务的都在这里（架构设计 §3.12）；服务审批卡从这里取外发授权（`grants`）。
 */
export interface TasksStore {
  ready: boolean;
  tasks: TaskSummary[];
  approvals: PendingApproval[];
  replace(snapshot: TasksSnapshot): void;
  apply(event: TasksEvent): void;
}

export const useTasks = create<TasksStore>()((set) => ({
  ready: false,
  tasks: [],
  approvals: [],
  replace: (snapshot) => set({ ready: true, tasks: snapshot.tasks, approvals: snapshot.approvals ?? [] }),
  apply: (event) =>
    set((s) => {
      const next = applyTasksEvent({ tasks: s.tasks, approvals: s.approvals }, event);
      return { tasks: next.tasks, approvals: next.approvals ?? s.approvals };
    }),
}));

export function isLive(task: TaskSummary): boolean {
  return task.status === 'running' || task.status === 'stopping';
}

/** 进行中的任务怎么称呼。等用户批准时任务本身仍在进行，等待记在会话的活动上（产品设计 §3.1）。 */
export function liveLabel(task: TaskSummary, activity: ConversationActivity | undefined): string {
  if (task.status === 'stopping') return SC.task.stopping;
  return activity === 'awaiting-approval' ? SC.task.awaitingApproval : SC.task.running;
}
