import type { Id, JobRecord } from '@baocut/protocol';
import { jobLive } from './task-list.ts';
import { chargesOnRetry } from './task-reconcile.ts';

/**
 * 翻译流程（`pipelines.start` 的 `translate`，架构设计 §7.9）在字幕面板上的进度与结果：父任务（`kind: 'pipeline'`）
 * 记着四步（读取原文 → 翻译 → 组装译文 → 写入视频），翻译那一步的子任务按句报进度（`unit: 'units'`）。
 * 原型 model-trans-run.js 按四段阶梯与在飞批次画进度；这里只有父任务与子任务的真实数字，不造批次。
 *
 * 会话里的智能体自己翻译（`kind: 'agentTranslate'`）也算这个视频的翻译：它只是一条进度记录，没有步骤（原型
 * model-trans-run.js `selfRun`），范围记在 `JobRecord.translation`。长译文分批写进视频，写过一批之后 Runtime 在
 * `progress` 里报已经覆盖的句数（`unit: 'units'`），据此给百分比；第一批写进视频之前没有百分比。
 */

export const TRANSLATE_PIPELINE = 'translate';

/** 各步占总进度的份量：几乎全部时间花在逐批调用模型上。认不出的步骤按 5 算。 */
const STEP_WEIGHT: Record<string, number> = { 'freeze-source': 5, translate: 85, assemble: 5, write: 5 };
const weightOf = (name: string) => STEP_WEIGHT[name] ?? 5;

/** 智能体在会话里自己翻译的那条进度记录（不是翻译流程）。 */
export function isAgentTranslate(job: JobRecord): boolean {
  return job.kind === 'agentTranslate';
}

/** 这个视频的翻译：翻译流程（不论从哪里发起：字幕面板、智能体、命令行），或智能体自己翻译。 */
export function isTranslateJob(job: JobRecord, videoId: Id | null): boolean {
  if (videoId === null || job.videoId !== videoId) return false;
  return (job.kind === 'pipeline' && job.pipeline?.name === TRANSLATE_PIPELINE) || isAgentTranslate(job);
}

/**
 * 就地刷新一份译文的翻译流程（参数给了 `translationId`，产品设计 §5.10「逐句与过期译文」）：不新增译文、不建字幕层，
 * 进度画在那份译文的对照列表的统计条上，不占轨条与运行态头。
 */
export function refreshOf(job: JobRecord): Id | null {
  if (job.kind !== 'pipeline' || job.pipeline?.name !== TRANSLATE_PIPELINE) return null;
  const id = job.pipeline.params.translationId;
  return typeof id === 'string' && id ? id : null;
}

/** 正在就地刷新这份译文的那个任务（不论从哪里发起）；点名了几句时带句数。 */
export function liveRefresh(jobs: readonly JobRecord[], translationId: Id): { job: JobRecord; count: number | null } | null {
  const job = jobs.find((j) => refreshOf(j) === translationId && jobLive(j));
  if (!job) return null;
  const sentences = job.pipeline?.params.sentences;
  return { job, count: Array.isArray(sentences) ? sentences.length : null };
}

/** 正在翻的（排队、在跑、崩溃后自动重跑）。 */
export function liveTranslations(jobs: readonly JobRecord[], videoId: Id | null): JobRecord[] {
  return jobs.filter((job) => isTranslateJob(job, videoId) && jobLive(job));
}

/** 冻结参数里的目标语言；智能体自己翻译的读 `translation`。 */
export function targetOf(job: JobRecord): string | null {
  const target = job.pipeline?.params.targetLanguage ?? job.translation?.targetLanguage;
  return typeof target === 'string' && target ? target : null;
}

/** 冻结参数里的原文（`speech` 文档）；智能体自己翻译的读 `translation`。 */
export function sourceOf(job: JobRecord): Id | null {
  const id = job.pipeline?.params.documentId ?? job.translation?.sourceDocumentId;
  return typeof id === 'string' && id ? id : null;
}

/** 完成时写进视频的 `translation` 文档：`result.documentId`，没有时读 `pipeline.summary`。 */
export function translationOf(job: JobRecord): Id | null {
  const fromResult = job.result?.documentId;
  if (fromResult) return fromResult;
  const fromSummary = job.pipeline?.summary?.documentId;
  return typeof fromSummary === 'string' && fromSummary ? fromSummary : null;
}

export interface TranslateProgress {
  /** 0–100；还没开始时 0，没完成时最多 99。智能体自己翻译还没写进第一批时 null。 */
  percent: number | null;
  /** 正在执行的那一步（Runtime 给的步骤名）；排队、还没有步骤时 null。 */
  step: string | null;
  /** 翻译那一步的句数；还没报时 null。 */
  units: { done: number; total: number | null } | null;
  queued: boolean;
  /** 智能体自己翻译：要译的句数，与已经写进视频的句数（第一批写进之前 null）；翻译流程为 null。 */
  agent: { sentences: number; done: number | null } | null;
}

/**
 * 总进度：完成（或跳过）的步骤算满，正在跑的步骤按子任务报来的 `done / total` 算一部分。子任务不在镜像里或没有总数时
 * 那一步按 0 算——宁可慢，不猜。
 */
export function translateProgress(parent: JobRecord, jobs: readonly JobRecord[]): TranslateProgress {
  if (isAgentTranslate(parent)) {
    const covered = parent.progress?.unit === 'units' && parent.progress.total ? parent.progress : null;
    const sentences = covered?.total ?? parent.translation?.sentences ?? 0;
    const done = covered ? Math.min(covered.done, sentences) : null;
    const percent = parent.state === 'completed' ? 100 : done !== null ? Math.min(99, Math.floor((done / sentences) * 100)) : null;
    return { percent, step: null, units: null, queued: false, agent: { sentences, done } };
  }
  const steps = parent.pipeline?.steps ?? [];
  const total = steps.reduce((sum, step) => sum + weightOf(step.name), 0);
  let done = 0;
  let current: (typeof steps)[number] | null = null;
  let units: TranslateProgress['units'] = null;
  for (const step of steps) {
    const weight = weightOf(step.name);
    if (step.status === 'completed' || step.status === 'skipped') {
      done += weight;
      continue;
    }
    if (step.status !== 'running') continue;
    current = step;
    const child = step.jobId ? jobs.find((job) => job.jobId === step.jobId) : undefined;
    const progress = child?.progress ?? null;
    if (progress && progress.total) done += weight * Math.min(1, Math.max(0, progress.done / progress.total));
    if (step.name === 'translate' && progress?.unit === 'units') units = { done: progress.done, total: progress.total ?? null };
  }
  const finished = parent.state === 'completed';
  const percent = finished ? 100 : total ? Math.min(99, Math.floor((done / total) * 100)) : 0;
  return { percent, step: current?.label ?? null, units, queued: parent.state === 'queued', agent: null };
}

/**
 * 重试会不会再花钱：`pipelines.retry` 从停下的那一步接着做，前面完成的步骤复用产出。
 * - 停在「翻译」：这一步整个重跑，已经翻过的批次会再调一次在线模型（`charges`；本机与节点的不计费，null）。
 * - 停在「翻译」之后：译文已经在产物里，不再调用模型（`free`）。
 * - 停在「翻译」之前：还没调过模型，谈不上「再」花钱（null）。
 */
export function retryNote(job: JobRecord): 'charges' | 'free' | null {
  const steps = job.pipeline?.steps ?? [];
  const stoppedAt = job.pipeline?.stoppedAt ?? steps.find((s) => s.status === 'failed' || s.status === 'interrupted' || s.status === 'cancelled')?.name;
  if (!stoppedAt) return null;
  const stopped = steps.findIndex((s) => s.name === stoppedAt);
  const translate = steps.findIndex((s) => s.name === 'translate');
  if (stopped < 0 || translate < 0 || stopped < translate) return null;
  if (stopped === translate) return chargesOnRetry(job) ? 'charges' : null;
  return 'free';
}
