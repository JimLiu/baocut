import { create } from 'zustand';
import {
  RpcError,
  type CapabilityNotConfiguredDetails,
  type DocumentContent,
  type DubParams,
  type DubSummary,
  type EditOperation,
  type Grant,
  type GrantCreateParams,
  type Id,
  type JobRecord,
  type TransactionReceipt,
  type UndoTarget,
} from '@baocut/protocol';
import { langName } from '../../model/tools-models.ts';
import { dubFailureFacts, dubRemedy, dubRetryNote, dubSummaryOf, dubWarnings, type DubFailureFacts } from '../../model/dub-progress.ts';
import { grantPurpose, grantRefusal, grantRequest, refusalKey, type GrantRefusal } from '../../model/dub-setup.ts';
import { fallbackUndoOperations, mutedItemsOf, planTransaction } from '../../model/dub-undo.ts';
import { rootSequence } from '../../model/editor.ts';
import { rejectionRemedy, type Remedy } from '../../model/task-facts.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { DUB_COPY as C } from './dub-copy.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { jobErrorText, remedyHintText } from '../../model/localized-text.ts';

/**
 * 工具页 › 翻译配音的运行态（设计稿 panel-dub.jsx 的进度、问题与收据）：提交 `pipelines.start`（`dub`），经 `jobs` 主题跟住
 * 父任务；完成时 Runtime 已经在一笔事务里把这组配音写进视频，这里只读摘要、留一张带「撤销这组配音」的收据。
 *
 * - 授权：第一次配音被 `GRANT_REQUIRED` / `GRANT_REVOKED`（`forbidden`）拒绝时不报错，留一张「询问」：用户在确认框里看清外发
 *   什么、给谁、限哪个视频、用途之后才发 `grants.create`，成功后用同样的参数重新提交。翻译与合成交给不同服务商时可能连着
 *   被拒两轮（接收方不同），每轮各问一次；同一接收方、同一组数据发过还被拒时停下报错，不循环。
 * - 失败、中断：给原因、补救与「重试」（`pipelines.retry`，同一个任务从停下的那一步接着做）。重试也可能被授权拒绝，同样询问。
 * - 撤销：首选撤掉应用配音的那一笔（`videos.undo`），撤不了（之后又改过）时退回部分撤销（model/dub-undo.ts）。
 *
 * 状态放在模块级 store 里（同 translate-run.ts）：离开这一页、去设置发授权、去模型页配服务商，配音都不断线。
 * 不自动重试：重跑会再调用在线模型。
 */

export type DubRunStatus = 'submitting' | 'running' | 'settling';

/** 开始时的设置：收尾、询问与重试照它说话。 */
export interface DubIntent {
  videoId: Id;
  /** 配成的语言（BCP 47）。 */
  language: string;
  /** 视频的名字：授权的用途与确认框里写它。 */
  videoName: string | null;
}

export interface DubRun extends DubIntent {
  /** 提交成功之前为 null（重试时是那个任务）。 */
  jobId: Id | null;
  status: DubRunStatus;
  /** 重试时任务的 `updatedAt`：镜像里还是那条已经结束的记录时不收尾（同 translate-run.ts）。 */
  retriedAt: string | null;
}

/** 被授权拒绝之后要接着做的：用同一份参数重新开始，或重试同一个任务。 */
export type DubResume = { kind: 'start'; params: DubParams; intent: DubIntent } | { kind: 'retry'; jobId: Id; intent: DubIntent };

export interface DubAsk {
  refusal: GrantRefusal;
  /** 授权的用途（确认框里照写，`grants.create` 照发）。 */
  purpose: string;
  resume: DubResume;
  /** 这一串里已经发过的（接收方 + 数据种类）：发过还被拒时停下。 */
  granted: string[];
  status: 'asking' | 'granting';
  error: string | null;
}

export type DubProblemKind = 'not-configured' | 'failed';

export interface DubProblem {
  kind: DubProblemKind;
  title: string;
  message: string;
  remedy: Remedy | null;
  /** 能重试的流程：同一个任务；`note` 说重试会不会为做过的再花钱。 */
  retry: { jobId: Id; note: 'charges' | 'partial' | 'free' | null; intent: DubIntent } | null;
  /** 逐句的事实（哪些句子没合成、为什么）。 */
  facts: DubFailureFacts | null;
}

/** 一次配音完成后的收据：一次 AI run 收尾一定留一个能撤销的出口。 */
export interface DubReceipt {
  jobId: Id;
  videoId: Id;
  summary: DubSummary;
  /** `duck` 时的压低量（冻结参数里的）。 */
  duckDb: number | null;
  warnings: Array<{ code: string; title: string; detail: string }>;
  /** 撤掉了那一笔（`full`），还是撤不了、退回部分撤销（`partial`）。 */
  undone: 'full' | 'partial' | null;
  undoing: boolean;
}

interface DubRunState {
  runs: Record<Id, DubRun>;
  problems: Record<Id, DubProblem>;
  asks: Record<Id, DubAsk>;
  receipts: Record<Id, DubReceipt>;
}

const EMPTY: DubRunState = { runs: {}, problems: {}, asks: {}, receipts: {} };

export const useDubRun = create<DubRunState>()(() => ({ ...EMPTY }));

/** 用到的会话能力；测试给假的。 */
export interface DubDeps {
  runtime: {
    startDub(params: DubParams): Promise<Id>;
    createGrant(params: GrantCreateParams): Promise<Grant>;
    retryPipeline(jobId: Id): Promise<void>;
    cancelJob(jobId: Id): Promise<void>;
    readDocument(videoId: Id, documentId: Id, revision?: string): Promise<DocumentContent>;
    videos: {
      apply(operations: EditOperation[], label?: string): Promise<TransactionReceipt | null>;
      undo(target: UndoTarget): Promise<TransactionReceipt | null>;
      clearError(): void;
    };
  };
  /** `undo` 有值时提示带「撤销」。 */
  toast(kind: 'positive' | 'neutral' | 'negative', message: string, undo?: () => void): void;
}

let deps: DubDeps | null = null;
let unwatch: (() => void) | null = null;

/** 工具页挂上时绑定会话与提示；第一次绑定时开始盯 `jobs` 主题。 */
export function bindDub(next: DubDeps): void {
  deps = next;
  unwatch ??= useJobs.subscribe((state) => settle(state.jobs));
}

/** 测试用：解绑并清空状态。 */
export function resetDub(): void {
  unwatch?.();
  unwatch = null;
  deps = null;
  useDubRun.setState({ ...EMPTY });
}

const without = <T>(record: Record<Id, T>, key: Id): Record<Id, T> => {
  const { [key]: _, ...rest } = record;
  return rest;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function setRun(run: DubRun): void {
  useDubRun.setState((s) => ({
    runs: { ...s.runs, [run.videoId]: run },
    problems: without(s.problems, run.videoId),
    asks: without(s.asks, run.videoId),
  }));
}

function patchRun(videoId: Id, patch: Partial<DubRun>): void {
  useDubRun.setState((s) => (s.runs[videoId] ? { runs: { ...s.runs, [videoId]: { ...s.runs[videoId]!, ...patch } } } : {}));
}

function endRun(videoId: Id, problem?: DubProblem): void {
  useDubRun.setState((s) => ({
    runs: without(s.runs, videoId),
    problems: problem ? { ...s.problems, [videoId]: problem } : s.problems,
  }));
}

function ask(videoId: Id, next: DubAsk): void {
  useDubRun.setState((s) => ({ runs: without(s.runs, videoId), problems: without(s.problems, videoId), asks: { ...s.asks, [videoId]: next } }));
}

function patchAsk(videoId: Id, patch: Partial<DubAsk>): void {
  useDubRun.setState((s) => (s.asks[videoId] ? { asks: { ...s.asks, [videoId]: { ...s.asks[videoId]!, ...patch } } } : {}));
}

function patchReceipt(videoId: Id, patch: Partial<DubReceipt>): void {
  useDubRun.setState((s) => (s.receipts[videoId] ? { receipts: { ...s.receipts, [videoId]: { ...s.receipts[videoId]!, ...patch } } } : {}));
}

export function dismissDubProblem(videoId: Id): void {
  useDubRun.setState((s) => ({ problems: without(s.problems, videoId) }));
}

export function dismissDubReceipt(videoId: Id): void {
  useDubRun.setState((s) => ({ receipts: without(s.receipts, videoId) }));
}

function isNotConfigured(details: unknown): details is CapabilityNotConfiguredDetails {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { code?: unknown }).code === 'CAPABILITY_NOT_CONFIGURED' &&
    typeof (details as { remedy?: unknown }).remedy === 'object'
  );
}

/** 提交时被拒（不是授权）：没有配置语音合成或文本模型时就地给 `remedy.hint` 与去模型页的路；别的照原话。 */
export function dubSubmitProblem(error: unknown, retry: DubProblem['retry'] = null): DubProblem {
  const message = messageOf(error);
  const details = error instanceof RpcError ? error.details : (error as { details?: unknown } | null)?.details;
  if (isNotConfigured(details)) {
    const kind = details.remedy.capability === 'generateText' ? 'generateText' : 'synthesizeSpeech';
    return {
      kind: 'not-configured',
      title: C.notConfigured,
      message: remedyHintText(details.remedy) || message,
      remedy: rejectionRemedy(kind, error),
      retry,
      facts: null,
    };
  }
  return { kind: 'failed', title: retry ? C.failed : C.submitFailed, message: retry ? C.retryFailed(message) : message, remedy: null, retry, facts: null };
}

/**
 * 提交（开始或重试）。被授权拒绝时转成询问（同一接收方、同一组数据发过还被拒时报错）；成功返回任务 ID。
 * `granted` 是这一串里已经发过的授权。
 */
async function submit(resume: DubResume, granted: readonly string[]): Promise<Id | null> {
  const bound = deps;
  const { intent } = resume;
  const { videoId } = intent;
  if (!bound) return null;
  const before = resume.kind === 'retry' ? useJobs.getState().jobs.find((job) => job.jobId === resume.jobId) : undefined;
  setRun({ ...intent, jobId: resume.kind === 'retry' ? resume.jobId : null, status: 'submitting', retriedAt: null });
  try {
    if (resume.kind === 'start') {
      const jobId = await bound.runtime.startDub(resume.params);
      patchRun(videoId, { jobId, status: 'running' });
      // 任务事件可能比回执先到；这是新任务，镜像里不会有它结束了的旧记录。
      settle(useJobs.getState().jobs);
      return jobId;
    }
    await bound.runtime.retryPipeline(resume.jobId);
    patchRun(videoId, { status: 'running', retriedAt: before?.updatedAt ?? null });
    return resume.jobId;
  } catch (error) {
    const retry = resume.kind === 'retry' ? { jobId: resume.jobId, note: before ? dubRetryNote(before) : null, intent } : null;
    const refusal = grantRefusal(error);
    if (refusal && !granted.includes(refusalKey(refusal))) {
      ask(videoId, { refusal, purpose: grantPurpose(intent.language, intent.videoName), resume, granted: [...granted], status: 'asking', error: null });
      return null;
    }
    if (refusal) {
      endRun(videoId, { kind: 'failed', title: C.grantStillRefused, message: refusal.message, remedy: null, retry, facts: null });
      return null;
    }
    endRun(videoId, dubSubmitProblem(error, retry));
    return null;
  }
}

/** 开始配音。同一个视频同时只配一次（两组配音会抢同一批原句的静音与闪避）。成功返回任务 ID。 */
export async function startDub(params: DubParams, intent: DubIntent): Promise<Id | null> {
  if (!deps || useDubRun.getState().runs[intent.videoId]) return null;
  useDubRun.setState((s) => ({ receipts: without(s.receipts, intent.videoId) }));
  return submit({ kind: 'start', params, intent }, []);
}

/**
 * 用户在确认框里按了「发放并继续」：发 `grants.create`（只限这个视频、按次计、金额未知），成功后接着开始或重试。
 * 发放失败时留在询问上、写明原因。返回新开始的任务 ID（重试时是原来的任务）。
 */
export async function confirmGrant(videoId: Id): Promise<Id | null> {
  const bound = deps;
  const current = useDubRun.getState().asks[videoId];
  if (!bound || !current || current.status === 'granting' || useDubRun.getState().runs[videoId]) return null;
  patchAsk(videoId, { status: 'granting', error: null });
  try {
    await bound.runtime.createGrant(grantRequest(current.refusal, videoId, current.purpose));
  } catch (error) {
    patchAsk(videoId, { status: 'asking', error: C.grantFailed(messageOf(error)) });
    return null;
  }
  return submit(current.resume, [...current.granted, refusalKey(current.refusal)]);
}

/** 不发授权：收起询问。被拒的是重试时，留着「重试」。 */
export function dismissAsk(videoId: Id): void {
  const current = useDubRun.getState().asks[videoId];
  useDubRun.setState((s) => ({ asks: without(s.asks, videoId) }));
  const resume = current?.resume;
  if (!current || resume?.kind !== 'retry') return;
  const job = useJobs.getState().jobs.find((j) => j.jobId === resume.jobId);
  const problem: DubProblem = {
    kind: 'failed',
    title: C.failed,
    message: current.refusal.message,
    remedy: null,
    retry: { jobId: resume.jobId, note: job ? dubRetryNote(job) : null, intent: resume.intent },
    facts: null,
  };
  useDubRun.setState((s) => ({ problems: { ...s.problems, [videoId]: problem } }));
}

/** 从停下的那一步重跑同一个任务（`pipelines.retry`）。 */
export async function retryDub(videoId: Id): Promise<void> {
  const retry = useDubRun.getState().problems[videoId]?.retry;
  if (!deps || !retry || useDubRun.getState().runs[videoId]) return;
  await submit({ kind: 'retry', jobId: retry.jobId, intent: retry.intent }, []);
}

export async function cancelDub(jobId: Id): Promise<void> {
  try {
    await deps?.runtime.cancelJob(jobId);
  } catch (error) {
    deps?.toast('negative', C.cancelFailed(messageOf(error)));
  }
}

/** 盯着从这里提交的任务：结束了就收尾。每一轮只收一次——先同步改掉状态，后面的事件看到不是 `running` 就跳过。 */
function settle(jobs: readonly JobRecord[]): void {
  for (const run of Object.values(useDubRun.getState().runs)) {
    if (run.status !== 'running' || !run.jobId) continue;
    const job = jobs.find((candidate) => candidate.jobId === run.jobId);
    if (!job || isJobLive(job)) continue;
    if (run.retriedAt !== null && job.updatedAt === run.retriedAt) continue;
    patchRun(run.videoId, { status: 'settling' });
    finish({ ...run, status: 'settling' }, job);
  }
}

function finish(run: DubRun, job: JobRecord): void {
  const intent: DubIntent = { videoId: run.videoId, language: run.language, videoName: run.videoName };
  const label = langName(run.language);
  if (job.state === 'cancelled') {
    endRun(run.videoId);
    deps?.toast('neutral', C.cancelled);
    return;
  }
  if (job.state !== 'completed') {
    // 跑到一半授权被撤销、到期：同样询问，确认后重试。
    const refusal = grantRefusal(job.error);
    if (refusal) {
      ask(run.videoId, {
        refusal,
        purpose: grantPurpose(run.language, run.videoName),
        resume: { kind: 'retry', jobId: job.jobId, intent },
        granted: [],
        status: 'asking',
        error: null,
      });
      return;
    }
    const retryable = job.state === 'failed' || job.state === 'interrupted';
    endRun(run.videoId, {
      kind: 'failed',
      title: job.state === 'interrupted' ? C.interrupted : C.failed,
      message: jobErrorText(job.error) ?? '',
      remedy: dubRemedy(job),
      retry: retryable ? { jobId: job.jobId, note: dubRetryNote(job), intent } : null,
      facts: dubFailureFacts(job),
    });
    return;
  }
  const summary = dubSummaryOf(job);
  if (!summary) {
    endRun(run.videoId, { kind: 'failed', title: C.failed, message: jobErrorText(job.error) ?? '', remedy: null, retry: null, facts: null });
    return;
  }
  const duck = job.pipeline?.params.duckDb;
  const receipt: DubReceipt = {
    jobId: job.jobId,
    videoId: run.videoId,
    summary,
    duckDb: typeof duck === 'number' ? duck : null,
    warnings: dubWarnings(job),
    undone: null,
    undoing: false,
  };
  useDubRun.setState((s) => ({ runs: without(s.runs, run.videoId), receipts: { ...s.receipts, [run.videoId]: receipt } }));
  deps?.toast('positive', C.doneToast(label, summary.units.placed), () => void undoDub(run.videoId));
}

/**
 * 收据上的「撤销这组配音」：先撤掉应用配音的那一笔（配音计划文档最早一个版本的 `createdBy`，撤销时从快照里现读）；
 * 撤不了（之后又改过：`UNDO_CONFLICT`；已经撤过：`UNDO_UNAVAILABLE`）时退回部分撤销：一笔事务删掉这一组的实例、
 * 恢复这次静音的、去掉以配音轨触发的闪避（配音计划正文里记着静音了哪些）。部分撤销成功后清掉编辑器上那条撤销失败的错误。
 */
export async function undoDub(videoId: Id): Promise<void> {
  const bound = deps;
  const receipt = useDubRun.getState().receipts[videoId];
  if (!bound || !receipt || receipt.undone || receipt.undoing) return;
  const snapshotOf = () => {
    const video = useVideo.getState().video;
    return video?.videoId === videoId && canEdit(video) ? video.state!.video : null;
  };
  const first = snapshotOf();
  if (!first) {
    bound.toast('negative', C.undoNotOpen);
    return;
  }
  patchReceipt(videoId, { undoing: true });
  const { summary } = receipt;
  const label = C.undoLabel(langName(summary.language));
  try {
    const transactionId = planTransaction(first.documents[summary.planDocumentId]);
    if (transactionId && (await bound.runtime.videos.undo({ transaction: transactionId }))) {
      patchReceipt(videoId, { undone: 'full', undoing: false });
      return;
    }
    // 退回部分撤销：按现在的快照算还剩什么。
    const snapshot = snapshotOf();
    const sequence = snapshot
      ? (Object.values(snapshot.sequences).find((s) => s.tracks.some((t) => t.id === summary.trackId)) ?? rootSequence(snapshot))
      : null;
    if (!snapshot || !sequence) {
      bound.toast('negative', C.undoFailed);
      patchReceipt(videoId, { undoing: false });
      return;
    }
    let muted: Id[] = [];
    if (snapshot.documents[summary.planDocumentId]) {
      try {
        muted = mutedItemsOf((await bound.runtime.readDocument(videoId, summary.planDocumentId)).body);
      } catch {
        // 读不到配音计划：静音的实例恢复不了，别的照做。
      }
    }
    const fallback = fallbackUndoOperations(sequence, { groupId: summary.groupId, trackId: summary.trackId }, muted);
    if (fallback.operations.length === 0) {
      // 什么都不剩（比如已经用编辑器的撤销撤过）：那条撤销失败不必再挂着。
      bound.runtime.videos.clearError();
      patchReceipt(videoId, { undone: snapshot.documents[summary.planDocumentId] ? 'partial' : 'full', undoing: false });
      return;
    }
    if (!(await bound.runtime.videos.apply(fallback.operations, label))) {
      bound.toast('negative', C.undoFailed);
      patchReceipt(videoId, { undoing: false });
      return;
    }
    bound.runtime.videos.clearError();
    patchReceipt(videoId, { undone: 'partial', undoing: false });
    bound.toast('neutral', C.undonePartial);
  } catch (error) {
    bound.toast('negative', E.labeled(C.undoFailed, messageOf(error)));
    patchReceipt(videoId, { undoing: false });
  }
}
