import { create } from 'zustand';
import { AI_TOOL_PIPELINE, type AiToolKind, type AiToolParams, type AiToolSummary, type Id, type JobRecord, type TransactionReceipt, type UndoTarget } from '@baocut/protocol';
import { jobErrorText } from '../../model/localized-text.ts';
import { jobRemedy, rejectionRemedy, type Remedy } from '../../model/task-facts.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';

/**
 * 工具页「用 › 直接调模型」的运行（产品设计 §5.10）：提交 `pipelines.start('ai-tool')`，经 `jobs` 主题跟住父任务；完成时
 * 父任务的 `pipeline.summary`（`AiToolSummary`）要么是写进视频的那笔事务（润色、章节，收据上一键撤销），要么是模型写的正文
 * （总结、博客、标题、简介，只给人读、拷走）。
 *
 * 状态放在模块级 store 里（同 speakers-run.ts）：工具页可能被关掉、换到别的面板，任务不能因此断线，结果也还在。
 * 键是「视频 · 工具」：同一个视频的不同工具可以同时跑，同一个工具同时只跑一次。
 */

export const runKey = (videoId: Id, tool: AiToolKind): string => `${videoId}:${tool}`;

export interface AiToolRun {
  videoId: Id;
  tool: AiToolKind;
  /** 提交成功之前为 null。 */
  jobId: Id | null;
  status: 'submitting' | 'running';
  /** 运行态写哪只模型（菜单里的名字）。 */
  model: string;
  /** 重试时任务的 `updatedAt`：镜像里还是那条已经结束的记录时不收尾。 */
  retriedAt: string | null;
}

/** 只给结果的工具：模型写的正文。 */
export interface AiToolResult {
  videoId: Id;
  tool: AiToolKind;
  jobId: Id;
  summary: AiToolSummary & { text: string };
}

/** 写进视频的工具：那笔事务的收据（一键撤销，不给重做）。 */
export interface AiToolReceipt {
  videoId: Id;
  tool: AiToolKind;
  jobId: Id;
  summary: AiToolSummary;
  /** 没有改动（或 Runtime 没给事务）时 null，不给撤销。 */
  transactionId: Id | null;
  undone: boolean;
  busy: boolean;
}

export interface AiToolProblem {
  videoId: Id;
  tool: AiToolKind;
  title: string;
  message: string;
  /** 去模型页、设置的补救（没配文本模型时）。 */
  remedy: Remedy | null;
  /** 能从停下的那一步重跑的任务（`pipelines.retry`）。 */
  retryJobId: Id | null;
  /** 后台任务里要人决定的那一个。 */
  taskId: Id | null;
  model: string;
}

interface AiToolRunState {
  runs: Record<string, AiToolRun>;
  results: Record<string, AiToolResult>;
  receipts: Record<string, AiToolReceipt>;
  problems: Record<string, AiToolProblem>;
  /** 收据上撤销过的任务（`jobId`）：收据关掉之后列表仍写「已撤销」，不写「上次」。 */
  undoneJobs: Record<Id, true>;
}

const EMPTY: AiToolRunState = { runs: {}, results: {}, receipts: {}, problems: {}, undoneJobs: {} };

export const useAiToolRun = create<AiToolRunState>()(() => ({ ...EMPTY }));

/** 用到的会话能力；测试给假的。 */
export interface AiToolRunDeps {
  runtime: {
    startPipeline(pipeline: string, params: Record<string, unknown>): Promise<Id>;
    retryPipeline(jobId: Id): Promise<void>;
    cancelJob(jobId: Id): Promise<void>;
    videos: { undo(target: UndoTarget): Promise<TransactionReceipt | null> };
  };
  toast(kind: 'positive' | 'neutral' | 'negative', message: string): void;
}

let deps: AiToolRunDeps | null = null;
let unwatch: (() => void) | null = null;

/** 工具页挂上时绑定会话与提示；第一次绑定时开始盯 `jobs` 主题。 */
export function bindAiToolRun(next: AiToolRunDeps): void {
  deps = next;
  unwatch ??= useJobs.subscribe((state) => settle(state.jobs));
}

/** 测试用：解绑并清空状态。 */
export function resetAiToolRun(): void {
  unwatch?.();
  unwatch = null;
  deps = null;
  useAiToolRun.setState({ ...EMPTY });
}

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _, ...rest } = record;
  return rest;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function endRun(key: string, problem?: AiToolProblem): void {
  useAiToolRun.setState((s) => ({
    runs: without(s.runs, key),
    problems: problem ? { ...s.problems, [key]: problem } : s.problems,
  }));
}

/** 问题卡上的「知道了」。 */
export function dismissAiToolProblem(key: string): void {
  useAiToolRun.setState((s) => ({ problems: without(s.problems, key) }));
}

/** 结果与收据上的「完成」：回到设置态。 */
export function closeAiToolResult(key: string): void {
  useAiToolRun.setState((s) => ({ results: without(s.results, key), receipts: without(s.receipts, key) }));
}

/** 开始。同一个视频的同一个工具同时只跑一次。`model` 是运行态与问题卡上写的模型名字。 */
export async function startAiTool(params: AiToolParams, model: string): Promise<boolean> {
  const bound = deps;
  const key = runKey(params.videoId, params.tool);
  if (!bound || useAiToolRun.getState().runs[key]) return false;
  useAiToolRun.setState((s) => ({
    runs: { ...s.runs, [key]: { videoId: params.videoId, tool: params.tool, jobId: null, status: 'submitting', model, retriedAt: null } },
    results: without(s.results, key),
    receipts: without(s.receipts, key),
    problems: without(s.problems, key),
  }));
  try {
    const jobId = await bound.runtime.startPipeline(AI_TOOL_PIPELINE, { ...params });
    useAiToolRun.setState((s) => (s.runs[key] ? { runs: { ...s.runs, [key]: { ...s.runs[key]!, jobId, status: 'running' } } } : {}));
    // 任务事件可能比回执先到。
    settle(useJobs.getState().jobs);
    return true;
  } catch (error) {
    endRun(key, { videoId: params.videoId, tool: params.tool, title: C.submitFailed, message: messageOf(error), remedy: rejectionRemedy('generateText', error), retryJobId: null, taskId: null, model });
    return false;
  }
}

/** 从停下的那一步重跑同一个任务（`pipelines.retry`）。 */
export async function retryAiTool(key: string): Promise<void> {
  const bound = deps;
  const problem = useAiToolRun.getState().problems[key];
  const jobId = problem?.retryJobId;
  if (!bound || !problem || !jobId || useAiToolRun.getState().runs[key]) return;
  const { videoId, tool } = problem;
  const before = useJobs.getState().jobs.find((job) => job.jobId === jobId);
  useAiToolRun.setState((s) => ({
    runs: { ...s.runs, [key]: { videoId, tool, jobId, status: 'submitting', model: problem.model, retriedAt: null } },
    problems: without(s.problems, key),
  }));
  try {
    await bound.runtime.retryPipeline(jobId);
    useAiToolRun.setState((s) =>
      s.runs[key] ? { runs: { ...s.runs, [key]: { ...s.runs[key]!, status: 'running', retriedAt: before?.updatedAt ?? null } } } : {},
    );
  } catch (error) {
    endRun(key, { videoId, tool, title: C.failed, message: messageOf(error), remedy: null, retryJobId: jobId, taskId: null, model: problem.model });
  }
}

export async function cancelAiTool(jobId: Id): Promise<void> {
  try {
    await deps?.runtime.cancelJob(jobId);
  } catch (error) {
    deps?.toast('negative', C.cancelFailed(messageOf(error)));
  }
}

/** 盯着从这里提交的任务：结束了就收尾。每一轮只收一次——先同步改掉状态。 */
function settle(jobs: readonly JobRecord[]): void {
  for (const [key, run] of Object.entries(useAiToolRun.getState().runs)) {
    if (run.status !== 'running' || !run.jobId) continue;
    const job = jobs.find((candidate) => candidate.jobId === run.jobId);
    if (!job || isJobLive(job)) continue;
    if (run.retriedAt !== null && job.updatedAt === run.retriedAt) continue;
    finish(key, run, job);
  }
}

export function isAiToolSummary(value: unknown): value is AiToolSummary {
  const s = value as Partial<AiToolSummary> | null | undefined;
  return !!s && typeof s.tool === 'string' && typeof s.artifactId === 'string' && typeof s.context === 'object' && s.context !== null;
}

function finish(key: string, run: AiToolRun, job: JobRecord): void {
  const base = { videoId: run.videoId, tool: run.tool, remedy: null, retryJobId: null, taskId: null, model: run.model };
  if (job.state === 'cancelled') {
    endRun(key);
    deps?.toast('neutral', C.cancelled);
    return;
  }
  if (job.state === 'needs-reconciliation') {
    endRun(key, { ...base, title: C.needsDecision, message: jobErrorText(job.error) ?? '', taskId: job.jobId });
    return;
  }
  if (job.state !== 'completed') {
    endRun(key, {
      ...base,
      title: job.state === 'interrupted' ? C.interrupted : C.failed,
      message: jobErrorText(job.error) ?? '',
      remedy: jobRemedy(job),
      retryJobId: job.jobId,
    });
    return;
  }
  const summary = job.pipeline?.summary;
  if (!isAiToolSummary(summary)) {
    endRun(key, { ...base, title: C.failed, message: C.badResult });
    return;
  }
  if (summary.applied) {
    const receipt: AiToolReceipt = {
      videoId: run.videoId,
      tool: run.tool,
      jobId: job.jobId,
      summary,
      transactionId: summary.applied.transactionId,
      undone: false,
      busy: false,
    };
    useAiToolRun.setState((s) => ({ runs: without(s.runs, key), receipts: { ...s.receipts, [key]: receipt } }));
    return;
  }
  if (typeof summary.text !== 'string') {
    endRun(key, { ...base, title: C.failed, message: C.badResult });
    return;
  }
  const result: AiToolResult = { videoId: run.videoId, tool: run.tool, jobId: job.jobId, summary: { ...summary, text: summary.text } };
  useAiToolRun.setState((s) => ({ runs: without(s.runs, key), results: { ...s.results, [key]: result } }));
}

/** 收据上的「撤销」：撤写进视频的那一笔。 */
export async function undoAiTool(key: string): Promise<void> {
  const bound = deps;
  const receipt = useAiToolRun.getState().receipts[key];
  if (!bound || !receipt?.transactionId || receipt.undone || receipt.busy) return;
  const patch = (change: Partial<AiToolReceipt>) =>
    useAiToolRun.setState((s) => (s.receipts[key] ? { receipts: { ...s.receipts, [key]: { ...s.receipts[key]!, ...change } } } : {}));
  patch({ busy: true });
  const result = await bound.runtime.videos.undo({ transaction: receipt.transactionId });
  if (!result) {
    patch({ busy: false });
    bound.toast('negative', C.undoFailed);
    return;
  }
  patch({ busy: false, undone: true });
  useAiToolRun.setState((s) => ({ undoneJobs: { ...s.undoneJobs, [receipt.jobId]: true } }));
}
