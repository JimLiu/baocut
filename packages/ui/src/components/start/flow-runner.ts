import { create } from 'zustand';
import type { FileTarget, Id, JobRecord, ModelRef, TranscribeParams } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { ELEMENT_TILES } from '../../model/element-catalog.ts';
import { linkMeta, linkProvenance, linkSummary, type FollowUp } from '../../model/link-import.ts';
import {
  BG_COLOR,
  chainOf,
  fileNameOf,
  mediaKindOf,
  needsTranscribe,
  RATIO_SIZE,
  targetLanguage,
  type BgHue,
  type FlowKey,
  type Ratio,
} from '../../model/new-flow.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { awaitingDecision, bindTranscribe, startTranscribe, useSubtitleRun } from '../editor/transcribe-run.ts';
import { bindTranslate, startTranslate, useTranslateRun } from '../editor/translate-run.ts';
import { ST } from './start-copy.ts';
import { jobErrorText } from '../../model/localized-text.ts';

/**
 * 链接导入之后的跟进（原先也是首页固定流程的执行；首页的固定流程已经退场，现在只有任务详情的「用下载的文件新建视频」
 * 经 `adoptDownload` 起一次运行）：建视频、进编辑器、（可选地）提交转录（字幕面板的 transcribe-run）；翻译在转录完成后自动接着起
 * （字幕面板的 translate-run），链接导入在 `link-import` 流程完成之后用下载的文件建视频。
 *
 * 状态放在模块级的 store 里：开始之后页面可能切走（链接导入会去任务详情），执行不能因此断了线。只在这次运行里：
 * 应用重启之后，下载完成的导入在任务详情里给「用下载的文件新建视频」，转录与翻译的任务照常在后台任务里。
 */

export interface FlowOptions {
  ratio: Ratio;
  bg: BgHue;
  wave: boolean;
  subs: boolean;
  /** 翻译的目标语言（BCP 47）。 */
  target: string;
  /** 译文字幕和原文一起显示。 */
  bilingual: boolean;
  /** 翻译用的文本模型（页面上门槛卡看的那一只）；null 时由 Runtime 用默认值。 */
  textModel: ModelRef | null;
  transcribe: Pick<TranscribeParams, 'provider' | 'model' | 'language' | 'hint'>;
}

export type RunStage = 'downloading' | 'creating' | 'transcribing' | 'translating' | 'done' | 'failed';

export interface FlowRun {
  /** 链接导入是父任务 ID；本地文件是生成的键。 */
  key: string;
  flow: FlowKey;
  projectId: Id;
  /** 视频名（文件名去掉扩展名，或链接的标题）。 */
  name: string;
  options: FlowOptions;
  linkJobId: Id | null;
  stage: RunStage;
  target: FileTarget | null;
  videoId: Id | null;
  assetId: Id | null;
  transcribeJobId: Id | null;
  translateJobId: Id | null;
  /** 翻译提交成功了：之后 translate-run 里没有这一轮时看收据或问题卡。 */
  translateStarted: boolean;
  failedAt: 'video' | 'subs' | 'translate' | null;
  error: string | null;
}

interface FlowRunsState {
  runs: Record<string, FlowRun>;
}

export const useFlowRuns = create<FlowRunsState>()(() => ({ runs: {} }));

type ToastKind = 'positive' | 'neutral' | 'negative' | 'info';

export interface RunnerDeps {
  runtime: Pick<
    RuntimeSession,
    'createFlowVideo' | 'startPipeline' | 'createProject' | 'startTranslate' | 'retryPipeline' | 'readDocument' | 'cancelJob' | 'videos'
  >;
  toast(kind: ToastKind, message: string, action?: { label: string; run: () => void }): void;
}

let deps: RunnerDeps | null = null;
let unwatch: (() => void) | null = null;
let unwatchTranslate: (() => void) | null = null;

/** 任务详情挂上时绑定（连同转录与翻译的执行）；第一次绑定时开始盯 `jobs` 主题与翻译的运行状态。 */
export function bindFlowRunner(next: RunnerDeps): void {
  deps = next;
  const toast = (kind: 'positive' | 'neutral' | 'negative', message: string, undo?: () => void) =>
    next.toast(kind, message, undo ? { label: ST.flow.undo, run: undo } : undefined);
  bindTranscribe({ runtime: next.runtime, toast });
  bindTranslate({ runtime: next.runtime, toast });
  unwatch ??= useJobs.subscribe((state) => settle(state.jobs));
  unwatchTranslate ??= useTranslateRun.subscribe(() => settle(useJobs.getState().jobs));
}

function put(run: FlowRun): void {
  useFlowRuns.setState((s) => ({ runs: { ...s.runs, [run.key]: run } }));
}

function patch(key: string, change: Partial<FlowRun>): FlowRun | null {
  const current = useFlowRuns.getState().runs[key];
  if (!current) return null;
  const next = { ...current, ...change };
  put(next);
  return next;
}

/** 链接导入的跟进到哪了（任务详情的三步用）；不是这次运行里从首页起的时 null。 */
export function followOf(run: FlowRun | null | undefined): FollowUp | null {
  if (!run) return null;
  const video: FollowUp['video'] =
    run.failedAt === 'video' ? 'failed' : run.stage === 'downloading' ? 'pending' : run.stage === 'creating' ? 'running' : 'done';
  const subs: FollowUp['subs'] = !needsTranscribe(run.flow, run.options.subs)
    ? 'skipped'
    : run.failedAt === 'subs'
      ? 'failed'
      : run.stage === 'transcribing'
        ? 'running'
        : run.stage === 'translating' || run.stage === 'done' || run.failedAt === 'translate'
          ? run.transcribeJobId
            ? 'done'
            : 'skipped'
          : 'pending';
  return { video, subs };
}

export function runOfLink(jobId: Id): FlowRun | null {
  return useFlowRuns.getState().runs[jobId] ?? null;
}

/** 绑定时给的提示：Spectrum 的 toast，带按钮的多留一会儿。 */
export function flowToast(kind: ToastKind, message: string, action?: { label: string; run: () => void }): void {
  ToastQueue[kind](message, action ? { timeout: 6000, actionLabel: action.label, onAction: action.run, shouldCloseOnAction: true } : { timeout: 5000 });
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || name;

interface StartInput {
  flow: FlowKey;
  projectId: Id;
  file: string | null;
  url: string | null;
  options: FlowOptions;
}

function blankRun(key: string, input: StartInput, projectId: Id, name: string, linkJobId: Id | null): FlowRun {
  return {
    key,
    flow: input.flow,
    projectId,
    name,
    options: input.options,
    linkJobId,
    stage: linkJobId ? 'downloading' : 'creating',
    target: null,
    videoId: null,
    assetId: null,
    transcribeJobId: null,
    translateJobId: null,
    translateStarted: false,
    failedAt: null,
    error: null,
  };
}

/** 建视频（必要时铺背景与声波），打开它，再提交转录。`link` 是链接导入下载的文件的素材名与来源（视频详情的「来源信息」）。 */
async function createAndGo(
  key: string,
  path: string | null,
  how: { open: boolean; transcribe?: boolean; link?: { name: string | null; provenance: ReturnType<typeof linkProvenance> } },
): Promise<void> {
  const bound = deps;
  const run = useFlowRuns.getState().runs[key];
  if (!bound || !run) return;
  const { flow, options } = run;
  const kind = path ? (mediaKindOf(path) === 'audio' ? 'audio' : 'video') : null;
  const sized = flow === 'blank' || flow === 'a2v';
  const size = sized ? RATIO_SIZE[options.ratio] : null;
  const wave = flow === 'a2v' && options.wave && kind ? ELEMENT_TILES.find((t) => t.key === 'wave.bars')?.layer(size!) : undefined;
  let created;
  try {
    created = await bound.runtime.createFlowVideo(
      { projectId: run.projectId },
      {
        ...(run.name ? { name: run.name } : {}),
        ...(size ? { width: size.width, height: size.height } : {}),
        ...(path && kind
          ? {
              file: {
                path,
                kind,
                ...(how.link?.name ? { name: how.link.name } : {}),
                ...(how.link?.provenance ? { provenance: how.link.provenance } : {}),
              },
            }
          : {}),
        ...(flow === 'a2v' ? { background: BG_COLOR[options.bg] } : {}),
        ...(wave ? { wave } : {}),
      },
    );
  } catch (error) {
    patch(key, { stage: 'failed', failedAt: 'video', error: (error as Error).message });
    bound.toast('negative', ST.flow.createFailed((error as Error).message));
    return;
  }
  const { target, videoId, assetId, importError, waveError } = created;
  patch(key, { target, videoId, assetId });
  if (how.open || shouldOpen(run)) useShell.getState().openVideo(target, { conversationId: null, projectId: run.projectId });
  const open = { label: ST.flow.openVideo, run: () => useShell.getState().openVideo(target, { conversationId: null, projectId: run.projectId }) };
  if (importError) {
    patch(key, { stage: 'failed', failedAt: 'video', error: importError });
    bound.toast('negative', ST.flow.importFailed(importError), how.open ? undefined : open);
    return;
  }
  if (waveError) bound.toast('neutral', ST.flow.waveFailed(waveError));
  if (flow === 'blank' || !path || !assetId || how.transcribe === false || !needsTranscribe(flow, options.subs)) {
    patch(key, { stage: 'done' });
    const what = flow === 'blank' ? ST.flow.blankCreated : flow === 'a2v' ? ST.flow.a2vCreated(options.wave) : ST.flow.created;
    bound.toast('positive', what, how.open ? undefined : open);
    return;
  }
  patch(key, { stage: 'transcribing' });
  await startTranscribe(videoId, { id: assetId, name: fileNameOf(path) }, options.transcribe);
  const sub = useSubtitleRun.getState();
  const live = sub.runs[videoId];
  if (!live?.jobId) {
    const problem = sub.problems[videoId];
    const why = problem ? ST.flow.reason([problem.title, problem.message].filter(Boolean)) : ST.flow.notSubmitted;
    patch(key, { stage: 'failed', failedAt: 'subs', error: why });
    bound.toast('negative', ST.flow.transcribeNotStarted(why), how.open ? undefined : open);
    return;
  }
  patch(key, { transcribeJobId: live.jobId });
  const chain = chainOf(flow, targetLanguage(options.target));
  const tasks = { label: ST.flow.viewTask, run: () => useShell.getState().go({ tab: 'tasks', taskId: live.jobId! }) };
  bound.toast(
    'positive',
    chain
      ? ST.flow.chainQueued(chain.title)
      : flow === 'a2v'
        ? ST.flow.a2vTranscribing(options.wave)
        : ST.flow.transcribing,
    how.open ? tasks : open,
  );
  settle(useJobs.getState().jobs);
}

/**
 * 下载完成之后要不要直接打开视频：用户还在这次导入的任务详情、或在起始页时打开；在别处（编辑别的东西、看别的页）时不打断，
 * 提示里给「打开视频」。
 */
function shouldOpen(run: FlowRun): boolean {
  const { route } = useShell.getState();
  if (route.tab === 'tasks') return route.taskId === run.linkJobId;
  return route.tab === 'home' && route.conversationId === null && !route.pane;
}

/** 盯着这次运行里起的任务：链接导入完成就建视频，转录完成就接翻译，翻译完成就报告。每一步先同步改状态，只收一次。 */
function settle(jobs: readonly JobRecord[]): void {
  for (const run of Object.values(useFlowRuns.getState().runs)) {
    if (run.stage === 'downloading' && run.linkJobId) {
      const job = jobs.find((j) => j.jobId === run.linkJobId);
      if (!job || job.state !== 'completed') continue;
      const summary = linkSummary(job);
      if (!summary) {
        patch(run.key, { stage: 'failed', failedAt: 'video', error: ST.flow.noDownload });
        continue;
      }
      const title = linkMeta(job).title;
      const name = title ?? stem(fileNameOf(summary.files.media));
      patch(run.key, { stage: 'creating', name: name.slice(0, 80) });
      void createAndGo(run.key, summary.files.media, { open: false, link: { name: title, provenance: linkProvenance(job) } });
      continue;
    }
    if (run.stage === 'transcribing' && run.transcribeJobId) {
      const job = jobs.find((j) => j.jobId === run.transcribeJobId);
      if (!job || isJobLive(job) || awaitingDecision(job)) continue;
      if (job.state !== 'completed') {
        patch(run.key, { stage: 'failed', failedAt: 'subs', error: jobErrorText(job.error) ?? ST.flow.transcribeUnfinished });
        continue;
      }
      if (run.flow !== 'trans') {
        patch(run.key, { stage: 'done' });
        continue;
      }
      const documentId = job.result?.documentId ?? null;
      if (!documentId) {
        patch(run.key, { stage: 'failed', failedAt: 'subs', error: ST.flow.noSpeech });
        deps?.toast('neutral', ST.flow.noSpeechToast(run.name));
        continue;
      }
      patch(run.key, { stage: 'translating' });
      void translate(run.key, documentId);
      continue;
    }
    if (run.stage === 'translating' && run.translateStarted && run.videoId) {
      // 翻译由 translate-run 收尾（放到画面上、收据或问题卡）；它的这一轮结束了再报告。
      const translating = useTranslateRun.getState();
      if (translating.runs[run.videoId]) continue;
      const target = run.target;
      const open = target
        ? { label: ST.flow.openVideo, run: () => useShell.getState().openVideo(target, { conversationId: null, projectId: run.projectId }) }
        : undefined;
      const receipt = translating.receipts[run.videoId];
      const problem = translating.problems[run.videoId];
      if (receipt) {
        patch(run.key, { stage: 'done' });
        deps?.toast('positive', chainOf('trans', targetLanguage(run.options.target))!.doneToast, open);
      } else if (problem) {
        const why = ST.flow.reason([problem.title, problem.message].filter(Boolean));
        patch(run.key, { stage: 'failed', failedAt: 'translate', error: why });
        // 编辑器开着别的视频时 translate-run 已经提示过「在对照列表里放到画面上」。
        const told = problem.kind === 'pending' && useVideo.getState().video?.videoId !== run.videoId;
        if (!told) deps?.toast('negative', ST.flow.translateNotPlaced(run.name || ST.flow.video, why), open);
      } else {
        // 取消了（translate-run 已经提示）。
        patch(run.key, { stage: 'failed', failedAt: 'translate', error: ST.flow.translateCancelled });
      }
    }
  }
}

/**
 * 起翻译（字幕面板的 `startTranslate`）：`translate` 流程要视频在 Runtime 里开着。用户把它关了（编辑器换了别的视频）时
 * 被拒，提示里给「打开视频并翻译」。没有配置文本模型等原因留在字幕面板的问题卡上。
 */
async function translate(key: string, documentId: Id): Promise<void> {
  const bound = deps;
  const run = useFlowRuns.getState().runs[key];
  const videoId = run?.videoId;
  if (!bound || !run || !videoId) return;
  const started = await startTranslate({
    videoId,
    speechDocumentId: documentId,
    targetLanguage: run.options.target,
    style: '',
    model: run.options.textModel,
    bilingual: run.options.bilingual,
  });
  const state = useTranslateRun.getState();
  const jobId = state.runs[videoId]?.jobId ?? null;
  if (started) {
    // 提交成功之后才看结果（之前 translate-run 里还没有这一轮）；已经收完尾时照收据或问题卡报告。
    patch(key, { translateJobId: jobId, translateStarted: true });
    settle(useJobs.getState().jobs);
    return;
  }
  const problem = state.problems[videoId];
  const message = problem ? ST.flow.reason([problem.title, problem.message].filter(Boolean)) : ST.flow.translateBusy;
  patch(key, { stage: 'failed', failedAt: 'translate', error: message });
  const target = run.target;
  bound.toast(
    'negative',
    ST.flow.translateFailed(message),
    target
      ? {
          label: ST.flow.openAndTranslate,
          run: () => {
            useShell.getState().openVideo(target, { conversationId: null, projectId: run.projectId });
            void waitForVideo(videoId).then((ready) => {
              if (!ready) return bound.toast('negative', ST.flow.notOpened);
              patch(key, { stage: 'translating', failedAt: null, error: null, translateJobId: null, translateStarted: false });
              void translate(key, documentId);
            });
          },
        }
      : undefined,
  );
}

function waitForVideo(videoId: Id, ms = 10_000): Promise<boolean> {
  const ready = () => {
    const video = useVideo.getState().video;
    return video?.videoId === videoId && !!video.state;
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

/**
 * 应用重启过（或别处起的导入）：下载完成了、这次运行里没有跟进。用下载的文件建一个视频并打开，不自动转录
 * （进编辑器后在字幕面板里点「生成字幕」）。下载目录属于哪个项目取冻结参数里的；没有项目时不能建。
 */
export async function adoptDownload(job: JobRecord): Promise<{ ok: true } | { ok: false; error: string }> {
  const bound = deps;
  const summary = linkSummary(job);
  const projectId = typeof job.pipeline?.params.projectId === 'string' ? job.pipeline.params.projectId : null;
  if (!bound || !summary) return { ok: false, error: ST.flow.noFile };
  if (!projectId) return { ok: false, error: ST.flow.noProject };
  const title = linkMeta(job).title;
  const name = (title ?? stem(fileNameOf(summary.files.media))).slice(0, 80);
  const input: StartInput = {
    flow: 'sub',
    projectId,
    file: summary.files.media,
    url: null,
    options: { ratio: '16:9', bg: 'gray', wave: false, subs: false, target: 'en', bilingual: true, textModel: null, transcribe: {} },
  };
  const key = job.jobId;
  put({ ...blankRun(key, input, projectId, name, job.jobId), stage: 'creating' });
  await createAndGo(key, summary.files.media, { open: true, transcribe: false, link: { name: title, provenance: linkProvenance(job) } });
  const after = useFlowRuns.getState().runs[key];
  return after?.failedAt ? { ok: false, error: after.error ?? ST.flow.createFailedShort } : { ok: true };
}
