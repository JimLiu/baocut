import {
  localizeText,
  type Id,
  type JobRecord,
  type ModelBundleStatus,
  type ModelCapabilitiesView,
  type SpaceEntry,
  type TimelineItem,
  type VideoChange,
} from '@baocut/protocol';
import { JOB_PHASE_LABEL, VIDEO_CARD_COPY } from '../copy.ts';
import type { ConversationOutput } from './conversation-outputs.ts';
import {
  cancelPending,
  exportOutputs,
  exportPhaseLabel,
  exportProgressLine,
  exportTitle,
  exportWarnings,
  isPreviewExport,
  type ExportOutputFact,
} from './export-job.ts';
import { formatClock } from './format.ts';
import { downloadProgress, isLinkImport, linkFrozen, linkIssue, linkMeta, linkPhaseText, linkSummary } from './link-import.ts';
import { isPlayable, videoTargetOf } from './space.ts';
import { jobRemedy, type Remedy } from './task-facts.ts';
import { jobLive, jobPercent, jobRetrying, kindLabel, runsOnLabel } from './task-list.ts';
import { bundleName } from './models-local.ts';
import { langName } from './tools-models.ts';
import { reconcileOptions } from './task-reconcile.ts';
import type { ThreadBlock } from './thread.ts';
import { TRANSLATE_PIPELINE, targetOf, translateProgress } from './translate-progress.ts';
import { jobErrorText, jobWaitText } from './localized-text.ts';

/**
 * 会话线程里的视频卡与下载卡（产品设计 §3.2.2、§6.5；原型 model-agent-cards.js、model-agent-projects.js `sessionArtifacts`）。
 * 纯函数：卡片内容只从会话条目（`video-created`、`video-change`）与智能体提交的 Job 记录算，不读回复正文。
 *
 * - **一条会话一部视频一张卡**。一部视频「被引用」：会话里有它的 `video-created` / `video-change`，或某一轮的任务提交了
 *   指向它的 Job（转录、导出、翻译、从链接导入到它；Job 的引用落在这个任务最后一组步骤上）。卡挂在下面两处里靠后的那一处：
 *   (a) 最后一个引用它的块后面；(b) 卡上的活在后面的回合开始时还没结束（在跑或排队）：这件活结束之前开始的最后一轮
 *   （还在跑时就是最新一轮）的最后一个块后面。先后只比活的 `endedAt` 与那一轮用户消息的 `createdAt`；活结束后卡不再挪，
 *   也不挪回去。卡挪走后前面的回合不再有它。卡上列这条会话在这部视频上的全部活，与「产物」弹层的那张一样。
 * - **下载卡**：智能体发起的从链接导入，父任务还没有 `videoId` 时一张；视频一建出来（父任务带上 `videoId`），
 *   同一个位置换成视频卡，下载那一件活并进卡上（流程提交的转录是一行）。只下载、不建视频的，完成后仍是下载卡，写落地的文件。
 * - 合成语音、生成图片这类生成任务不进视频卡（原型的候选卡在正式应用里还没有）。
 *
 * Job 归回合：`submitter` 是这条会话的智能体（`kind: 'agent'`、`id` 为会话），`taskId` 是那一轮的任务；固定流程提交的
 * （`submitter.kind === 'pipeline'`）归到父任务；流程的步骤（`parentJobId`）不单独成行，只经父任务读进度。
 */

type Item<K extends TimelineItem['kind']> = Extract<TimelineItem, { kind: K }>;

export type ThreadCard =
  /** `jobIds`：这条会话归这部视频的活（行），按提交先后（与 `conversationVideoJobs` 同一份）。 */
  { kind: 'video'; key: string; video: ConversationOutput; jobIds: Id[] } | { kind: 'download'; key: string; jobId: Id };

/** 进视频卡做一行的 Job：转录、导出、固定流程（翻译、从链接导入到这部视频……）。 */
function isRowJob(job: JobRecord): boolean {
  return !isPreviewExport(job) && (job.kind === 'transcribe' || job.kind === 'export' || job.kind === 'pipeline');
}

/** 这条 Job 归会话里哪个智能体任务：智能体直接提交的就是它自己；固定流程提交的归父任务（至多上溯几层）。 */
export function agentOwner(job: JobRecord, byId: ReadonlyMap<Id, JobRecord>, conversationId: Id): JobRecord | null {
  let cur: JobRecord | undefined = job;
  for (let depth = 0; cur && depth < 4; depth++) {
    const s: JobRecord['submitter'] = cur.submitter;
    if (s.kind === 'agent') return s.id === conversationId ? cur : null;
    if (s.kind !== 'pipeline') return null;
    cur = byId.get(s.id);
  }
  return null;
}

function agentTaskId(job: JobRecord): Id | null {
  return job.submitter.kind === 'agent' ? job.submitter.taskId : null;
}

/** Space 里的这个视频条目是不是在这个位置（来源目录 + 相对路径）。 */
export function isVideoAt(entry: SpaceEntry, target: VideoChange['target']): boolean {
  if (entry.kind !== 'video' || entry.relPath !== target.path) return false;
  return 'projectId' in target ? entry.source.projectId === target.projectId : entry.source.conversationId === target.conversationId;
}

function blockTaskIds(block: ThreadBlock): Id[] {
  if (block.type === 'steps') return [...new Set(block.items.map((i) => i.taskId).filter((id): id is Id => !!id))];
  return block.item.taskId ? [block.item.taskId] : [];
}

/**
 * 一部视频在卡上的名字、打开的位置与时长：会话里最近一条 `video-created` / `video-change`，Space 里的条目
 * （名字以 Space 为准，流程新建的视频只能靠 `ref.videoId` 找），都没有时取链接的标题。找不到位置时 `video` 为 null（按钮置灰）。
 */
export function videoOutput(
  videoId: Id,
  items: readonly TimelineItem[],
  entries: readonly SpaceEntry[],
  jobs: readonly JobRecord[],
): ConversationOutput {
  const last = items.findLast(
    (i): i is Item<'video-change'> | Item<'video-created'> =>
      (i.kind === 'video-change' || i.kind === 'video-created') && i.videoId === videoId,
  );
  const change = items.findLast((i): i is Item<'video-change'> => i.kind === 'video-change' && i.videoId === videoId);
  const entry =
    entries.find((e) => e.kind === 'video' && e.ref && 'videoId' in e.ref && e.ref.videoId === videoId) ??
    (last ? entries.find((e) => isVideoAt(e, last.target)) : undefined) ??
    null;
  const link = jobs.find((j) => isLinkImport(j) && j.videoId === videoId);
  const latest = jobs
    .filter((j) => j.videoId === videoId)
    .reduce<JobRecord | null>((a, j) => (!a || j.createdAt > a.createdAt ? j : a), null);
  const linkName = link ? (linkMeta(link).title ?? null) : null;
  return {
    id: videoId,
    kind: 'video',
    name: entry?.name ?? last?.videoName ?? linkName ?? VIDEO_CARD_COPY.download.fallbackName,
    video: last?.target ?? (entry ? videoTargetOf(entry) : null),
    entry,
    durationSeconds: change?.durationSeconds.after ?? entry?.media?.durationSec ?? null,
    at: last?.createdAt ?? latest?.createdAt ?? '',
    taskId: last?.taskId ?? null,
  };
}

/** 活什么时候结束：还没结束（排队、在跑、崩溃后在重跑）是 Infinity；结束了却没记时间的是 -Infinity（不跟到后面的回合）。 */
function endOf(job: JobRecord | undefined): number {
  if (!job) return -Infinity;
  if (jobLive(job)) return Infinity;
  const t = job.endedAt ? Date.parse(job.endedAt) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * 线程块 id → 挂在它后面的卡（视频卡与下载卡），同一块下按第一次引用的先后。
 * `blocks` 是 `buildThread(items)` 的输出；`jobs` 是 Job 镜像（含流程的步骤）。
 */
export function threadCards(input: {
  blocks: readonly ThreadBlock[];
  items: readonly TimelineItem[];
  jobs: readonly JobRecord[];
  conversationId: Id;
  entries: readonly SpaceEntry[];
}): Map<Id, ThreadCard[]> {
  const { blocks, items, jobs, conversationId, entries } = input;

  // 回合：每条用户消息开一轮；块 → 回合，任务 → 回合（任务第一次出现的那一轮）。
  // 每一轮记开始的时刻（用户消息的 createdAt；第一条用户消息之前的那一段算很早以前）与最后一个内容块。
  const blockTurn: number[] = [];
  const taskTurn = new Map<Id, number>();
  const turnStart: number[] = [];
  const turnLast: number[] = [];
  let turn = -1;
  blocks.forEach((block, i) => {
    if (block.type === 'user' || turn < 0) {
      turn++;
      const at = block.type === 'user' ? Date.parse(block.item.createdAt) : NaN;
      turnStart[turn] = Number.isFinite(at) ? at : -Infinity;
    }
    blockTurn[i] = turn;
    if (block.type === 'task') return;
    turnLast[turn] = i;
    for (const id of blockTaskIds(block)) if (!taskTurn.has(id)) taskTurn.set(id, turn);
  });

  // 条目 → 它所在的块；没有自己一块的（新建视频的记录、空回复）落在它前面最近的一块。
  const itemBlock = new Map<Id, number>();
  blocks.forEach((block, i) => {
    if (block.type === 'task') return;
    if (block.type === 'steps') block.items.forEach((it) => itemBlock.set(it.id, i));
    else itemBlock.set(block.item.id, i);
  });
  const anchorOf = new Map<Id, number>();
  let lastBlock = -1;
  for (const item of items) {
    const own = itemBlock.get(item.id);
    if (own !== undefined) lastBlock = own;
    if (lastBlock >= 0) anchorOf.set(item.id, own ?? lastBlock);
  }

  /** 智能体任务的 Job 挂在哪一块：这个任务在这一轮的最后一组步骤；没有步骤时这一轮最后一个内容块。 */
  const jobAnchor = (taskId: Id): number | null => {
    const t = taskTurn.get(taskId);
    if (t === undefined) return null;
    let steps = -1;
    let content = -1;
    blocks.forEach((block, i) => {
      if (blockTurn[i] !== t || block.type === 'task') return;
      content = i;
      if (block.type === 'steps' && block.items.some((it) => it.taskId === taskId)) steps = i;
    });
    return steps >= 0 ? steps : content >= 0 ? content : null;
  };

  interface Ref {
    first: number;
    last: number;
    seq: number;
    card: ThreadCard;
    /** 视频卡：卡上每件活被引用的那一轮。 */
    jobTurns: Map<Id, number>;
  }
  const refs = new Map<string, Ref>();
  let seq = 0;
  const refer = (videoId: Id, at: number, jobId?: Id) => {
    const key = `video:${videoId}`;
    let ref = refs.get(key);
    if (!ref) {
      const jobIds = conversationVideoJobs(videoId, jobs, conversationId);
      const card: ThreadCard = { kind: 'video', key, video: videoOutput(videoId, items, entries, jobs), jobIds };
      ref = { first: at, last: at, seq: seq++, card, jobTurns: new Map() };
      refs.set(key, ref);
    }
    ref.first = Math.min(ref.first, at);
    ref.last = Math.max(ref.last, at);
    if (jobId && !ref.jobTurns.has(jobId)) ref.jobTurns.set(jobId, blockTurn[at]!);
  };

  for (const item of items) {
    if (item.kind !== 'video-change' && item.kind !== 'video-created') continue;
    const at = anchorOf.get(item.id);
    if (at !== undefined) refer(item.videoId, at);
  }

  const byId = new Map(jobs.map((j) => [j.jobId, j]));
  const ordered = [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId));
  for (const job of ordered) {
    if (job.parentJobId) continue;
    const owner = agentOwner(job, byId, conversationId);
    const taskId = owner ? agentTaskId(owner) : null;
    if (!owner || !taskId) continue;
    const at = jobAnchor(taskId);
    if (at === null) continue;
    if (job.videoId && isRowJob(job)) refer(job.videoId, at, job.jobId);
    else if (!job.videoId && isLinkImport(job) && owner === job) {
      const key = `download:${job.jobId}`;
      refs.set(key, { first: at, last: at, seq: seq++, card: { kind: 'download', key, jobId: job.jobId }, jobTurns: new Map() });
    }
  }

  /**
   * 视频卡挂在哪一块（规则见文件头）：(b) 每件活在它被引用的那一轮之后、结束之前开始的最后一轮；取最晚的一轮，
   * 不早于最后的引用所在的那一轮时挂在那一轮的最后一个块后面，否则挂在最后的引用后面。
   */
  const anchor = (ref: Ref): number => {
    let to = -1;
    for (const [jobId, from] of ref.jobTurns) {
      const end = endOf(byId.get(jobId));
      for (let u = turn; u > from; u--) {
        if (turnStart[u]! < end) {
          to = Math.max(to, u);
          break;
        }
      }
    }
    return to >= 0 && to >= blockTurn[ref.last]! && turnLast[to] !== undefined ? Math.max(turnLast[to]!, ref.last) : ref.last;
  };

  const out = new Map<Id, ThreadCard[]>();
  [...refs.values()]
    .sort((a, b) => a.first - b.first || a.seq - b.seq)
    .forEach((ref) => {
      const id = blocks[ref.card.kind === 'video' ? anchor(ref) : ref.last]!.id;
      const list = out.get(id);
      if (list) list.push(ref.card);
      else out.set(id, [ref.card]);
    });
  return out;
}

/** 整条会话里归这部视频的活，按提交先后：线程里的视频卡与「产物」弹层里的是同一份。 */
export function conversationVideoJobs(videoId: Id, jobs: readonly JobRecord[], conversationId: Id): Id[] {
  const byId = new Map(jobs.map((j) => [j.jobId, j]));
  return jobs
    .filter((j) => !j.parentJobId && j.videoId === videoId && isRowJob(j) && agentOwner(j, byId, conversationId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId))
    .map((j) => j.jobId);
}

/** 这条会话的智能体让哪些视频有了活（流程新建、转录、导出……）：「产物」弹层里补上没有 `video-change` 的视频。 */
export function conversationJobVideos(jobs: readonly JobRecord[], conversationId: Id): Id[] {
  const byId = new Map(jobs.map((j) => [j.jobId, j]));
  const ids: Id[] = [];
  for (const j of jobs) {
    if (j.parentJobId || !j.videoId || !isRowJob(j) || ids.includes(j.videoId)) continue;
    if (agentOwner(j, byId, conversationId)) ids.push(j.videoId);
  }
  return ids;
}

// ---- 状态词 ----

export type VideoStatusKey = 'transcribing' | 'queued' | 'transcribed' | 'failed';

export interface VideoStatus {
  key: VideoStatusKey;
  /** 「转录中 · 45%」「排队中」「已转录」「失败」。 */
  text: string;
}

/**
 * 视频卡头上的状态词（原型 `badge`）：指向这部视频的转录在跑 / 排队时以它为准；否则有转录结果（完成的转录写了文稿，
 * 或编辑器开着它、文档里有 `speech`）是「已转录」；转录失败过是「失败」。什么都不知道时 null（不显示），
 * 不从「没有」推出「未转录」：Job 镜像只有这次 Runtime 记得的任务，视频没开着时也读不到它的文档。
 */
export function videoStatus(videoId: Id, jobs: readonly JobRecord[], transcribedInEditor: boolean): VideoStatus | null {
  const mine = jobs.filter((j) => j.kind === 'transcribe' && j.videoId === videoId);
  const running = mine.find((j) => j.state === 'running' || jobRetrying(j));
  if (running) {
    const pct = running.state === 'running' ? jobPercent(running) : null;
    return {
      key: 'transcribing',
      text: pct == null ? VIDEO_CARD_COPY.status.transcribing : `${VIDEO_CARD_COPY.status.transcribing} · ${pct}%`,
    };
  }
  if (mine.some((j) => j.state === 'queued')) return { key: 'queued', text: VIDEO_CARD_COPY.status.queued };
  if (transcribedInEditor || mine.some((j) => j.state === 'completed' && j.result?.documentId)) {
    return { key: 'transcribed', text: VIDEO_CARD_COPY.status.transcribed };
  }
  if (mine.some((j) => j.state === 'failed')) return { key: 'failed', text: VIDEO_CARD_COPY.status.failed };
  return null;
}

// ---- 一件活一行 ----

export type RowState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface JobRowView {
  jobId: Id;
  kind: 'transcribe' | 'translate' | 'export' | 'link-import' | 'other';
  name: string;
  state: RowState;
  /** 头上右侧：运行中是百分比（没有总量时 null），其余是一个状态词。 */
  tail: string | null;
  /** 进度条：0–100；运行中没有总量时 null（不确定的细条）；不在跑时不画。 */
  pct: number | null;
  /** 运行中「识别中 · 已识别 1:02 / 3:26」，排队中写在等什么。 */
  line: string | null;
  /** 转录与重新转录用的模型与参数（只读的一行，`asrLine` 拼成字）；别的活、不知道模型时 null。 */
  asr: AsrFacts | null;
  /** 已用时长（只在跑时）。 */
  elapsed: string | null;
  facts: string[];
  warnings: string[];
  /** 导出完成后的文件。 */
  files: ExportOutputFact[];
  /** 可以播放的导出文件（成片与音频；便携包不进产物库）。 */
  playable: Record<string, string>;
  error: string | null;
  canCancel: boolean;
  /** `jobs.reconcile` 的 `retry` 适用（中断、结果不明）。 */
  canRetry: boolean;
  remedy: Remedy | null;
}

function rowState(job: JobRecord): RowState {
  if (job.state === 'queued') return 'queued';
  if (job.state === 'running' || jobRetrying(job)) return 'running';
  if (job.state === 'completed') return 'done';
  if (job.state === 'failed') return 'failed';
  if (job.state === 'cancelled') return 'cancelled';
  return 'interrupted';
}

function rowKind(job: JobRecord): JobRowView['kind'] {
  if (job.kind === 'transcribe') return 'transcribe';
  if (job.kind === 'export') return 'export';
  if (isLinkImport(job)) return 'link-import';
  if (job.kind === 'pipeline' && job.pipeline?.name === TRANSLATE_PIPELINE) return 'translate';
  if (job.kind === 'pipeline' && job.pipeline?.name === 'transcribe') return 'transcribe';
  return 'other';
}

/** 同一部视频之前已经有完成的转录：这一件叫「重新转录」。 */
function isRetranscribe(job: JobRecord, jobs: readonly JobRecord[]): boolean {
  return jobs.some(
    (j) =>
      j.jobId !== job.jobId &&
      j.kind === 'transcribe' &&
      j.videoId === job.videoId &&
      j.state === 'completed' &&
      j.createdAt < job.createdAt,
  );
}

function rowName(job: JobRecord, kind: JobRowView['kind'], jobs: readonly JobRecord[]): string {
  switch (kind) {
    case 'transcribe':
      return job.kind === 'transcribe' && isRetranscribe(job, jobs) ? VIDEO_CARD_COPY.retranscribe : kindLabel('transcribe');
    case 'export':
      return job.export ? exportTitle(job.export.settings) : kindLabel('export');
    case 'translate': {
      const lang = targetOf(job);
      return lang ? `${VIDEO_CARD_COPY.translate} · ${lang}` : VIDEO_CARD_COPY.translate;
    }
    case 'link-import':
      return VIDEO_CARD_COPY.linkImport;
    default:
      return kindLabel(job.kind);
  }
}

/** 转录的计数：按秒「已识别 1:02 / 3:26」，按片段「已识别 12 / 40 段」。 */
function transcribeCount(job: JobRecord): string | null {
  const p = job.progress;
  if (!p) return null;
  if (p.unit === 'seconds') return VIDEO_CARD_COPY.recognized(formatClock(p.done), p.total != null ? formatClock(p.total) : null);
  if (p.unit === 'segments') return VIDEO_CARD_COPY.segments(p.done, p.total);
  return null;
}

/** 跑着的一行：阶段、计数与百分比。 */
function progressOf(job: JobRecord, kind: JobRowView['kind'], jobs: readonly JobRecord[]): { line: string | null; pct: number | null } {
  if (jobRetrying(job)) return { line: VIDEO_CARD_COPY.retrying, pct: null };
  const phase = JOB_PHASE_LABEL[job.phase];
  switch (kind) {
    case 'export':
      return { line: [exportPhaseLabel(job), exportProgressLine(job)].filter(Boolean).join(' · '), pct: jobPercent(job) };
    case 'translate': {
      const p = translateProgress(job, jobs);
      const count = p.units ? VIDEO_CARD_COPY.translated(p.units.done, p.units.total) : null;
      return { line: [p.step ?? phase, count].filter(Boolean).join(' · '), pct: p.percent };
    }
    case 'link-import': {
      const d = downloadProgress(job, jobs);
      return { line: [linkPhaseText(job), d ? downloaded(d) : null].filter(Boolean).join(' · '), pct: d?.pct ?? null };
    }
    case 'transcribe':
      return { line: [phase, transcribeCount(job)].filter(Boolean).join(' · '), pct: jobPercent(job) };
    default:
      return { line: phase, pct: jobPercent(job) };
  }
}

/** 「已下载 30 MB / 92 MB」：`downloadProgress` 有总量时只给两个数（`pct` 不为 null），没总量时 `text` 已是整句。 */
const downloaded = (d: { pct: number | null; text: string }) => (d.pct === null ? d.text : VIDEO_CARD_COPY.downloaded(d.text));

const warningText = (w: JobRecord['warnings'][number]) => VIDEO_CARD_COPY.warning[w.code] ?? localizeText(w.detail, w.detailRef) ?? w.code;

/** 一件活一行（原型 `jobRow`）：运行中阶段与进度，完成后结果事实与文件，失败原因与去处，取消写已取消。`now` 算已用时长。 */
export function jobRowView(job: JobRecord, jobs: readonly JobRecord[], now: number): JobRowView {
  const state = rowState(job);
  const kind = rowKind(job);
  const running = state === 'running';
  const progress = running ? progressOf(job, kind, jobs) : null;
  const done = state === 'done';
  const files = done && kind === 'export' ? exportOutputs(job) : [];
  const playable: Record<string, string> = {};
  if (done && kind === 'export') {
    // 成片和音频可以播放（字幕、便携包只在文件夹中显示）；扩展名再过一道 isPlayable：AVI 浏览器放不了。
    for (const [i, o] of (job.result?.outputs ?? []).entries()) {
      if ((o.media.kind === 'video' || o.media.kind === 'audio') && (!o.path || isPlayable(files[i]!.name)))
        playable[files[i]!.key] = o.artifactId;
    }
  }
  const facts: string[] = [];
  if (done && kind === 'transcribe' && job.result?.documentId) facts.push(VIDEO_CARD_COPY.documentWritten);
  if (done && kind === 'translate') {
    const lang = targetOf(job);
    if (lang) facts.push(lang);
  }
  const warnings = done ? (kind === 'export' ? exportWarnings(job) : [...new Set(job.warnings.map(warningText))]) : [];
  const failed = state === 'failed' || state === 'interrupted';
  const error = failed
    ? kind === 'link-import'
      ? (linkIssue(job.error, job.state)?.title ?? jobErrorText(job.error) ?? VIDEO_CARD_COPY.notFinished)
      : (jobErrorText(job.error) ?? VIDEO_CARD_COPY.notFinished)
    : null;
  const tail =
    state === 'running'
      ? progress?.pct != null
        ? `${progress.pct}%`
        : null
      : state === 'queued'
        ? VIDEO_CARD_COPY.tail.queued
        : state === 'done'
          ? VIDEO_CARD_COPY.tail.done
          : state === 'failed'
            ? VIDEO_CARD_COPY.tail.failed
            : state === 'cancelled'
              ? VIDEO_CARD_COPY.tail.cancelled
              : job.state === 'needs-reconciliation'
                ? VIDEO_CARD_COPY.tail.unknown
                : VIDEO_CARD_COPY.tail.interrupted;
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  return {
    jobId: job.jobId,
    kind,
    name: rowName(job, kind, jobs),
    state,
    tail,
    pct: progress?.pct ?? null,
    line: running ? progress!.line || null : state === 'queued' ? jobWaitText(job.wait) : null,
    asr: asrFacts(job, jobs),
    elapsed: running && Number.isFinite(started) ? VIDEO_CARD_COPY.elapsed(formatClock(Math.max(0, now - started) / 1000)) : null,
    facts,
    warnings,
    files,
    playable,
    error,
    canCancel: jobLive(job) && !jobRetrying(job) && !(kind === 'export' && cancelPending(job)),
    canRetry: reconcileOptions(job).includes('retry'),
    remedy: failed ? jobRemedy(job) : null,
  };
}

// ---- 转录用的模型与参数 ----

/**
 * 转录那一行用的是什么（产品设计 §3.2.2 视频卡；原型 `asrLine`）。`language`：语言标签；null 是自动检测；
 * undefined 是不知道（记录里没写，不显示这一段）。`diarize` 是生效的说话人区分（模型不能区分、报了警告的不算）。
 */
export interface AsrFacts {
  providerId: string;
  modelId: string;
  language: string | null | undefined;
  diarize: boolean;
}

/** 流程（转录、从链接导入）以自己的 jobId 为提交者提交的转录 Job，后提交的在后。 */
function pipelineTranscribes(parent: JobRecord, jobs: readonly JobRecord[]): JobRecord[] {
  return jobs
    .filter((j) => j.kind === 'transcribe' && j.submitter.kind === 'pipeline' && j.submitter.id === parent.jobId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId));
}

/**
 * 转录行的模型与参数：Provider 与模型取转录 Job（转录流程的父任务取它提交的那次，还没提交时取父任务冻结的选择），
 * 语言与说话人区分取转录 Job 的 `transcribe`；之前的记录没有时退回流程冻结的参数（`language` 不给是自动检测，
 * `diarize` 没给就不写）。不是转录、没有模型时 null。
 */
export function asrFacts(job: JobRecord, jobs: readonly JobRecord[]): AsrFacts | null {
  if (rowKind(job) !== 'transcribe') return null;
  const parentId = job.kind === 'pipeline' ? job.jobId : job.submitter.kind === 'pipeline' ? job.submitter.id : null;
  const parent = parentId === job.jobId ? job : parentId ? jobs.find((j) => j.jobId === parentId) : undefined;
  const source = job.kind === 'transcribe' ? job : (pipelineTranscribes(job, jobs).at(-1) ?? job);
  if (!source.modelId) return null;
  const params = parent?.pipeline?.params;
  const asked = source.transcribe;
  const unavailable = source.warnings.some((w) => w.code === 'diarization-unavailable');
  return {
    providerId: source.providerId,
    modelId: source.modelId,
    language: asked ? asked.language.tag : params ? (typeof params.language === 'string' ? params.language : null) : undefined,
    diarize: (asked ? asked.diarize : params?.diarize === true) && !unavailable,
  };
}

/**
 * 模型给人看的名字（与转录工具页的模型菜单同源）：本机与节点是模型包的名字，在线的是「API 提供方 · 模型」；
 * 能力视图里查不到时照写模型 ID。
 */
export function asrModelName(
  view: ModelCapabilitiesView | null,
  bundles: readonly Pick<ModelBundleStatus, 'bundleId' | 'label'>[],
  providerId: string,
  modelId: string,
): string {
  const provider = view?.transcribe.providers.find((p) => p.providerId === providerId);
  const model = provider?.models.find((m) => m.modelId === modelId);
  if (providerId === 'local' || providerId.startsWith('node:')) {
    const bundle = bundles.find((b) => b.bundleId === modelId);
    return bundle ? bundleName(bundle) : model?.label || modelId;
  }
  const name = model?.label || modelId;
  return provider && provider.kind === 'online' ? `${provider.label} · ${name}` : name;
}

/**
 * 转录那一行的字：「模型 · 本机或云端 · 语言 · 识别说话人」（产品设计 §3.2.2）。`words` 是转录工具页的「自动检测」
 * 与「识别说话人」，由界面层传入（与工具页同一套用词）。
 */
export function asrLine(facts: AsrFacts, modelName: string, words: { auto: string; speakers: string }): string {
  const language = facts.language === undefined ? null : facts.language === null ? words.auto : langName(facts.language);
  return [modelName, runsOnLabel(facts.providerId), language, facts.diarize ? words.speakers : null].filter(Boolean).join(' · ');
}

// ---- 摊开与收起 ----

/** 折叠只看这几项：状态、补救与能不能重试。 */
type FoldRow = Pick<JobRowView, 'state' | 'remedy' | 'canRetry'>;

/**
 * 这一行要不要人去处理（原型 `needsAction`）：没有做完（失败，或中断、结果不明），而且有去处（`jobRemedy` 的补救，
 * 或 `jobs.reconcile` 的重试）。没有去处的失败、已取消的都不算。
 */
export function needsAction(row: FoldRow): boolean {
  return (row.state === 'failed' || row.state === 'interrupted') && (row.remedy !== null || row.canRetry);
}

/**
 * 视频卡上摊开哪几行、收起哪几行（产品设计 §3.2.2；原型 `foldRows`）。`rows` 按 `cardRows` 的先后（提交先后）。
 * - 有活在跑或排队：摊开全部进行中的，按原先后；这时不摊开已结束的。
 * - 都结束了：只摊开最后一件，「最后」按提交先后取（规格写的是「按提交先后」，不按结束时间）。
 * - 其余收进 `earlier`，**新的在前**；`pending` 是其中待处理的件数（`needsAction`），摊开着的不算。
 */
export function foldRows<R extends FoldRow>(rows: readonly R[]): { shown: R[]; earlier: R[]; pending: number } {
  const live = rows.filter((r) => r.state === 'running' || r.state === 'queued');
  const shown = live.length ? live : rows.slice(-1);
  const earlier = rows.filter((r) => !shown.includes(r)).reverse();
  return { shown, earlier, pending: earlier.filter(needsAction).length };
}

/**
 * 卡上要列的行（按提交先后）。从链接导入到这部视频的父任务：下载、导入还在做时是一行；流程提交的转录一出现，
 * 进度由转录那一行念，父任务不再另占一行；完成后也不再列（原型：下载完成后卡上只剩转录）。失败、取消时留着写原因。
 * 转录流程的父任务同理：它提交的转录 Job 出现后由那一行念（一次转录一行）；只有转录做完而流程还在做后面的步骤
 * （建字幕层）或在那之后失败、取消时，父任务那一行留着。
 */
export function cardRows(jobIds: readonly Id[], jobs: readonly JobRecord[]): JobRecord[] {
  const byId = new Map(jobs.map((j) => [j.jobId, j]));
  return jobIds
    .map((id) => byId.get(id))
    .filter((j): j is JobRecord => !!j)
    .filter((j) => !isPreviewExport(j))
    .filter((j) => {
      if (j.kind === 'pipeline' && j.pipeline?.name === 'transcribe') {
        const child = pipelineTranscribes(j, jobs).at(-1);
        return !child || (child.state === 'completed' && j.state !== 'completed');
      }
      if (!isLinkImport(j)) return true;
      if (j.state === 'completed') return false;
      return !jobs.some((t) => t.kind === 'transcribe' && t.submitter.kind === 'pipeline' && t.submitter.id === j.jobId);
    });
}

// ---- 下载卡 ----

export interface DownloadCardView {
  jobId: Id;
  state: RowState;
  title: string;
  /** 视频标题；还没解析出来时是站点。 */
  name: string;
  /** 脱敏后的链接。 */
  source: string | null;
  pct: number | null;
  line: string | null;
  elapsed: string | null;
  error: string | null;
  hint: string | null;
  /** 只下载、不建视频时落地的文件（媒体与字幕），可以在文件夹中显示。 */
  files: { name: string; path: string }[];
  canCancel: boolean;
  canRetry: boolean;
}

const basename = (file: string) => file.split(/[\\/]/).pop() || file;

/** 下载卡（原型 `download`）：来源、已下载多少、已用时长、取消；失败写原因与说明；完成写落地的文件。 */
export function downloadCardView(job: JobRecord, jobs: readonly JobRecord[], now: number): DownloadCardView {
  const state = rowState(job);
  const running = state === 'running';
  const frozen = linkFrozen(job);
  const meta = linkMeta(job);
  const d = running ? downloadProgress(job, jobs) : null;
  const issue = state === 'failed' || state === 'interrupted' ? linkIssue(job.error, job.state) : null;
  const summary = state === 'done' ? linkSummary(job) : null;
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  const T = VIDEO_CARD_COPY.download;
  return {
    jobId: job.jobId,
    state,
    title: { queued: T.queued, running: T.running, done: T.done, failed: T.failed, cancelled: T.cancelled, interrupted: T.interrupted }[
      state
    ],
    name: meta.title ?? (frozen.host || T.fallbackName),
    source: frozen.url || null,
    pct: d?.pct ?? null,
    line: running ? [linkPhaseText(job), d ? downloaded(d) : null].filter(Boolean).join(' · ') : null,
    elapsed: running && Number.isFinite(started) ? VIDEO_CARD_COPY.elapsed(formatClock(Math.max(0, now - started) / 1000)) : null,
    error: issue ? issue.title : state === 'failed' ? (jobErrorText(job.error) ?? T.failed) : null,
    hint: issue ? issue.body : null,
    files: summary ? [summary.files.media, ...summary.files.subtitles].map((path) => ({ name: basename(path), path })) : [],
    canCancel: jobLive(job) && !jobRetrying(job),
    canRetry: reconcileOptions(job).includes('retry'),
  };
}
