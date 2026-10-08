import { newCaptionStyle } from '../../state/caption-preferences-store.ts';
import { withNewCaptionStyle } from '../../model/caption-preferences.ts';
import { create } from 'zustand';
import {
  RpcError,
  type AssetRecord,
  type CapabilityNotConfiguredDetails,
  type DocumentContent,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type JobRecord,
  type Sequence,
  type TransactionReceipt,
  type TranscribeSummary,
  type UndoTarget,
} from '@baocut/protocol';
import { guessLanguage } from '../../model/cue-edit.ts';
import { rootSequence } from '../../model/editor.ts';
import { formatClock } from '../../model/format.ts';
import {
  deriveCues,
  projectableItems,
  projectSpeech,
  readSpeechWords,
  speechCaptionBody,
  speechCaptionOperations,
} from '../../model/speech-cues.ts';
import { jobRemedy, type Remedy } from '../../model/task-facts.ts';
import { reconcileOptions } from '../../model/task-reconcile.ts';
import type { TranscribeOptions, TranscribeSetup } from '../../model/transcribe-setup.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { NOT_CONFIGURED_REASON, SUBTITLE_COPY as C } from './subtitle-copy.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { jobErrorText, remedyHintText } from '../../model/localized-text.ts';

/**
 * 字幕面板的「生成字幕」「重新转录」（原型 panel-subtitle.jsx 空态 → `LiveHead`）：提交转录流程（`pipelines.start` 的
 * `transcribe`，架构设计 §7.9），经 `jobs` 主题跟住父任务。流程转写之后自己建字幕层（jobs 的 caption-layer.ts，切法与
 * model/speech-cues.ts 相同）：新增一份转写、不覆盖；这个素材已经有原文字幕显示着时，新的一层停用着放上去。完成后按
 * `summary.captions` 选中新的那层、给带「撤销」的提示（撤的是流程建字幕层的那笔事务）。
 *
 * 用视频里已有的转写生成（`generateFromSpeech`）不再识别，仍在编辑器里切好、一笔事务写进去。
 *
 * 状态放在模块级的 store 里而不是面板里：样式入口卡会切到属性页，字幕面板随之卸载，转录不能因此断了线。
 * 别处（智能体、命令行）发起的转录只显示进度，完成后由用户点「生成字幕」用它写进视频的转写。
 */

export type RunStatus = 'submitting' | 'running' | 'writing';

export interface TranscribeRun {
  videoId: Id;
  assetId: Id;
  assetName: string;
  /** 提交成功之前、以及直接用已有转写生成时为 null。 */
  jobId: Id | null;
  status: RunStatus;
}

export type ProblemKind = 'not-configured' | 'failed' | 'empty' | 'pending' | 'decide';

export interface TranscribeProblem {
  kind: ProblemKind;
  title: string;
  message: string;
  /** 去模型页、设置或服务页的补救（`jobRemedy`）。 */
  remedy: Remedy | null;
}

interface SubtitleRunState {
  runs: Record<Id, TranscribeRun>;
  problems: Record<Id, TranscribeProblem>;
  /** 刚生成的字幕文档：面板下次渲染时选中它。 */
  focus: Record<Id, Id>;
  /** 每个视频里轨条选中的 chip（面板卸载再挂回来时还在）。 */
  chosen: Record<Id, string>;
  /** 每个视频的转录设置（语言、模型、提示词）；没有时用默认值。术语表不在这里：那是视频自己记的。 */
  setups: Record<Id, TranscribeSetup>;
}

export const useSubtitleRun = create<SubtitleRunState>()(() => ({ runs: {}, problems: {}, focus: {}, chosen: {}, setups: {} }));

/** 用到的会话能力；测试给假的。 */
export interface TranscribeDeps {
  runtime: {
    startPipeline(pipeline: string, params: Record<string, unknown>): Promise<Id>;
    readDocument(videoId: Id, documentId: Id, revision?: string): Promise<DocumentContent>;
    cancelJob(jobId: Id): Promise<void>;
    videos: {
      apply(operations: EditOperation[], label?: string): Promise<TransactionReceipt | null>;
      undo(target: UndoTarget): Promise<TransactionReceipt | null>;
    };
  };
  /** `undo` 有值时提示带「撤销」。 */
  toast(kind: 'positive' | 'neutral' | 'negative', message: string, undo?: () => void): void;
}

let deps: TranscribeDeps | null = null;
let unwatch: (() => void) | null = null;

/** 面板挂上时绑定会话与提示；第一次绑定时开始盯 `jobs` 主题。 */
export function bindTranscribe(next: TranscribeDeps): void {
  deps = next;
  unwatch ??= useJobs.subscribe((state) => settle(state.jobs));
}

/** 测试用：解绑并清空状态。 */
export function resetTranscribe(): void {
  unwatch?.();
  unwatch = null;
  deps = null;
  useSubtitleRun.setState({ runs: {}, problems: {}, focus: {}, chosen: {}, setups: {} });
}

const without = <T>(record: Record<Id, T>, key: Id): Record<Id, T> => {
  const { [key]: _, ...rest } = record;
  return rest;
};

function setRun(run: TranscribeRun): void {
  useSubtitleRun.setState((s) => ({ runs: { ...s.runs, [run.videoId]: run }, problems: without(s.problems, run.videoId) }));
}

function patchRun(videoId: Id, patch: Partial<TranscribeRun>): void {
  useSubtitleRun.setState((s) => (s.runs[videoId] ? { runs: { ...s.runs, [videoId]: { ...s.runs[videoId]!, ...patch } } } : {}));
}

/** 结束这一轮；带问题时把问题留在面板上。 */
function endRun(videoId: Id, problem?: TranscribeProblem): void {
  useSubtitleRun.setState((s) => ({
    runs: without(s.runs, videoId),
    problems: problem ? { ...s.problems, [videoId]: problem } : s.problems,
  }));
}

/**
 * 要用户在任务详情里拿主意的转写 Job（架构设计 §7.5）：结果不明（可能已经计费，不自动重发），或识别结果在、没写进视频
 * （`APPLY_FAILED`、`STALE_JOB_INPUT`，可以重新写入）。转录流程的转写一步碰上这种 Job 时流程失败，这里指到那个 Job；
 * 处理完、转写写进视频之后，「生成字幕」会直接用它。用户自己取消的（`cancelled`，哪怕结果在）不再追问。
 */
export function awaitingDecision(job: JobRecord): boolean {
  return job.state === 'needs-reconciliation' || (job.state === 'failed' && reconcileOptions(job).includes('apply'));
}

export function decisionProblem(job: JobRecord): TranscribeProblem {
  const unsettled = job.state === 'needs-reconciliation';
  return {
    kind: 'decide',
    title: unsettled ? C.unsettledTitle : C.unappliedTitle,
    message: unsettled ? C.unsettled : C.unapplied(jobErrorText(job.error) ?? ''),
    remedy: { label: C.decide, target: { tab: 'tasks', taskId: job.jobId }, hint: '' },
  };
}

export function dismissProblem(videoId: Id): void {
  useSubtitleRun.setState((s) => ({ problems: without(s.problems, videoId) }));
}

export function chooseChip(videoId: Id, key: string): void {
  useSubtitleRun.setState((s) => ({ chosen: { ...s.chosen, [videoId]: key } }));
}

/** 改这个视频的转录设置（没设过时从默认值改起）。 */
export function patchSetup(videoId: Id, base: TranscribeSetup, patch: Partial<TranscribeSetup>): void {
  useSubtitleRun.setState((s) => ({ setups: { ...s.setups, [videoId]: { ...(s.setups[videoId] ?? base), ...patch } } }));
}

/** 让面板选中这份字幕文档（生成或导入之后）。 */
export function focusDocument(videoId: Id, documentId: Id): void {
  useSubtitleRun.setState((s) => ({ focus: { ...s.focus, [videoId]: documentId } }));
}

export function clearFocus(videoId: Id): void {
  useSubtitleRun.setState((s) => ({ focus: without(s.focus, videoId) }));
}

function isNotConfigured(details: unknown): details is CapabilityNotConfiguredDetails {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { code?: unknown }).code === 'CAPABILITY_NOT_CONFIGURED' &&
    typeof (details as { remedy?: unknown }).remedy === 'object'
  );
}

/** 提交时被拒：没有配置转录时就地给出原因、`remedy.hint` 与去处。 */
export function submitProblem(error: unknown): TranscribeProblem {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof RpcError ? error.details : (error as { details?: unknown } | null)?.details;
  if (isNotConfigured(details)) {
    return {
      kind: 'not-configured',
      title: C.notConfigured(NOT_CONFIGURED_REASON[details.reason] ?? details.reason),
      message: remedyHintText(details.remedy) || message,
      remedy: jobRemedy({ kind: 'transcribe', providerId: details.providerId ?? '', error: { code: details.code, message, details } }),
    };
  }
  return { kind: 'failed', title: C.submitFailed, message, remedy: null };
}

export interface MediaCandidate {
  asset: AssetRecord;
  /** 这段素材已有的转写（最新的那份）：有就直接用它生成，不再识别。 */
  speech: DocumentRecord | null;
}

/**
 * 能生成字幕的素材：时间线上放着、能投影到序列上的视频与音频（只在库里的转录了也落不到画面上），按在时间线上第一次出现的先后排。
 */
export function mediaCandidates(sequence: Sequence, assets: Record<Id, AssetRecord>, documents: Record<Id, DocumentRecord>): MediaCandidate[] {
  const created = (record: DocumentRecord) => record.revisions[record.currentRevision]?.createdAt ?? '';
  return Object.values(assets)
    .filter((asset) => asset.kind === 'video' || asset.kind === 'audio')
    .map((asset) => ({ asset, first: Math.min(...projectableItems(sequence, asset.id).map(startFrame)) }))
    .filter(({ first }) => Number.isFinite(first))
    .sort((a, b) => a.first - b.first)
    .map(({ asset }) => {
      const speeches = Object.values(documents).filter((record) => record.kind === 'speech' && record.sourceAssetId === asset.id);
      const speech = speeches.reduce<DocumentRecord | null>((best, record) => (!best || created(record) >= created(best) ? record : best), null);
      return { asset, speech };
    });
}

const startFrame = (item: Sequence['items'][number]) => ('span' in item ? item.span.fromFrame : item.fromFrame);

/** 去掉扩展名的素材名，当字幕文档的名字。 */
const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || name;

/** 提交转录流程。同一个视频同时只跑一轮。`options` 是转录设置里偏离默认的那几项（`transcribeRequestOptions`）。 */
export async function startTranscribe(videoId: Id, asset: { id: Id; name: string }, options: TranscribeOptions = {}): Promise<void> {
  const bound = deps;
  if (!bound || useSubtitleRun.getState().runs[videoId]) return;
  setRun({ videoId, assetId: asset.id, assetName: asset.name, jobId: null, status: 'submitting' });
  try {
    const jobId = await bound.runtime.startPipeline('transcribe', { ...options, videoId, assetId: asset.id, captionStyle: newCaptionStyle() });
    patchRun(videoId, { jobId, status: 'running' });
    // 任务事件可能比回执先到。
    settle(useJobs.getState().jobs);
  } catch (error) {
    endRun(videoId, submitProblem(error));
  }
}

/** 不再转录，直接用视频里已有的转写生成字幕。 */
export async function generateFromSpeech(videoId: Id, asset: { id: Id; name: string }, speechDocumentId: Id): Promise<void> {
  if (!deps || useSubtitleRun.getState().runs[videoId]) return;
  const run: TranscribeRun = { videoId, assetId: asset.id, assetName: asset.name, jobId: null, status: 'writing' };
  setRun(run);
  await writeCaptions(run, speechDocumentId);
}

export async function cancelTranscribe(jobId: Id): Promise<void> {
  try {
    await deps?.runtime.cancelJob(jobId);
  } catch (error) {
    deps?.toast('negative', C.cancelFailed(error instanceof Error ? error.message : String(error)));
  }
}

/** 盯着从这里提交的任务：结束了就收尾。每一轮只收一次——先同步改掉状态，后面的事件看到不是 `running` 就跳过。 */
function settle(jobs: readonly JobRecord[]): void {
  for (const run of Object.values(useSubtitleRun.getState().runs)) {
    if (run.status !== 'running' || !run.jobId) continue;
    const job = jobs.find((candidate) => candidate.jobId === run.jobId);
    if (!job || isJobLive(job)) continue;
    endRun(run.videoId);
    finish(run, job, jobs);
  }
}

/** 转录流程的转写一步提交的 `transcribe` Job（重试过时取最新的）；不是流程或还没提交时 null。 */
export function transcribeStepJob(parent: JobRecord, jobs: readonly JobRecord[]): JobRecord | null {
  if (parent.kind !== 'pipeline') return null;
  return jobs
    .filter((job) => job.kind === 'transcribe' && job.submitter.kind === 'pipeline' && job.submitter.id === parent.jobId)
    .reduce<JobRecord | null>((latest, job) => (!latest || job.createdAt >= latest.createdAt ? job : latest), null);
}

function finish(run: TranscribeRun, job: JobRecord, jobs: readonly JobRecord[]): void {
  const { videoId } = run;
  if (job.state === 'cancelled') {
    deps?.toast('neutral', C.cancelled);
    return;
  }
  if (job.state !== 'completed') {
    const step = transcribeStepJob(job, jobs);
    if (step && awaitingDecision(step)) return report(videoId, decisionProblem(step));
    // 转写做完了、没有写出文档：没有音轨或没听到说话声（流程这一步记为失败）。
    if (step?.state === 'completed' && !step.result?.documentId) return report(videoId, silence(step));
    return report(videoId, {
      kind: 'failed',
      title: job.state === 'interrupted' ? C.interrupted : C.failed,
      message: jobErrorText(job.error) ?? '',
      // 父任务的种类是 `pipeline`，补救按转写找（凭据、模型包问题去模型页）。
      remedy: jobRemedy({ kind: 'transcribe', providerId: job.providerId, error: job.error }),
    });
  }
  const captions = (job.pipeline?.summary as Partial<TranscribeSummary> | null | undefined)?.captions;
  if (!captions || captions.status === 'disabled') return leavePending(run);
  if (captions.status === 'empty') return report(videoId, { kind: 'empty', title: C.noSpeechTitle, message: C.noSpeech, remedy: null });
  if (captions.status === 'not-on-timeline') {
    return report(videoId, { kind: 'empty', title: C.offTimelineTitle, message: C.offTimeline, remedy: null });
  }
  if (captions.documentId) focusDocument(videoId, captions.documentId);
  if (captions.status !== 'created') return;
  const bound = deps;
  const count = captions.cueCount ?? 0;
  const transactionId = captions.transactionId;
  // 撤销作用在编辑器开着的视频上：换了视频就不给。
  const here = useVideo.getState().video?.videoId === videoId;
  bound?.toast(
    'positive',
    captions.enabled === false ? C.createdShelved(count) : C.created(count),
    transactionId && here ? () => void bound.runtime.videos.undo({ transaction: transactionId }) : undefined,
  );
}

function report(videoId: Id, problem: TranscribeProblem): void {
  useSubtitleRun.setState((s) => ({ problems: { ...s.problems, [videoId]: problem } }));
}

function silence(job: JobRecord): TranscribeProblem {
  const noAudio = job.warnings.some((warning) => warning.code === 'no-audio-track');
  return { kind: 'empty', title: noAudio ? C.noAudioTitle : C.noSpeechTitle, message: noAudio ? C.noAudio : C.noSpeech, remedy: null };
}

/**
 * Runtime 写 `speech`（翻译是 `translation`）文档会推进视频的版本：等快照里出现这份文档再提交，否则拿着旧版本去提交会被当成冲突。
 * 等不到（换了视频、视频重开）时返回 false。
 */
export function waitForDocument(videoId: Id, documentId: Id, ms = 10_000): Promise<boolean> {
  const ready = () => {
    const video = useVideo.getState().video;
    return video?.videoId === videoId && !!video.state?.video.documents[documentId];
  };
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const stop = useVideo.subscribe(() => {
      if (!ready()) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(false);
    }, ms);
  });
}

/** 转写已在视频里、但这一轮没生成字幕：留一句话，「生成字幕」会走已有转写那条路。 */
function leavePending(run: TranscribeRun, message: string = C.pending): void {
  endRun(run.videoId, { kind: 'pending', title: C.pendingTitle, message, remedy: null });
  if (useVideo.getState().video?.videoId !== run.videoId) deps?.toast('neutral', C.otherVideo(run.assetName));
}

async function writeCaptions(run: TranscribeRun, speechDocumentId: Id): Promise<void> {
  const bound = deps;
  if (!bound) return endRun(run.videoId);
  const { videoId, assetId } = run;
  try {
    if (!(await waitForDocument(videoId, speechDocumentId))) return leavePending(run);
    const content = await bound.runtime.readDocument(videoId, speechDocumentId);
    const speech = readSpeechWords(content.body);
    if (!speech) return endRun(videoId, { kind: 'failed', title: C.writeFailedTitle, message: C.badSpeech, remedy: null });
    if (!speech.words.length) return endRun(videoId, { kind: 'empty', title: C.noSpeechTitle, message: C.noSpeech, remedy: null });
    const video = useVideo.getState().video;
    const snapshot = video?.videoId === videoId && canEdit(video) ? video.state!.video : null;
    const sequence = snapshot ? rootSequence(snapshot) : null;
    if (!sequence) return leavePending(run);
    // 字幕在素材时钟上切；时间线上一个词也投不到时（素材裁掉了说话的部分）不写。
    const placed = projectSpeech(sequence, assetId, speech.words);
    if (!placed.length) return endRun(videoId, { kind: 'empty', title: C.offTimelineTitle, message: C.offTimeline, remedy: null });
    const cues = deriveCues(speech.words);
    const shown = new Set(placed.map((word) => word.id));
    const visible = cues.filter((cue) => cue.wordIds.some((id) => shown.has(id))).length;
    const body = speechCaptionBody(cues, speech.speakers);
    const language =
      content.document.language ??
      guessLanguage(
        cues
          .slice(0, 30)
          .map((cue) => cue.text)
          .join(''),
      );
    const operations = speechCaptionOperations(sequence, body, {
      name: baseName(run.assetName),
      ...(language ? { language } : {}),
      speechDocumentId,
      speechRevision: content.revision,
      assetId,
      trackName: C.trackName,
    });
    // 失败时编辑器已经提示了引擎的原话；转写还在视频里，留一句怎么接着做。
    const receipt = await bound.runtime.videos.apply(withNewCaptionStyle(operations, newCaptionStyle()), C.generate);
    if (!receipt) return endRun(videoId, { kind: 'failed', title: C.writeFailedTitle, message: C.pending, remedy: null });
    const documentId = receipt.refs?.['speech-caption'];
    useSubtitleRun.setState((s) => ({
      runs: without(s.runs, videoId),
      focus: documentId ? { ...s.focus, [videoId]: documentId } : s.focus,
    }));
    const from = placed[0]!.start;
    const to = Math.max(...placed.map((word) => word.end));
    bound.toast('positive', C.generated(visible, formatClock(from), formatClock(to)), () => {
      void bound.runtime.videos.undo({ transaction: receipt.transactionId });
    });
  } catch (error) {
    leavePending(run, E.thenNext(error instanceof Error ? error.message : String(error), C.pending));
  }
}
