import { create } from 'zustand';
import { type Id, type JobRecord, type SpeakersSummary, type TransactionReceipt, type UndoTarget } from '@baocut/protocol';
import { changedNames } from '../../model/speakers-proposal.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { SPEAKERS_COPY as C } from './speakers-copy.ts';
import { jobErrorText } from '../../model/localized-text.ts';

/**
 * 工具页 › 识别说话人（原型 panel-aitools-flows.jsx `SpeakerFlow`，架构设计 §6.6）：提交 `pipelines.start`（`speakers`），
 * 经 `jobs` 主题跟住父任务；完成时父任务的 `pipeline.summary` 是提案（还没写进视频），进确认页。确认页改过名字后
 * 「应用」走 `edits.applySpeakers`（一笔编辑事务），收据上撤销与重做都按事务撤（撤销那笔撤销即重做）。
 *
 * 状态放在模块级 store 里（同 translate-run.ts）：工具页可能被关掉、换到别的面板，识别不能因此断线，确认页也还在。
 * 「说话人区分」模型包没装时，设置页先开下载；下载任务完成后这里接着自动开始识别（`awaitInstall`）。
 */

export type SpeakersRunStatus = 'submitting' | 'running';

export interface SpeakersRun {
  videoId: Id;
  /** 提交成功之前为 null。 */
  jobId: Id | null;
  status: SpeakersRunStatus;
  /** 重试时任务的 `updatedAt`：镜像里还是那条已经结束的记录时不收尾（同 translate-run.ts）。 */
  retriedAt: string | null;
}

/** 确认页：识别结果与用户改过的名字。 */
export interface SpeakersProposal {
  videoId: Id;
  jobId: Id;
  summary: SpeakersSummary;
  /** 说话人 ID → 改过的名字（输入框里的原样）。 */
  names: Record<Id, string>;
  applying: boolean;
}

/** 应用之后的收据。 */
export interface SpeakersReceipt {
  videoId: Id;
  jobId: Id;
  summary: SpeakersSummary;
  names: Record<Id, string>;
  /** 应用（或重做）的那笔事务；没有可撤销的改动时 null（不给撤销）。 */
  transactionId: Id | null;
  /** 撤销那笔事务：重做就是撤销它。 */
  undoTransactionId: Id | null;
  undone: boolean;
  busy: boolean;
}

export type SpeakersProblemKind = 'failed' | 'decide' | 'apply';

export interface SpeakersProblem {
  kind: SpeakersProblemKind;
  title: string;
  message: string;
  /** 能从停下的那一步重跑的任务（`pipelines.retry`）。 */
  retryJobId: Id | null;
  /** 后台任务里要人决定的那一个。 */
  taskId: Id | null;
}

interface SpeakersRunState {
  runs: Record<Id, SpeakersRun>;
  proposals: Record<Id, SpeakersProposal>;
  receipts: Record<Id, SpeakersReceipt>;
  problems: Record<Id, SpeakersProblem>;
  /** 等着模型包下载完再开始的视频 → 下载任务。 */
  installs: Record<Id, Id>;
}

const EMPTY: SpeakersRunState = { runs: {}, proposals: {}, receipts: {}, problems: {}, installs: {} };

export const useSpeakersRun = create<SpeakersRunState>()(() => ({ ...EMPTY }));

export const SPEAKERS_PIPELINE = 'speakers';

/** 用到的会话能力；测试给假的。 */
export interface SpeakersDeps {
  runtime: {
    startPipeline(pipeline: string, params: Record<string, unknown>): Promise<Id>;
    retryPipeline(jobId: Id): Promise<void>;
    cancelJob(jobId: Id): Promise<void>;
    videos: {
      applySpeakers(jobId: Id, names?: Record<Id, string>): Promise<TransactionReceipt | null>;
      undo(target: UndoTarget): Promise<TransactionReceipt | null>;
    };
  };
  toast(kind: 'positive' | 'neutral' | 'negative', message: string): void;
}

let deps: SpeakersDeps | null = null;
let unwatch: (() => void) | null = null;

/** 工具页挂上时绑定会话与提示；第一次绑定时开始盯 `jobs` 主题。 */
export function bindSpeakers(next: SpeakersDeps): void {
  deps = next;
  unwatch ??= useJobs.subscribe((state) => settle(state.jobs));
}

/** 测试用：解绑并清空状态。 */
export function resetSpeakers(): void {
  unwatch?.();
  unwatch = null;
  deps = null;
  useSpeakersRun.setState({ ...EMPTY });
}

const without = <T>(record: Record<Id, T>, key: Id): Record<Id, T> => {
  const { [key]: _, ...rest } = record;
  return rest;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function patch<K extends 'proposals' | 'receipts'>(key: K, videoId: Id, change: Partial<SpeakersRunState[K][Id]>): void {
  useSpeakersRun.setState((s) => {
    const current = s[key][videoId];
    return current ? ({ [key]: { ...s[key], [videoId]: { ...current, ...change } } } as Partial<SpeakersRunState>) : {};
  });
}

function endRun(videoId: Id, problem?: SpeakersProblem): void {
  useSpeakersRun.setState((s) => ({
    runs: without(s.runs, videoId),
    problems: problem ? { ...s.problems, [videoId]: problem } : s.problems,
  }));
}

export function dismissSpeakersProblem(videoId: Id): void {
  useSpeakersRun.setState((s) => ({ problems: without(s.problems, videoId) }));
}

/** 收据上的「完成」、确认页的「放弃」：回到设置态。 */
export function closeSpeakers(videoId: Id): void {
  useSpeakersRun.setState((s) => ({ proposals: without(s.proposals, videoId), receipts: without(s.receipts, videoId) }));
}

/** 开始识别（`documentId`：视频里有几份转写时选哪一份）。同一个视频同时只跑一次。 */
export async function startSpeakers(videoId: Id, documentId?: Id): Promise<boolean> {
  const bound = deps;
  if (!bound || useSpeakersRun.getState().runs[videoId]) return false;
  useSpeakersRun.setState((s) => ({
    runs: { ...s.runs, [videoId]: { videoId, jobId: null, status: 'submitting', retriedAt: null } },
    proposals: without(s.proposals, videoId),
    receipts: without(s.receipts, videoId),
    problems: without(s.problems, videoId),
    installs: without(s.installs, videoId),
  }));
  try {
    const jobId = await bound.runtime.startPipeline(SPEAKERS_PIPELINE, { videoId, ...(documentId ? { documentId } : {}) });
    useSpeakersRun.setState((s) =>
      s.runs[videoId] ? { runs: { ...s.runs, [videoId]: { ...s.runs[videoId]!, jobId, status: 'running' } } } : {},
    );
    // 任务事件可能比回执先到。
    settle(useJobs.getState().jobs);
    return true;
  } catch (error) {
    endRun(videoId, { kind: 'failed', title: C.submitFailed, message: messageOf(error), retryJobId: null, taskId: null });
    return false;
  }
}

/** 模型包的下载任务提交了：下完（`completed`）就开始识别；失败或取消时不开始（下载自己的提示说原因）。 */
export function awaitInstall(videoId: Id, installJobId: Id): void {
  useSpeakersRun.setState((s) => ({ installs: { ...s.installs, [videoId]: installJobId }, problems: without(s.problems, videoId) }));
  settle(useJobs.getState().jobs);
}

/** 从停下的那一步重跑同一个任务（`pipelines.retry`）。 */
export async function retrySpeakers(videoId: Id): Promise<void> {
  const bound = deps;
  const jobId = useSpeakersRun.getState().problems[videoId]?.retryJobId;
  if (!bound || !jobId || useSpeakersRun.getState().runs[videoId]) return;
  const before = useJobs.getState().jobs.find((job) => job.jobId === jobId);
  useSpeakersRun.setState((s) => ({
    runs: { ...s.runs, [videoId]: { videoId, jobId, status: 'submitting', retriedAt: null } },
    problems: without(s.problems, videoId),
  }));
  try {
    await bound.runtime.retryPipeline(jobId);
    useSpeakersRun.setState((s) =>
      s.runs[videoId]
        ? { runs: { ...s.runs, [videoId]: { ...s.runs[videoId]!, status: 'running', retriedAt: before?.updatedAt ?? null } } }
        : {},
    );
  } catch (error) {
    endRun(videoId, { kind: 'failed', title: C.failed, message: messageOf(error), retryJobId: jobId, taskId: null });
  }
}

export async function cancelSpeakers(jobId: Id): Promise<void> {
  try {
    await deps?.runtime.cancelJob(jobId);
  } catch (error) {
    deps?.toast('negative', C.cancelFailed(messageOf(error)));
  }
}

/** 盯着从这里提交的任务与等着的下载：结束了就收尾。每一轮只收一次——先同步改掉状态。 */
function settle(jobs: readonly JobRecord[]): void {
  const state = useSpeakersRun.getState();
  for (const run of Object.values(state.runs)) {
    if (run.status !== 'running' || !run.jobId) continue;
    const job = jobs.find((candidate) => candidate.jobId === run.jobId);
    if (!job || isJobLive(job)) continue;
    if (run.retriedAt !== null && job.updatedAt === run.retriedAt) continue;
    finish(run, job);
  }
  for (const [videoId, installJobId] of Object.entries(state.installs)) {
    const job = jobs.find((candidate) => candidate.jobId === installJobId);
    if (!job || isJobLive(job)) continue;
    useSpeakersRun.setState((s) => ({ installs: without(s.installs, videoId) }));
    if (job.state === 'completed') void startSpeakers(videoId);
  }
}

function isSummary(value: unknown): value is SpeakersSummary {
  const s = value as Partial<SpeakersSummary> | null | undefined;
  return !!s && Array.isArray(s.speakers) && typeof s.timescale === 'number' && typeof s.proposalArtifactId === 'string';
}

function finish(run: SpeakersRun, job: JobRecord): void {
  const { videoId } = run;
  if (job.state === 'cancelled') {
    endRun(videoId);
    deps?.toast('neutral', C.cancelled);
    return;
  }
  if (job.state === 'needs-reconciliation') {
    endRun(videoId, { kind: 'decide', title: C.failed, message: jobErrorText(job.error) ?? '', retryJobId: null, taskId: job.jobId });
    return;
  }
  if (job.state !== 'completed') {
    endRun(videoId, {
      kind: 'failed',
      title: job.state === 'interrupted' ? C.interrupted : C.failed,
      message: jobErrorText(job.error) ?? '',
      retryJobId: job.jobId,
      taskId: null,
    });
    return;
  }
  const summary = job.pipeline?.summary;
  if (!isSummary(summary)) {
    endRun(videoId, { kind: 'failed', title: C.failed, message: C.badResult, retryJobId: null, taskId: null });
    return;
  }
  useSpeakersRun.setState((s) => ({
    runs: without(s.runs, videoId),
    proposals: { ...s.proposals, [videoId]: { videoId, jobId: job.jobId, summary, names: {}, applying: false } },
  }));
}

/** 确认页改名（输入框里的原样；提交时去掉首尾空白，空的不提交）。 */
export function renameSpeaker(videoId: Id, speakerId: Id, name: string): void {
  const proposal = useSpeakersRun.getState().proposals[videoId];
  if (proposal) patch('proposals', videoId, { names: { ...proposal.names, [speakerId]: name } });
}

/**
 * 应用（`edits.applySpeakers`）。失败时（多半是识别之后文稿或译文改过）放下这份提案、留一句原因，设置页给「再跑一次」；
 * 编辑器同时照常提示引擎或 Runtime 的原话。
 */
export async function applySpeakers(videoId: Id): Promise<boolean> {
  const bound = deps;
  const proposal = useSpeakersRun.getState().proposals[videoId];
  if (!bound || !proposal || proposal.applying) return false;
  patch('proposals', videoId, { applying: true });
  const receipt = await bound.runtime.videos.applySpeakers(proposal.jobId, changedNames(proposal.summary.speakers, proposal.names));
  if (!receipt) {
    const reason = useVideo.getState().video?.commandError?.message ?? '';
    useSpeakersRun.setState((s) => ({
      proposals: without(s.proposals, videoId),
      problems: {
        ...s.problems,
        [videoId]: { kind: 'apply', title: C.applyFailed, message: reason || C.applyStale, retryJobId: null, taskId: null },
      },
    }));
    return false;
  }
  useSpeakersRun.setState((s) => ({
    proposals: without(s.proposals, videoId),
    receipts: {
      ...s.receipts,
      [videoId]: {
        videoId,
        jobId: proposal.jobId,
        summary: proposal.summary,
        names: proposal.names,
        transactionId: receipt.undo.available ? receipt.transactionId : null,
        undoTransactionId: null,
        undone: false,
        busy: false,
      },
    },
  }));
  return true;
}

/** 收据上的「撤销」：撤应用（或重做）的那一笔。 */
export async function undoSpeakers(videoId: Id): Promise<void> {
  const bound = deps;
  const receipt = useSpeakersRun.getState().receipts[videoId];
  if (!bound || !receipt?.transactionId || receipt.undone || receipt.busy) return;
  patch('receipts', videoId, { busy: true });
  const result = await bound.runtime.videos.undo({ transaction: receipt.transactionId });
  if (!result) {
    patch('receipts', videoId, { busy: false });
    bound.toast('negative', C.undoFailed);
    return;
  }
  patch('receipts', videoId, { busy: false, undone: true, undoTransactionId: result.transactionId });
}

/** 收据上的「重做」：撤销那笔撤销。 */
export async function redoSpeakers(videoId: Id): Promise<void> {
  const bound = deps;
  const receipt = useSpeakersRun.getState().receipts[videoId];
  if (!bound || !receipt?.undoTransactionId || !receipt.undone || receipt.busy) return;
  patch('receipts', videoId, { busy: true });
  const result = await bound.runtime.videos.undo({ transaction: receipt.undoTransactionId });
  if (!result) {
    patch('receipts', videoId, { busy: false });
    bound.toast('negative', C.redoFailed);
    return;
  }
  patch('receipts', videoId, { busy: false, undone: false, undoTransactionId: null, transactionId: result.transactionId });
}
