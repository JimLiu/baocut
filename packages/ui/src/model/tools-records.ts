import { defineMessages, type Id, type JobKind, type JobRecord } from '@baocut/protocol';
import { JOB_PHASE_LABEL } from '../copy.ts';
import { agoLabel } from './format.ts';
import { jobLive, jobPercent, jobRetrying } from './task-list.ts';
import { zhHans } from './tools-records.zh-Hans.ts';
import { zhHant } from './tools-records.zh-Hant.ts';
import { ja } from './tools-records.ja.ts';
import { ko } from './tools-records.ko.ts';
import { es } from './tools-records.es.ts';
import { fr } from './tools-records.fr.ts';
import { de } from './tools-records.de.ts';
import { nl } from './tools-records.nl.ts';
import { ptBR } from './tools-records.pt-BR.ts';
import { it } from './tools-records.it.ts';
import { ru } from './tools-records.ru.ts';
import { pl } from './tools-records.pl.ts';
import { tr } from './tools-records.tr.ts';
import { vi } from './tools-records.vi.ts';
import { jobErrorText, jobWaitText } from './localized-text.ts';

/** 记录卡的状态词与原因（译文在 `tools-records.<语言>.ts`）。 */
const en = {
  generating: 'Generating',
  queued: 'Queued',
  cancelled: 'Cancelled',
  failed: 'Failed',
  unfinished: 'Didn’t finish',
  unknown: 'Result unknown',
  interrupted: 'Runtime stopped or restarted before this finished',
  reconcile: 'Runtime restarted before this call responded. The result is unknown and it may already have been billed',
  noResult: 'Nothing was generated',
};
export type ToolsRecordsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 工具页右栏的记录（设计稿 tool-tts.jsx「生成记录」、tool-image.jsx、tool-transcribe.jsx「转录记录」）：
 * 不是工具页自己记的一份，而是 `jobs` 主题里这类任务的子集——这台电脑上的界面（连接）提交的、不属于任何视频的。
 * 模型页的「测试合成 / 测试生图」也是这样提交的，会一起出现在这里，如实列出（那也是一次真实的调用）。
 * 「删除这条记录」只在本机藏起来：Runtime 没有删除 Job 的方法，后台任务里照样能看到。
 */

function isLive(job: Pick<JobRecord, 'state' | 'endedAt'>): boolean {
  return jobLive(job);
}

/** 这类工具的记录，新的在前；本机藏起来的不列。 */
export function toolJobs(jobs: readonly JobRecord[], kind: JobKind, hidden: readonly Id[]): JobRecord[] {
  const skip = new Set(hidden);
  return jobs
    .filter((job) => job.kind === kind && job.videoId === null && job.submitter.kind === 'connection' && !skip.has(job.jobId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** 右栏列出的记录：取消了的不列，只有可能已经计费的照实留下（`cancellation.cost` 不是 `none`）。 */
export function listedRecords(list: readonly JobRecord[]): JobRecord[] {
  return list.filter((job) => job.state !== 'cancelled' || (!!job.cancellation && job.cancellation.cost !== 'none'));
}

/** 进行中（排队或在跑）的条数：右栏标题旁的「N 条进行中」。 */
export function liveCount(list: readonly JobRecord[]): number {
  return list.filter(isLive).length;
}

/**
 * 排队的任务前面还有几条（设计稿 model-tools.js `aheadOf`）。Runtime 按执行者排队：云端每家一条队，
 * 所以只数同一个 Provider 上、比它早提交、还没结束的任务（在跑的也算）。`all` 传全部任务，视频里的也占队。
 */
export function aheadOf(all: readonly JobRecord[], job: JobRecord): number {
  const at = Date.parse(job.createdAt);
  return all.filter((x) => x.jobId !== job.jobId && x.providerId === job.providerId && isLive(x) && Date.parse(x.createdAt) < at).length;
}

/**
 * 排队时 Runtime 记着的在等什么（`JobRecord.wait`：同一队列的并发名额，或机器上的资源，架构设计 §7.6、§7.7），
 * 是给人看的一句；还没有时 null，由调用方退回 `aheadOf` 的估计。
 */
export function queuedDetail(job: Pick<JobRecord, 'state' | 'wait'>): string | null {
  return job.state === 'queued' ? jobWaitText(job.wait) : null;
}

/** 本机藏起来的记录最多记这么多条，旧的先忘。 */
export const HIDDEN_LIMIT = 500;

/** 藏起一条记录（已经藏过的不重复记）。 */
export function hideJob(hidden: readonly Id[], jobId: Id): Id[] {
  if (hidden.includes(jobId)) return [...hidden];
  return [...hidden, jobId].slice(-HIDDEN_LIMIT);
}

// ---- 记录卡的状态 ----

export type RecordStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'needs-reconciliation';

export function recordStatus(job: Pick<JobRecord, 'state' | 'endedAt'>): RecordStatus {
  if (jobRetrying(job)) return 'running';
  return job.state === 'completed' ? 'done' : job.state;
}

/** 记录卡右上角那个词（设计稿 tool-tts.jsx `RecordCard`）：做完了写多久前，其余写状态。 */
export function stateLabel(job: Pick<JobRecord, 'state' | 'endedAt' | 'createdAt'>, now: number): string {
  switch (job.state) {
    case 'completed':
      return agoLabel(job.endedAt ?? job.createdAt, now);
    case 'running':
      return M.generating;
    case 'queued':
      return M.queued;
    case 'cancelled':
      return M.cancelled;
    case 'failed':
      return M.failed;
    case 'interrupted':
      return job.endedAt === null ? M.generating : M.unfinished;
    case 'needs-reconciliation':
      return M.unknown;
  }
}

/** 没做成的记录（失败、中断、结果不明）：卡片按出错画，给出原因。 */
export function didNotFinish(job: Pick<JobRecord, 'state' | 'endedAt'>): boolean {
  if (jobRetrying(job)) return false;
  return job.state === 'failed' || job.state === 'interrupted' || job.state === 'needs-reconciliation';
}

/**
 * 在跑的那一行：阶段、几张里的第几张（生图一次多张时）、百分比。总量未知时不写百分比（不伪造）。
 * 「生成中 1/4 · 25%」「生成中」「保存结果 · 100%」。
 */
export function phaseLabel(job: Pick<JobRecord, 'phase' | 'progress'>): string {
  const p = job.progress;
  const count = p && p.unit === 'outputs' && p.total ? ` ${p.done}/${p.total}` : '';
  const pct = jobPercent(job);
  return `${JOB_PHASE_LABEL[job.phase]}${count}${pct !== null ? ` · ${pct}%` : ''}`;
}

/** 没做成时的一句：失败带 Runtime 的原因，中断说明是 Runtime 停了。 */
export function failureText(job: Pick<JobRecord, 'state' | 'error'>): string {
  if (job.state === 'interrupted') return M.interrupted;
  if (job.state === 'needs-reconciliation') return M.reconcile;
  return jobErrorText(job.error) || M.noResult;
}
