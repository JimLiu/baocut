import { create } from 'zustand';
import { ToastQueue } from '@react-spectrum/s2';
import type { DocumentContent, DocumentRecord, DubParams, EditOperation, Id, JobRecord, TransactionReceipt, UndoTarget } from '@baocut/protocol';
import { dubSummaryOf } from '../../model/dub-progress.ts';
import { grantRefusal } from '../../model/dub-setup.ts';
import { retextTranslation } from '../../model/dub-takes.ts';
import { readTranslation } from '../../model/translation-doc.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { DUB_REGEN_COPY as C } from './dub-copy.ts';
import { jobErrorText } from '../../model/localized-text.ts';

/**
 * 句级重配的提交与收尾（设计稿 timeline-dub.jsx 的「重新生成这几句」「改译文并重配…」，panel-dub-fit.jsx）：
 * 提交 `pipelines.start`（`dub` 带 `regroup`），只重配这几句、写回原来那一组。哪几句在排队不记在这里——时间线从 `jobs` 镜像里
 * 在跑的配音流程冻结的 `params.regroup` 读（model/dub-takes.ts），从别处（智能体、命令行）发起的也一样画。
 *
 * 与工具页里的翻译配音（dub-run.ts）分开：那边按视频一次只配一组、完成后留整组的收据；这里同一个视频可以同时重配几组里的
 * 不同句子，完成时只给一条提示（换上了几句、哪几句没换上），带「撤销」——撤的是 Runtime 写回的那一笔（配音计划在那一笔里
 * 写了新版本，版本的 `createdBy` 就是那一笔事务）。
 *
 * 授权：外发只有合成一项。被拒（`GRANT_REQUIRED` / `GRANT_REVOKED`）时如实提示缺哪一家的授权，不在这里发授权。
 */

/** 用到的会话与编辑能力；测试给假的。 */
export interface RegenDeps {
  runtime: {
    startDub(params: DubParams): Promise<Id>;
    readDocument(videoId: Id, documentId: Id, revision?: string): Promise<DocumentContent>;
  };
  apply(operations: EditOperation[], label?: string): Promise<TransactionReceipt | null>;
  undo(target: UndoTarget): Promise<TransactionReceipt | null>;
}

/** 编辑器里的依赖：会话与编辑动作（动作经闭包调，不依赖 `this`）。 */
export function regenDeps(runtime: RegenDeps['runtime'], actions: Pick<RegenDeps, 'apply' | 'undo'>): RegenDeps {
  return { runtime, apply: (operations, label) => actions.apply(operations, label), undo: (target) => actions.undo(target) };
}

interface Pending {
  jobId: Id;
  videoId: Id;
  groupId: string;
  units: Id[];
  /** 这一组的配音计划，与提交时它已有的版本：完成后多出来的那一版是 Runtime 写回的。 */
  planDocumentId: Id | null;
  revisions: string[];
  deps: RegenDeps;
}

/** 「改译文并重配」对话框要打开的那几句。 */
export interface FitRequest {
  videoId: Id;
  groupId: string;
  units: Id[];
}

interface RegenState {
  pending: Record<Id, Pending>;
  /** 正在提交的组（提交回执之前）。 */
  busy: Record<string, true>;
  fit: FitRequest | null;
}

export const useDubRegen = create<RegenState>()(() => ({ pending: {}, busy: {}, fit: null }));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const TOAST_MS = 5000;

let unwatch: (() => void) | null = null;

/** 测试用：清空状态并停止盯任务。 */
export function resetDubRegen(): void {
  unwatch?.();
  unwatch = null;
  useDubRegen.setState({ pending: {}, busy: {}, fit: null });
}

export function openDubFit(request: FitRequest): void {
  if (request.units.length > 0) useDubRegen.setState({ fit: request });
}

export function closeDubFit(): void {
  useDubRegen.setState({ fit: null });
}

function documentsOf(videoId: Id): Record<Id, DocumentRecord> | null {
  const video = useVideo.getState().video;
  return video?.videoId === videoId ? (video.state?.video.documents ?? null) : null;
}

export interface RegenRequest {
  videoId: Id;
  groupId: string;
  units: Id[];
  /** 这一组的配音计划（撤销要找它的新版本）。 */
  planDocumentId: Id | null;
}

/** 只重配这几句（换个种子）。提交成功返回任务 ID；同一组正在提交、没有句子时什么都不做。 */
export async function regenerateUnits(deps: RegenDeps, request: RegenRequest): Promise<Id | null> {
  const { videoId, groupId, units, planDocumentId } = request;
  if (units.length === 0) return null;
  if (useDubRegen.getState().busy[groupId]) {
    ToastQueue.neutral(C.busy, { timeout: TOAST_MS });
    return null;
  }
  const plan = planDocumentId ? documentsOf(videoId)?.[planDocumentId] : undefined;
  useDubRegen.setState((s) => ({ busy: { ...s.busy, [groupId]: true } }));
  try {
    const jobId = await deps.runtime.startDub({ videoId, regroup: { groupId, units: [...units], seed: 'new' } });
    useDubRegen.setState((s) => ({
      pending: {
        ...s.pending,
        [jobId]: { jobId, videoId, groupId, units: [...units], planDocumentId, revisions: plan ? Object.keys(plan.revisions) : [], deps },
      },
    }));
    unwatch ??= useJobs.subscribe((state) => settle(state.jobs));
    ToastQueue.neutral(C.submitted(units.length), { timeout: TOAST_MS });
    // 任务事件可能比回执先到。
    settle(useJobs.getState().jobs);
    return jobId;
  } catch (error) {
    const refusal = grantRefusal(error);
    ToastQueue.negative(refusal ? C.grantRefused(refusal.recipient) : C.submitFailed(messageOf(error)), { timeout: TOAST_MS * 2 });
    return null;
  } finally {
    useDubRegen.setState((s) => {
      const { [groupId]: _, ...rest } = s.busy;
      return { busy: rest };
    });
  }
}

export interface RetextRequest extends RegenRequest {
  /** 这组配音用的译文（计划正文的 `translationRef.id`）。 */
  translationId: Id | null;
  /** 译文单元 → 改成的文字；没改的不给。 */
  texts: ReadonlyMap<Id, string>;
}

/**
 * 改译文并重配：先在一笔编辑里写译文的新版本（只改给了的几句），等它提交了再只重配这几句——合成读的是译文的当前版本。
 * 改译文那一笔失败时（编辑器已经提示）不重配。
 */
export async function retextAndRegenerate(deps: RegenDeps, request: RetextRequest): Promise<Id | null> {
  const { videoId, translationId, texts } = request;
  if (translationId && texts.size > 0) {
    let content: DocumentContent;
    try {
      content = await deps.runtime.readDocument(videoId, translationId);
    } catch (error) {
      ToastQueue.negative(C.submitFailed(messageOf(error)), { timeout: TOAST_MS * 2 });
      return null;
    }
    const body = readTranslation(content.body);
    const result = body ? await retextTranslation(body, texts) : null;
    if (result) {
      const record = documentsOf(videoId)?.[translationId];
      const previous = record?.revisions[record.currentRevision]?.summary;
      const receipt = await deps.apply(
        [
          {
            type: 'putDocument',
            documentId: translationId,
            kind: record?.kind ?? 'translation',
            body: result.body,
            summary: { ...(previous && typeof previous === 'object' ? previous : {}), unitCount: result.body.units.length },
          },
        ],
        C.labelRetext,
      );
      if (!receipt) return null;
    }
  }
  return regenerateUnits(deps, request);
}

/** Runtime 写回的那一笔：配音计划在提交之后多出来的最早一个版本的 `createdBy`。 */
function regroupTransaction(pending: Pending): Id | null {
  if (!pending.planDocumentId) return null;
  const record = documentsOf(pending.videoId)?.[pending.planDocumentId];
  if (!record) return null;
  const known = new Set(pending.revisions);
  let first: { createdAt: string; createdBy: Id } | null = null;
  for (const [key, revision] of Object.entries(record.revisions)) {
    if (known.has(key) || !revision?.createdBy) continue;
    if (!first || revision.createdAt < first.createdAt) first = revision;
  }
  return first?.createdBy ?? null;
}

/** 盯着从这里提交的任务：结束了就收尾，每个只收一次（先同步删掉）。 */
function settle(jobs: readonly JobRecord[]): void {
  for (const pending of Object.values(useDubRegen.getState().pending)) {
    const job = jobs.find((candidate) => candidate.jobId === pending.jobId);
    if (!job || isJobLive(job)) continue;
    useDubRegen.setState((s) => {
      const { [pending.jobId]: _, ...rest } = s.pending;
      return { pending: rest };
    });
    finish(pending, job);
  }
  if (Object.keys(useDubRegen.getState().pending).length === 0) {
    unwatch?.();
    unwatch = null;
  }
}

function finish(pending: Pending, job: JobRecord): void {
  if (job.state === 'cancelled') {
    ToastQueue.neutral(C.cancelled, { timeout: TOAST_MS });
    return;
  }
  if (job.state !== 'completed') {
    ToastQueue.negative(C.failed(jobErrorText(job.error) ?? job.state), { timeout: TOAST_MS * 2 });
    return;
  }
  const units = dubSummaryOf(job)?.regroup?.units ?? [];
  const replaced = units.filter((u) => u.status === 'replaced').length;
  const others = new Map<string, number>();
  for (const unit of units) if (unit.status !== 'replaced') others.set(unit.status, (others.get(unit.status) ?? 0) + 1);
  const rest = [...others].map(([status, n]) => C.notPlaced(status, n));
  if (replaced === 0) {
    ToastQueue.neutral([C.doneNone, ...rest].join(' · '), { timeout: TOAST_MS * 2 });
    return;
  }
  ToastQueue.positive([C.done(replaced, units.length || pending.units.length), ...rest].join(' · '), {
    actionLabel: C.undo,
    shouldCloseOnAction: true,
    onAction: () => {
      const transaction = regroupTransaction(pending);
      if (!transaction) {
        ToastQueue.neutral(C.undoMissing, { timeout: TOAST_MS });
        return;
      }
      void pending.deps.undo({ transaction });
    },
  });
}
