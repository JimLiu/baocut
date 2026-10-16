import type { AgentSetupRun, Id } from '@baocut/protocol';
import { AGENT_COPY } from '../components/settings/agent-copy.ts';
import { TASK_VIEW_COPY } from '../copy.ts';
import { kindLabel, type TaskKind, type TaskRow, type TaskTone } from './task-list.ts';

/**
 * 应用内运行的 Agent 安装、升级（`agent-setup` 主题，架构设计 §12.9）在后台任务里的那一行：设置 › Agent 提供方与首次启动引导
 * 都会运行，跑的时候、跑完之后都能在任务页找到（Runtime 只在内存里留最近几次）。没有进度百分比，只转圈；在跑时能停。
 * 输出在详情页（`setupLog`）；失败的那一句与设置页的命令框同一句。
 */

const SETUP_TASK_PREFIX = 'agent-setup:';

export const setupTaskId = (runId: Id): Id => `${SETUP_TASK_PREFIX}${runId}`;

/** 失败的那一句括号里写什么：有退出码写退出码；没能启动、被信号结束的按事实写。 */
export function setupFailureReason(run: Pick<AgentSetupRun, 'exitCode' | 'error'>): string {
  const C = AGENT_COPY.command;
  if (run.exitCode !== null) return C.exitCode(run.exitCode);
  if (run.error) return C.startFailed(run.error);
  return C.killed;
}

function setupStatus(state: AgentSetupRun['state']): { label: string; tone: TaskTone } {
  if (state === 'running') return { label: AGENT_COPY.command.running, tone: 'accent' };
  if (state === 'completed') return { label: TASK_VIEW_COPY.completed, tone: 'positive' };
  // 停止不叫失败（同 Job 的取消）：用户自己停的。
  if (state === 'cancelled') return { label: TASK_VIEW_COPY.cancelled, tone: 'neutral' };
  return { label: TASK_VIEW_COPY.failed, tone: 'negative' };
}

/** 一次安装或升级：「安装 Agent · Codex CLI」，在哪写实际运行的命令。`driverName` 取探测结果里的名字（找不到时调用方给 ID）。 */
export function agentSetupTaskRow(run: AgentSetupRun, driverName: string): TaskRow {
  const kind: TaskKind = run.action === 'upgrade' ? 'agentUpgrade' : 'agentInstall';
  const live = run.state === 'running';
  const status = setupStatus(run.state);
  return {
    id: setupTaskId(run.runId),
    origin: 'agent-setup',
    kind,
    kindText: kindLabel(kind),
    title: [kindLabel(kind), driverName].join(' · '),
    where: [run.command, TASK_VIEW_COPY.local].join(' · '),
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    live,
    queued: false,
    waiting: false,
    label: status.label,
    tone: status.tone,
    phase: null,
    pct: null,
    progress: live ? 'indet' : null,
    chip: null,
    action: live ? { type: 'cancelSetup', runId: run.runId } : null,
    conversationId: null,
    projectId: null,
    videoId: null,
    error: run.state === 'failed' ? AGENT_COPY.command.failed(setupFailureReason(run)) : null,
  };
}
