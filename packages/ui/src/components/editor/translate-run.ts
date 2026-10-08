import { newCaptionStyle } from '../../state/caption-preferences-store.ts';
import { withNewCaptionStyle } from '../../model/caption-preferences.ts';
import { create } from 'zustand';
import {
  RpcError,
  type CapabilityNotConfiguredDetails,
  type DocumentContent,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type JobRecord,
  type TransactionReceipt,
  type TranslateParams,
  type TranslateSummary,
  type UndoTarget,
} from '@baocut/protocol';
import { captionChips, languageName } from '../../model/caption-tracks.ts';
import { rootSequence } from '../../model/editor.ts';
import { readSpeechWords, speechCaptionBody, type SpeechWords } from '../../model/speech-cues.ts';
import { jobRemedy, rejectionRemedy, type Remedy } from '../../model/task-facts.ts';
import { translateParams, type TranslateSetup } from '../../model/translate-setup.ts';
import { retryNote, translationOf } from '../../model/translate-progress.ts';
import { derivedFrom, pairedOriginal, retextCaption, translationCaptionOperations, translationCues } from '../../model/translation-cues.ts';
import { editUnit, readTranslation, type PairRow, type SourceSentence, type TranslationBody } from '../../model/translation-doc.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { focusDocument, waitForDocument } from './transcribe-run.ts';
import { TEXT_NOT_CONFIGURED_REASON, TRANSLATE_COPY as C } from './translate-copy.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { jobErrorText, remedyHintText } from '../../model/localized-text.ts';

/**
 * 字幕面板的「翻译成…」（原型 panel-aitools-flows.jsx `TranslateFlow`、panel-translate.jsx 的运行态与收据）：
 * 提交 `pipelines.start`（`translate`，带 `captions: true` 与用户选的 `bilingual`），经 `jobs` 主题跟住父任务。流程写好
 * `translation` 文档之后自己建这门语言的字幕层（jobs 的 caption-layer.ts，与 `translationCaptionOperations` 同一套放法）；
 * 完成后照 `summary.captions` 留一张带「撤销」的收据（撤的是流程建字幕层的那笔事务）。失败、中断给原因与「重试」
 * （`pipelines.retry`，同一个任务从停下的那一步接着做）。
 *
 * 状态放在模块级 store 里（同 transcribe-run.ts）：样式入口卡会切到属性页、「去模型页」会离开编辑器，翻译不能因此断线。
 * 别处（智能体、命令行）发起的只显示进度；没建字幕层的译文在对照列表里「放到画面上」（`putOnScreen`，编辑器自己放）。
 * 流程的父任务不会是 `needs-reconciliation`（Runtime 重启时记为 `interrupted`），这里照样防御着指到后台任务。
 * 不自动重试：重跑「翻译」这一步会再调一次在线模型。
 */

export type TranslateRunStatus = 'submitting' | 'running';

/** 翻译开始时的设置：完成后照它放到画面上。 */
export interface TranslateIntent {
  videoId: Id;
  speechDocumentId: Id;
  targetLanguage: string;
  /** 和原文一起显示。 */
  bilingual: boolean;
}

export interface TranslateRun extends TranslateIntent {
  /** 提交成功之前为 null。 */
  jobId: Id | null;
  status: TranslateRunStatus;
  /**
   * 重试时任务的 `updatedAt`：`pipelines.retry` 回来时镜像里可能还是那条已经结束的记录，有别的任务事件进来时
   * 不能把它当成这一次的结果再收一遍尾。记录一变（开始重跑）就不再相等。
   */
  retriedAt: string | null;
}

export type TranslateProblemKind = 'not-configured' | 'failed' | 'empty' | 'pending' | 'decide';

export interface TranslateProblem {
  kind: TranslateProblemKind;
  title: string;
  message: string;
  /** 去模型页、设置或后台任务的补救。 */
  remedy: Remedy | null;
  /** 能重试的流程：同一个任务；`note` 说重试会不会再计费。 */
  retry: { jobId: Id; note: 'charges' | 'free' | null; intent: TranslateIntent } | null;
}

/** 一次翻译放到画面上之后的收据（原型 `DoneView`）：一次 AI run 收尾一定留一个能撤销的出口。 */
export interface TranslateReceipt {
  /** 建字幕层的那笔事务；Runtime 没给时 null（不给「撤销」）。 */
  transactionId: Id | null;
  language: string;
  translationDocumentId: Id;
  count: number;
  bilingual: boolean;
  undone: boolean;
}

export type CompareMode = 'src' | 'bi' | 'trans';

/** 对照条（原型 panel-subtitle.jsx `ListBar`）：列表看原文、原文＋译文还是只看译文，对照哪一份译文。 */
export interface ComparePref {
  mode: CompareMode;
  /** 对照的 `translation` 文档；没选时 null（取第一份）。 */
  documentId: Id | null;
}

interface TranslateRunState {
  runs: Record<Id, TranslateRun>;
  problems: Record<Id, TranslateProblem>;
  receipts: Record<Id, TranslateReceipt>;
  compare: Record<Id, ComparePref>;
  /** 设置页开着（面板卸载再挂回来时还在，比如从模型页配好文本模型回来）。 */
  flow: Record<Id, boolean>;
}

const EMPTY: TranslateRunState = { runs: {}, problems: {}, receipts: {}, compare: {}, flow: {} };

export const useTranslateRun = create<TranslateRunState>()(() => ({ ...EMPTY }));

/** 用到的会话能力；测试给假的。 */
export interface TranslateDeps {
  runtime: {
    startTranslate(params: TranslateParams): Promise<Id>;
    retryPipeline(jobId: Id): Promise<void>;
    cancelJob(jobId: Id): Promise<void>;
    readDocument(videoId: Id, documentId: Id, revision?: string): Promise<DocumentContent>;
    videos: {
      apply(operations: EditOperation[], label?: string): Promise<TransactionReceipt | null>;
      undo(target: UndoTarget): Promise<TransactionReceipt | null>;
    };
  };
  /** `undo` 有值时提示带「撤销」。 */
  toast(kind: 'positive' | 'neutral' | 'negative', message: string, undo?: () => void): void;
}

let deps: TranslateDeps | null = null;
let unwatch: (() => void) | null = null;

/** 面板挂上时绑定会话与提示；第一次绑定时开始盯 `jobs` 主题。 */
export function bindTranslate(next: TranslateDeps): void {
  deps = next;
  unwatch ??= useJobs.subscribe((state) => settle(state.jobs));
}

/** 测试用：解绑并清空状态。 */
export function resetTranslate(): void {
  unwatch?.();
  unwatch = null;
  deps = null;
  useTranslateRun.setState({ ...EMPTY });
}

const without = <T>(record: Record<Id, T>, key: Id): Record<Id, T> => {
  const { [key]: _, ...rest } = record;
  return rest;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function setRun(run: TranslateRun): void {
  useTranslateRun.setState((s) => ({ runs: { ...s.runs, [run.videoId]: run }, problems: without(s.problems, run.videoId) }));
}

function patchRun(videoId: Id, patch: Partial<TranslateRun>): void {
  useTranslateRun.setState((s) => (s.runs[videoId] ? { runs: { ...s.runs, [videoId]: { ...s.runs[videoId]!, ...patch } } } : {}));
}

function endRun(videoId: Id, problem?: TranslateProblem): void {
  useTranslateRun.setState((s) => ({
    runs: without(s.runs, videoId),
    problems: problem ? { ...s.problems, [videoId]: problem } : s.problems,
  }));
}

function report(videoId: Id, problem: TranslateProblem): void {
  useTranslateRun.setState((s) => ({ problems: { ...s.problems, [videoId]: problem } }));
}

export function dismissTranslateProblem(videoId: Id): void {
  useTranslateRun.setState((s) => ({ problems: without(s.problems, videoId) }));
}

export function dismissReceipt(videoId: Id): void {
  useTranslateRun.setState((s) => ({ receipts: without(s.receipts, videoId) }));
}

export function setCompare(videoId: Id, pref: ComparePref): void {
  useTranslateRun.setState((s) => ({ compare: { ...s.compare, [videoId]: pref } }));
}

export function openFlow(videoId: Id, open: boolean): void {
  useTranslateRun.setState((s) => ({ flow: open ? { ...s.flow, [videoId]: true } : without(s.flow, videoId) }));
}

function isNotConfigured(details: unknown): details is CapabilityNotConfiguredDetails {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { code?: unknown }).code === 'CAPABILITY_NOT_CONFIGURED' &&
    typeof (details as { remedy?: unknown }).remedy === 'object'
  );
}

/** 提交时被拒：没有配置文本模型时就地给原因、`remedy.hint` 与去模型页的路；别的（模型不支持结构化输出等）照原话。 */
export function translateSubmitProblem(error: unknown): TranslateProblem {
  const message = messageOf(error);
  const details = error instanceof RpcError ? error.details : (error as { details?: unknown } | null)?.details;
  if (isNotConfigured(details)) {
    return {
      kind: 'not-configured',
      title: C.notConfigured(TEXT_NOT_CONFIGURED_REASON[details.reason] ?? details.reason),
      message: remedyHintText(details.remedy) || message,
      remedy: rejectionRemedy('generateText', error),
      retry: null,
    };
  }
  return { kind: 'failed', title: C.submitFailed, message, remedy: null, retry: null };
}

/** 提交翻译。同一个视频同时只翻一门（「一门语言一条轨」，并发的两门会抢同一份原文的配对）。 */
export async function startTranslate(setup: TranslateSetup & { bilingual: boolean }): Promise<boolean> {
  const bound = deps;
  const { videoId } = setup;
  if (!bound || useTranslateRun.getState().runs[videoId]) return false;
  const intent: TranslateIntent = {
    videoId,
    speechDocumentId: setup.speechDocumentId,
    targetLanguage: setup.targetLanguage,
    bilingual: setup.bilingual,
  };
  setRun({ ...intent, jobId: null, status: 'submitting', retriedAt: null });
  useTranslateRun.setState((s) => ({ receipts: without(s.receipts, videoId) }));
  try {
    // 字幕层由流程建（`captions: true`），双语与否照用户选的。
    const jobId = await bound.runtime.startTranslate({ ...translateParams(setup), captions: true, bilingual: setup.bilingual, captionStyle: newCaptionStyle() });
    patchRun(videoId, { jobId, status: 'running' });
    // 任务事件可能比回执先到；这是新任务，镜像里不会有它结束了的旧记录。
    settle(useJobs.getState().jobs);
    return true;
  } catch (error) {
    endRun(videoId, translateSubmitProblem(error));
    return false;
  }
}

/** 从停下的那一步重跑同一个任务（`pipelines.retry`），完成后照当初的设置放到画面上。 */
export async function retryTranslate(videoId: Id): Promise<void> {
  const bound = deps;
  const retry = useTranslateRun.getState().problems[videoId]?.retry;
  if (!bound || !retry || useTranslateRun.getState().runs[videoId]) return;
  const before = useJobs.getState().jobs.find((job) => job.jobId === retry.jobId);
  setRun({ ...retry.intent, jobId: retry.jobId, status: 'submitting', retriedAt: null });
  try {
    await bound.runtime.retryPipeline(retry.jobId);
    patchRun(videoId, { status: 'running', retriedAt: before?.updatedAt ?? null });
  } catch (error) {
    // 还能再试：留着「重试」。
    endRun(videoId, { kind: 'failed', title: C.failed, message: C.retryFailed(messageOf(error)), remedy: null, retry });
  }
}

export async function cancelTranslate(jobId: Id): Promise<void> {
  try {
    await deps?.runtime.cancelJob(jobId);
  } catch (error) {
    deps?.toast('negative', C.cancelFailed(messageOf(error)));
  }
}

/** 盯着从这里提交的任务：结束了就收尾。每一轮只收一次——先同步改掉状态，后面的事件看到不是 `running` 就跳过。 */
function settle(jobs: readonly JobRecord[]): void {
  for (const run of Object.values(useTranslateRun.getState().runs)) {
    if (run.status !== 'running' || !run.jobId) continue;
    const job = jobs.find((candidate) => candidate.jobId === run.jobId);
    if (!job || isJobLive(job)) continue;
    // 重试之前那条已经结束的记录：等它变。
    if (run.retriedAt !== null && job.updatedAt === run.retriedAt) continue;
    finish(run, job);
  }
}

function finish(run: TranslateRun, job: JobRecord): void {
  const intent: TranslateIntent = {
    videoId: run.videoId,
    speechDocumentId: run.speechDocumentId,
    targetLanguage: run.targetLanguage,
    bilingual: run.bilingual,
  };
  if (job.state === 'cancelled') {
    endRun(run.videoId);
    deps?.toast('neutral', C.cancelled);
    return;
  }
  if (job.state === 'needs-reconciliation') {
    endRun(run.videoId, {
      kind: 'decide',
      title: C.failed,
      message: jobErrorText(job.error) ?? '',
      remedy: { label: C.decide, target: { tab: 'tasks', taskId: job.jobId }, hint: '' },
      retry: null,
    });
    return;
  }
  if (job.state !== 'completed') {
    endRun(run.videoId, {
      kind: 'failed',
      title: job.state === 'interrupted' ? C.interrupted : C.failed,
      message: jobErrorText(job.error) ?? '',
      // 父任务的种类是 `pipeline`，补救按它用的文本模型找（凭据、配置问题去模型页）。
      remedy: jobRemedy({ kind: 'generateText', providerId: job.providerId, error: job.error }),
      retry: { jobId: job.jobId, note: retryNote(job), intent },
    });
    return;
  }
  const translationDocumentId = translationOf(job);
  if (!translationDocumentId) {
    endRun(run.videoId, { kind: 'failed', title: C.failed, message: C.badDocument, remedy: null, retry: null });
    return;
  }
  const captions = (job.pipeline?.summary as Partial<TranslateSummary> | null | undefined)?.captions;
  const language = languageName(run.targetLanguage);
  const compare: ComparePref = { mode: run.bilingual ? 'bi' : 'trans', documentId: translationDocumentId };
  if (captions?.status === 'empty') {
    endRun(run.videoId, { kind: 'empty', title: C.emptyTitle, message: C.empty, remedy: null, retry: null });
    return;
  }
  if (captions?.status !== 'created' && captions?.status !== 'existing') {
    // 投不到画面上（素材不在时间线上），或流程没建字幕层：译文在视频里，留一句在对照列表里「放到画面上」。
    endRun(run.videoId, {
      kind: 'pending',
      title: C.pendingTitle,
      message: captions?.status === 'not-on-timeline' ? C.offTimeline : C.pending,
      remedy: null,
      retry: null,
    });
    return;
  }
  // `existing`：执行期间别处已经给这份译文建了字幕层，收据指向它、不给撤销。
  const receipt: TranslateReceipt = {
    transactionId: captions.status === 'created' ? (captions.transactionId ?? null) : null,
    language,
    translationDocumentId,
    count: captions.cueCount ?? cueCountOf(run.videoId, captions.documentId ?? null),
    bilingual: captions.bilingual ?? run.bilingual,
    undone: false,
  };
  useTranslateRun.setState((s) => ({
    runs: without(s.runs, run.videoId),
    receipts: { ...s.receipts, [run.videoId]: receipt },
    compare: { ...s.compare, [run.videoId]: compare },
  }));
  if (captions.documentId) focusDocument(run.videoId, captions.documentId);
}

/** 快照里一份字幕文档当前版本的条数；读不到时 0。 */
function cueCountOf(videoId: Id, documentId: Id | null): number {
  const video = useVideo.getState().video;
  const record = documentId && video?.videoId === videoId ? video.state?.video.documents[documentId] : undefined;
  const summary = record?.revisions[record.currentRevision]?.summary as { cueCount?: unknown } | undefined;
  return typeof summary?.cueCount === 'number' ? summary.cueCount : 0;
}

type PlaceOutcome =
  { placed: { transactionId: Id; language: string; count: number }; captionDocumentId: Id | null } | { problem: TranslateProblem };

const pending = (message: string = C.pending): PlaceOutcome => ({
  problem: { kind: 'pending', title: C.pendingTitle, message, remedy: null, retry: null },
});

/**
 * 把一份已经在视频里的译文放到画面上（对照列表的「放到画面上」，一笔事务）：读译文与它译自的转写，按原句成员词的时间
 * 切成字幕，新建这门语言的字幕轨。视频没开着、只读、或等不到译文进快照时不写，留一句「在对照列表里放到画面上」。
 * 从这里提交的翻译不走这里：字幕层由流程建。
 */
async function place(videoId: Id, translationDocumentId: Id, bilingual: boolean): Promise<PlaceOutcome> {
  const bound = deps;
  if (!bound) return pending();
  try {
    if (!(await waitForDocument(videoId, translationDocumentId))) return pending();
    const content = await bound.runtime.readDocument(videoId, translationDocumentId);
    const translation = readTranslation(content.body);
    const speechDocumentId = content.document.sourceDocumentId ?? translation?.sourceBasis.speechRef.id ?? null;
    if (!translation || !speechDocumentId) return { problem: { kind: 'failed', title: C.failed, message: C.badDocument, remedy: null, retry: null } };
    const speechContent = await bound.runtime.readDocument(videoId, speechDocumentId);
    const speech = readSpeechWords(speechContent.body);
    const assetId = speechContent.document.sourceAssetId ?? null;
    if (!speech || !assetId) return { problem: { kind: 'failed', title: C.failed, message: C.badDocument, remedy: null, retry: null } };
    const video = useVideo.getState().video;
    const snapshot = video?.videoId === videoId && canEdit(video) ? video.state!.video : null;
    const sequence = snapshot ? rootSequence(snapshot) : null;
    if (!snapshot || !sequence) return pending();
    const cues = translationCues(speech, translation.units);
    if (!cues.length) return { problem: { kind: 'empty', title: C.emptyTitle, message: C.empty, remedy: null, retry: null } };
    const body = speechCaptionBody(cues, speech.speakers);
    const language = translation.language || content.document.language || '';
    const label = language ? languageName(language) : C.unnamed;
    const paired = pairedOriginal(captionChips(sequence, snapshot.documents), snapshot.documents, speechDocumentId);
    const operations = translationCaptionOperations(
      sequence,
      body,
      {
        translationDocumentId,
        translationRevision: content.revision,
        speechDocumentId,
        speechRevision: speechContent.revision,
        assetId,
        language,
        name: label,
        bilingual,
      },
      paired,
    );
    // 失败时编辑器已经提示了引擎的原话；译文还在视频里，留一句怎么接着做。
    const receipt = await bound.runtime.videos.apply(withNewCaptionStyle(operations, newCaptionStyle()), C.translateTo(label));
    if (!receipt) return pending();
    return {
      placed: { transactionId: receipt.transactionId, language: label, count: cues.length },
      captionDocumentId: receipt.refs?.['translation-caption'] ?? null,
    };
  } catch (error) {
    return pending(E.thenNext(messageOf(error), C.pending));
  }
}

/** 收据上的「撤销」：撤掉放到画面上的那一笔（新轨、字幕文档、实例与原文的显示变化）；译文文档是 Runtime 另写的，留着。 */
export async function undoReceipt(videoId: Id): Promise<void> {
  const bound = deps;
  const receipt = useTranslateRun.getState().receipts[videoId];
  if (!bound || !receipt?.transactionId || receipt.undone) return;
  const result = await bound.runtime.videos.undo({ transaction: receipt.transactionId });
  if (!result) {
    bound.toast('negative', C.undoFailed);
    return;
  }
  useTranslateRun.setState((s) => (s.receipts[videoId] ? { receipts: { ...s.receipts, [videoId]: { ...s.receipts[videoId]!, undone: true } } } : {}));
}

/** 已经在视频里、还没放到画面上的译文（别处翻的、撤销过的）：放上去，提示带「撤销」。 */
export async function putOnScreen(videoId: Id, translationDocumentId: Id, bilingual = true): Promise<void> {
  const bound = deps;
  if (!bound) return;
  const outcome = await place(videoId, translationDocumentId, bilingual);
  if ('problem' in outcome) {
    report(videoId, outcome.problem);
    return;
  }
  dismissTranslateProblem(videoId);
  if (outcome.captionDocumentId) focusDocument(videoId, outcome.captionDocumentId);
  const { transactionId, language, count } = outcome.placed;
  bound.toast('positive', C.placed(language, count), () => {
    void bound.runtime.videos.undo({ transaction: transactionId });
  });
}

export interface TranslationEdit {
  videoId: Id;
  /** 译文文档。 */
  record: DocumentRecord;
  body: TranslationBody;
  sentences: readonly SourceSentence[];
  row: PairRow;
  text: string;
  /** 译文译自的转写：重新切这一句的字幕用。 */
  speech: SpeechWords;
  documents: Record<Id, DocumentRecord>;
}

/**
 * 就地改一句译文（单击译文侧、失焦提交）：一笔事务写译文文档的新版本，连同从它生成的字幕文档里这一句的几条
 * （`retextCaption`，别的条不动）。撤销一次两边一起回去。返回新的正文（面板在新版本取回来之前先用它）；没改动时 null。
 */
export async function editTranslation(edit: TranslationEdit): Promise<TranslationBody | null> {
  const bound = deps;
  if (!bound) return null;
  const result = await editUnit(edit.body, edit.sentences, edit.row, edit.text);
  if (!result) return null;
  try {
    const previous = edit.record.revisions[edit.record.currentRevision]?.summary;
    const operations: EditOperation[] = [
      {
        type: 'putDocument',
        documentId: edit.record.id,
        kind: edit.record.kind,
        body: result.body,
        summary: { ...(previous && typeof previous === 'object' ? previous : {}), unitCount: result.body.units.length },
      },
    ];
    const fresh = translationCues(edit.speech, [result.unit]);
    for (const caption of Object.values(edit.documents)) {
      if (!derivedFrom(caption, edit.record.id)) continue;
      const content = await bound.runtime.readDocument(edit.videoId, caption.id);
      if (typeof content.body !== 'object' || content.body === null) continue;
      const body = retextCaption(content.body as Record<string, unknown>, result.unit.id, fresh, edit.speech.speakers);
      const summary = caption.revisions[caption.currentRevision]?.summary;
      operations.push({
        type: 'putDocument',
        documentId: caption.id,
        kind: caption.kind,
        body,
        summary: { ...(summary && typeof summary === 'object' ? summary : {}), cueCount: Array.isArray(body.cues) ? body.cues.length : 0 },
      });
    }
    const receipt = await bound.runtime.videos.apply(operations, C.rewriteTranslation);
    if (!receipt) return null;
    bound.toast('positive', C.edited, () => {
      void bound.runtime.videos.undo({ transaction: receipt.transactionId });
    });
    return result.body;
  } catch (error) {
    bound.toast('negative', C.editFailed(messageOf(error)));
    return null;
  }
}
