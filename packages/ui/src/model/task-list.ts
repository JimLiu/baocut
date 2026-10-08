import { localizeText, type Conversation, type Id, type JobKind, type JobRecord, type Project, type TaskSummary } from '@baocut/protocol';
import { JOB_PHASE_LABEL, TASK_KIND_LABEL, TASK_STATUS_LABEL, TASK_VIEW_COPY, VIDEO_CARD_COPY } from '../copy.ts';
import { exportPhaseLabel, exportTitle } from './export-job.ts';
import { shortenPath } from './format.ts';
import { isLinkImport, linkKindLabel, linkPhaseText, linkTitle } from './link-import.ts';
import { jobErrorText, jobWaitText } from './localized-text.ts';
import { langName } from './tools-models.ts';

/**
 * 后台任务的统一表（原型 page-tasks.jsx、产品设计 §2.1 用户修订）：Agent 会话里的任务（TaskSummary）与
 * 模型计算（JobRecord）合成一张表，任务页、侧栏与任务胶囊读同一份。纯函数：时间与目录作为参数传进来。
 */

/**
 * 任务的种类：Agent 任务，或 Job 的种类。导出也是一条 Job（`kind: 'export'`，架构设计 §9.11）：标题、位置与阶段读它的
 * `export` 信息；任务胶囊不列本视频的导出（顶栏的导出按钮已经在念它的进度）。
 * `legacyImport` 是启动时导入旧版项目的那一轮（`legacy-import` 主题，model/legacy-import-run.ts），不是 Job。
 */
export type TaskKind = 'agent' | JobKind | 'legacyImport';

/** 原型的色调：chip 与种类图标底色按它取（page-tasks.jsx `TaskCard`）。 */
export type TaskTone = 'accent' | 'info' | 'notice' | 'neutral' | 'positive' | 'negative';

export type TaskAction = { type: 'stop'; taskId: Id } | { type: 'cancel'; jobId: Id };

export interface TaskRow {
  id: Id;
  /** 来自哪：Agent 任务、Job，或这次启动导入旧版项目的那一轮。 */
  origin: 'task' | 'job' | 'legacy-import';
  kind: TaskKind;
  /** 念出来的种类：通常是 `kindLabel(kind)`；从链接导入的 `kind` 是通用的 `pipeline`，念「从链接导入」。 */
  kindText: string;
  title: string;
  /** 副标题的「在哪」：Agent 任务是项目 › 会话，Job 是模型 · 跑在哪。 */
  where: string;
  /** 开始时间；还在排队的 Job 用提交时间。 */
  startedAt: string;
  endedAt: string | null;
  /** 进行中一组：Agent 任务在跑或正在停止，Job 排队或在跑。 */
  live: boolean;
  queued: boolean;
  /** Agent 任务在等用户批准。 */
  waiting: boolean;
  /** 状态 chip 的字。 */
  label: string;
  tone: TaskTone;
  /** 在跑的 Job 的阶段；排队的 Job 是 Runtime 记着的在等什么（没有时 null）。 */
  phase: string | null;
  /** 0–100；null 表示没有确定进度。 */
  pct: number | null;
  /** 卡片上的进度条：数字是确定进度，`indet` 转圈，null 不画。 */
  progress: number | 'indet' | null;
  /** 来源 chip：智能体经工具提交的念「Agent」，别的连接念「命令行」。 */
  chip: 'agent' | 'cli' | null;
  action: TaskAction | null;
  conversationId: Id | null;
  projectId: Id | null;
  videoId: Id | null;
  error: string | null;
}

/** 编辑器打开的视频：转录的标题念它的名字与素材名，胶囊的「这个视频」也按它判。 */
export interface OpenVideoFacts {
  videoId: Id;
  name: string;
  projectId: Id | null;
  assets: Readonly<Record<Id, { name: string }>>;
}

export interface TaskContext {
  projects: readonly Pick<Project, 'id' | 'name'>[];
  conversations: readonly Pick<Conversation, 'id' | 'projectId' | 'activity'>[];
  video?: OpenVideoFacts | null;
}

export interface TaskGroup {
  id: 'active' | 'history';
  label: string;
  items: TaskRow[];
}

/** 截到 n 个字符（按码点），超出补「…」（原型 model-task-facts.js `clip`）。 */
export function clip(text: string, n: number): string {
  const chars = Array.from(text.trim());
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

/** 0–100 的整数；总量未知或为 0 时 null（不伪造百分比）。向下取整：没做完就不念 100%。 */
export function jobPercent(job: Pick<JobRecord, 'progress'>): number | null {
  const p = job.progress;
  if (!p || p.total == null || !(p.total > 0)) return null;
  return Math.max(0, Math.min(100, Math.floor((p.done / p.total) * 100)));
}

const AGENT_PROVIDER_NAME: Record<string, string> = { codex: 'Codex', claude: 'Claude' };

/** Job 跑在哪：本机、远端节点、云端；智能体 Provider 在本机跑（原型 data.js `runsOn: '本机 · Codex'`）。 */
export function runsOnLabel(providerId: string): string {
  if (providerId === 'local') return TASK_VIEW_COPY.local;
  if (providerId.startsWith('node:')) return TASK_VIEW_COPY.node;
  if (providerId.startsWith('agent:')) {
    const id = providerId.slice('agent:'.length);
    return `${TASK_VIEW_COPY.local} · ${AGENT_PROVIDER_NAME[id] ?? id}`;
  }
  return TASK_VIEW_COPY.cloud;
}

export function kindLabel(kind: TaskKind): string {
  return TASK_KIND_LABEL[kind];
}

/** 会话 ID：Agent 任务自己的，或智能体经工具提交的 Job 的。 */
function jobConversation(job: JobRecord): Id | null {
  return job.submitter.kind === 'agent' ? job.submitter.id : null;
}

function jobTitle(job: JobRecord, video: OpenVideoFacts | null): string {
  const g = job.generation;
  if (g?.capability === 'generateImage' && g.prompt.trim()) return clip(g.prompt, 40);
  if (g?.capability === 'synthesizeSpeech' && g.text.trim()) return clip(g.text, 40);
  if (job.kind === 'transcribe' && video) {
    const asset = job.assetId ? video.assets[job.assetId]?.name : undefined;
    return [kindLabel('transcribe'), video.name, asset].filter(Boolean).join(' · ');
  }
  // 从链接导入：「从链接导入 · 标题」（标题还没解析出来时写网站）。
  if (isLinkImport(job)) return linkTitle(job);
  // 智能体自己翻译：「翻译 · 访谈 · 英语」（视频名只有打开着时才知道）。
  if (job.kind === 'agentTranslate') {
    return [kindLabel(job.kind), video?.name, job.translation ? langName(job.translation.targetLanguage) : null].filter(Boolean).join(' · ');
  }
  // 导出：「导出视频 · MP4 · 访谈」（种类与格式取冻结的设置；视频名只有打开着时才知道）。
  if (job.kind === 'export' && job.export) return [exportTitle(job.export.settings), video?.name].filter(Boolean).join(' · ');
  return kindLabel(job.kind);
}

/**
 * 这几种 Job 的 `providerId` 不是模型服务商，而是工具或来源的名字（yt-dlp、google-fonts），`modelId` 是工具版本或字体族；
 * 它们都在本机跑，不能按 `runsOnLabel` 落到「云端」。
 */
function localToolWhere(job: JobRecord): string | null {
  if (isLinkImport(job) || job.kind === 'toolInstall' || job.kind === 'toolUpdate') {
    return [[job.providerId, job.modelId].filter(Boolean).join(' '), TASK_VIEW_COPY.local].join(' · ');
  }
  if (job.kind === 'fontDownload') return [job.modelId, TASK_VIEW_COPY.local].filter(Boolean).join(' · ');
  return null;
}

/** 在哪：导出是写到哪个目录（本机）；别的 Job 是模型 · 跑在哪。 */
function jobWhere(job: JobRecord): string {
  // 智能体自己翻译：`modelId` 就是 Driver，「本机 · Codex」已经说全了。
  if (job.kind === 'agentTranslate') return runsOnLabel(job.providerId);
  if (job.kind === 'export' && job.export) return [shortenPath(job.export.destination.dir), runsOnLabel(job.providerId)].join(' · ');
  return localToolWhere(job) ?? [job.modelId, runsOnLabel(job.providerId)].filter(Boolean).join(' · ');
}

/**
 * Worker 崩溃后自动重跑的那一下（job-manager 的 `crashed` 分支）：状态先记为 `interrupted` 推出来，但没有写 `endedAt`，
 * 紧接着同一个任务再跑一次。真结束了的中断一定有 `endedAt`。
 */
export function jobRetrying(job: Pick<JobRecord, 'state' | 'endedAt'>): boolean {
  return job.state === 'interrupted' && job.endedAt === null;
}

/** 还没结束：排队、在跑，或崩溃后正在自动重跑。 */
export function jobLive(job: Pick<JobRecord, 'state' | 'endedAt'>): boolean {
  return job.state === 'queued' || job.state === 'running' || jobRetrying(job);
}

const JOB_ENDED: Record<Exclude<JobRecord['state'], 'queued' | 'running'>, { label: string; tone: TaskTone }> = {
  completed: { label: TASK_VIEW_COPY.completed, tone: 'positive' },
  failed: { label: TASK_VIEW_COPY.failed, tone: 'negative' },
  // 取消不叫失败：失败是链路坏了，取消是用户自己停的（原型 page-tasks.jsx 第 120 轮）。
  cancelled: { label: TASK_VIEW_COPY.cancelled, tone: 'neutral' },
  // 中断：Runtime 停止或重启时没做完，不续跑。不是链路坏了，也不是用户停的。
  interrupted: { label: TASK_VIEW_COPY.interrupted, tone: 'neutral' },
  // 结果不明：Runtime 重启时外发调用还没回音，可能已经计费，不自动重发（§7.5），等用户决定。
  'needs-reconciliation': { label: TASK_VIEW_COPY.needsReconciliation, tone: 'notice' },
};

export function jobRow(job: JobRecord, ctx: TaskContext): TaskRow {
  const video = ctx.video && job.videoId === ctx.video.videoId ? ctx.video : null;
  const conversationId = jobConversation(job);
  const conversation = conversationId ? ctx.conversations.find((c) => c.id === conversationId) : undefined;
  const queued = job.state === 'queued';
  const retrying = jobRetrying(job);
  const running = job.state === 'running' || retrying;
  const pct = job.state === 'running' ? jobPercent(job) : null;
  // 排队时那一行写 Runtime 记着的在等什么（并发名额或机器资源，架构设计 §7.6）。
  const phase = retrying
    ? TASK_VIEW_COPY.retrying
    : running
      ? job.kind === 'export'
        ? exportPhaseLabel(job)
        : isLinkImport(job)
          ? linkPhaseText(job)
          : job.kind === 'agentTranslate'
            ? VIDEO_CARD_COPY.agentTranslating
            : JOB_PHASE_LABEL[job.phase]
      : queued
        ? jobWaitText(job.wait)
        : null;
  const status =
    job.state === 'queued'
      ? { label: TASK_VIEW_COPY.queued, tone: 'info' as const }
      : running
        ? { label: pct == null ? phase! : `${phase} · ${pct}%`, tone: 'accent' as const }
        : JOB_ENDED[job.state as keyof typeof JOB_ENDED];
  return {
    id: job.jobId,
    origin: 'job',
    kind: job.kind,
    kindText: isLinkImport(job) ? linkKindLabel() : kindLabel(job.kind),
    title: jobTitle(job, video),
    where: jobWhere(job),
    startedAt: job.startedAt ?? job.createdAt,
    endedAt: job.endedAt,
    live: queued || running,
    queued,
    waiting: false,
    label: status.label,
    tone: status.tone,
    phase,
    pct,
    progress: running ? (pct ?? 'indet') : queued ? 'indet' : null,
    chip: job.submitter.kind === 'agent' ? 'agent' : job.submitter.kind === 'connection' ? 'cli' : null,
    // 智能体自己翻译不给取消：取消这条记录停不下智能体，要停就停那条会话（打开会话，或停它那一行的 Agent 任务）。
    action: (queued || running) && job.kind !== 'agentTranslate' ? { type: 'cancel', jobId: job.jobId } : null,
    conversationId,
    projectId: conversation?.projectId ?? video?.projectId ?? null,
    videoId: job.videoId,
    error: jobErrorText(job.error) ?? null,
  };
}

export function agentRow(task: TaskSummary, ctx: TaskContext): TaskRow {
  const conversation = ctx.conversations.find((c) => c.id === task.conversationId);
  const project = task.projectId ? ctx.projects.find((p) => p.id === task.projectId) : undefined;
  const live = task.status === 'running' || task.status === 'stopping';
  // 等用户批准时任务本身仍在进行，等待记在会话的活动上（产品设计 §3.1）。
  const waiting = task.status === 'running' && conversation?.activity === 'awaiting-approval';
  // 会话标题常常就是第一句话（也就是任务目标）：一样时只写项目。
  const title = task.conversationTitle && task.conversationTitle !== task.goal ? task.conversationTitle : null;
  const where = [project?.name ?? (title ? null : TASK_VIEW_COPY.noProject), title].filter(Boolean).join(' › ');
  const tone: TaskTone = waiting
    ? 'notice'
    : task.status === 'failed'
      ? 'negative'
      : task.status === 'completed'
        ? 'positive'
        : task.status === 'stopped'
          ? 'neutral'
          : 'accent';
  return {
    id: task.taskId,
    origin: 'task',
    kind: 'agent',
    kindText: kindLabel('agent'),
    title: task.goal,
    where,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    live,
    queued: false,
    waiting,
    label: waiting ? TASK_VIEW_COPY.awaitingApproval : TASK_STATUS_LABEL[task.status],
    tone,
    phase: null,
    pct: null,
    progress: live && !waiting ? 'indet' : null,
    chip: null,
    action: task.status === 'running' ? { type: 'stop', taskId: task.taskId } : null,
    conversationId: task.conversationId,
    projectId: task.projectId,
    videoId: null,
    error: localizeText(task.error, task.errorRef) ?? null,
  };
}

/** 还在跑的从链接导入正在等的那次转录：流程以自己的 jobId 为提交者提交（`video-create.ts` `transcribeInVideo`）。 */
function liveLinkTranscribe(parent: JobRecord, jobs: readonly JobRecord[]): JobRecord | null {
  return (
    jobs.find(
      (j) =>
        j.kind === 'transcribe' &&
        j.submitter.kind === 'pipeline' &&
        j.submitter.id === parent.jobId &&
        (j.state === 'queued' || j.state === 'running' || jobRetrying(j)),
    ) ?? null
  );
}

export interface TaskRowsOptions {
  /**
   * 从链接导入走到转录时与它的转录合成一行（原型 model-import.js `attach`：同一个任务变成转录，念转录的阶段与模型 · 本机）。
   * 任务详情按 ID 找原样的那一行，传 false。
   */
  fold?: boolean;
}

/**
 * 合成一张表，后起的在前。固定流程的步骤（`parentJobId`）折叠在父任务下，不单独成行（与 `jobs.list` 一致）；
 * `fold` 时从链接导入在转录期间沿用自己的 ID、标题与取消，种类、阶段、进度与「在哪」换成那次转录的。
 */
export function taskRows(
  tasks: readonly TaskSummary[],
  jobs: readonly JobRecord[],
  ctx: TaskContext,
  options: TaskRowsOptions = {},
): TaskRow[] {
  const fold = options.fold ?? true;
  const folded = new Set<Id>();
  const jobRows = jobs
    .filter((j) => !j.parentJobId)
    .map((j) => {
      const row = jobRow(j, ctx);
      const child = fold && row.live && isLinkImport(j) ? liveLinkTranscribe(j, jobs) : null;
      if (!child) return row;
      folded.add(child.jobId);
      const { kind, kindText, where, queued, label, tone, phase, pct, progress } = jobRow(child, ctx);
      return { ...row, kind, kindText, where, queued, label, tone, phase, pct, progress };
    });
  const rows = [...tasks.map((t) => agentRow(t, ctx)), ...jobRows.filter((r) => !folded.has(r.id))];
  return rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** 两组：进行中（在跑、排队、正在停止）与历史，各自保持表里的顺序。 */
export function taskGroups(rows: readonly TaskRow[]): [TaskGroup, TaskGroup] {
  return [
    { id: 'active', label: TASK_VIEW_COPY.activeSection, items: rows.filter((r) => r.live) },
    { id: 'history', label: TASK_VIEW_COPY.historyGroup, items: rows.filter((r) => !r.live) },
  ];
}
