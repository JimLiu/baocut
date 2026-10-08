import {
  type Conversation,
  type FileTarget,
  type Id,
  type JobRecord,
  type SpaceEntry,
  type SpaceEntryKind,
  type SpaceScanIssue,
  type TimelineItem,
} from '@baocut/protocol';
import { videoTargetOf } from './space.ts';
import { changedFiles } from './thread.ts';
import { conversationJobVideos, isVideoAt, videoOutput } from './video-cards.ts';
import { isPreviewExport } from './export-job.ts';

/** 会话头「产物」里的一项（产品设计 §3.2 用户修订）：这条会话新建、改过或在上面做过活的视频，或它工作目录里的文件。 */
export interface ConversationOutput {
  /** 视频用视频 ID（同一个改几次只算一项），其它文件用 Space 条目 ID。 */
  id: string;
  kind: SpaceEntryKind;
  name: string;
  /** 视频在编辑器里打开的定位；不是视频时为 null。 */
  video: FileTarget | null;
  /** 对应的 Space 条目；视频还没扫描到时为 null。 */
  entry: SpaceEntry | null;
  /** 视频最近一次修改后的时长。 */
  durationSeconds: number | null;
  at: string;
  /**
   * 产生它的任务：视频取最近一次修改所在的任务；文件取最近一次改到它的文件改动步骤所在的任务。
   * 认不出来时为 null（只在会话头的「产物」里列，不挂到哪条回复下面）。
   */
  taskId: Id | null;
}

const LIMIT = 30;

/**
 * 文件改动步骤改到的文件 → 最近一次改它的任务。Driver 写的路径可能是绝对路径，也可能相对工作目录；
 * 两种都记下（绝对路径落在工作目录里的，再按相对路径记一份）。
 */
function fileTasks(items: readonly TimelineItem[], cwd: string | undefined): Map<string, Id> {
  const byPath = new Map<string, Id>();
  const root = cwd ? cwd.replace(/\/+$/, '') + '/' : null;
  for (const item of items) {
    if (item.kind !== 'tool-call' || !item.taskId) continue;
    for (const { path } of changedFiles(item)) {
      const clean = path.replace(/^\.\//, '');
      byPath.set(clean, item.taskId);
      if (root && clean.startsWith(root)) byPath.set(clean.slice(root.length), item.taskId);
    }
  }
  return byPath;
}

/**
 * 这条会话的产物，最近的在前：智能体新建（`video-created`）或经视频引擎改过（变更卡）的视频，智能体在上面做过活的视频
 * （转录、导出、从链接导入新建的……，`jobs` 里这条会话提交的），加上不属于项目的会话自己工作目录里的文件。
 * 项目会话的其它文件没有记录是哪条会话产生的，不列；进了回收站的不列。`cwd` 用来把文件对回改它的任务。
 * 会话头只列最近 30 项；按回复分组时不截断（`limit: Infinity`）。
 */
export function conversationOutputs(
  conversation: Pick<Conversation, 'id' | 'projectId'> & { cwd?: string },
  items: readonly TimelineItem[],
  entries: readonly SpaceEntry[],
  limit = LIMIT,
  jobs: readonly JobRecord[] = [],
): ConversationOutput[] {
  const videos = new Map<string, ConversationOutput>();
  for (const item of items) {
    if (item.kind !== 'video-change' && item.kind !== 'video-created') continue;
    const entry = entries.find((e) => isVideoAt(e, item.target)) ?? null;
    const before = videos.get(item.videoId);
    videos.set(item.videoId, {
      id: item.videoId,
      kind: 'video',
      name: entry?.name ?? item.videoName,
      video: item.target,
      entry,
      durationSeconds:
        item.kind === 'video-change' ? item.durationSeconds.after : (before?.durationSeconds ?? entry?.media?.durationSec ?? null),
      at: item.createdAt,
      taskId: item.taskId,
    });
  }
  for (const videoId of conversationJobVideos(jobs, conversation.id)) {
    if (!videos.has(videoId)) videos.set(videoId, videoOutput(videoId, items, entries, jobs));
  }
  const outputs = [...videos.values()].filter((output) => !output.entry?.user.trashedAt);
  if (!conversation.projectId) {
    const normalize = (path: string) => path.replace(/\\/g, '/');
    const exports = jobs.filter((j) => j.kind === 'export');
    const previewByJob = new Map(exports.map((j) => [j.jobId, isPreviewExport(j)]));
    const previewPaths = new Set<string>();
    // 同一个路径后来被正式导出替换时，以最近一次发布的用途为准，不让旧预览藏掉新交付。
    const published = [...exports].sort(
      (a, b) => (a.endedAt ?? a.createdAt).localeCompare(b.endedAt ?? b.createdAt) || a.jobId.localeCompare(b.jobId),
    );
    for (const job of published) {
      for (const output of job.result?.outputs ?? []) {
        if (!output.path) continue;
        const path = normalize(output.path);
        if (isPreviewExport(job)) previewPaths.add(path);
        else previewPaths.delete(path);
      }
    }
    const root = conversation.cwd ? normalize(conversation.cwd).replace(/\/+$/, '') + '/' : null;
    const listed = new Set(outputs.map((output) => output.entry?.id));
    const tasks = fileTasks(items, conversation.cwd);
    for (const entry of entries) {
      if (entry.source.conversationId !== conversation.id || entry.user.trashedAt || listed.has(entry.id)) continue;
      const originPreview = entry.origin?.jobId ? previewByJob.get(entry.origin.jobId) : undefined;
      const pathPreview = !!(
        (entry.file && previewPaths.has(normalize(entry.file.path))) || (root && previewPaths.has(root + entry.relPath))
      );
      if (originPreview ?? pathPreview) continue;
      outputs.push({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        video: entry.kind === 'video' ? videoTargetOf(entry) : null,
        entry,
        durationSeconds: null,
        at: entry.lastActivityAt,
        taskId: tasks.get(entry.relPath) ?? null,
      });
    }
  }
  return outputs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/**
 * 每条回复下面的产物（原型 home-session.jsx `SessionMessageArtifacts`）：按任务归到这个任务最后一条显示出来的回复下面，
 * 同一条回复下按出现的先后排。任务没有回复（例如还没开口就失败了）的产物只在会话头的「产物」里列。
 */
export function outputsByMessage(items: readonly TimelineItem[], outputs: readonly ConversationOutput[]): Map<Id, ConversationOutput[]> {
  const lastReply = new Map<Id, Id>();
  for (const item of items) {
    if (item.kind === 'agent-message' && item.taskId && (item.text.trim() || item.streaming)) lastReply.set(item.taskId, item.id);
  }
  const byMessage = new Map<Id, ConversationOutput[]>();
  for (const output of [...outputs].sort((a, b) => a.at.localeCompare(b.at))) {
    const messageId = output.taskId ? lastReply.get(output.taskId) : undefined;
    if (!messageId) continue;
    const list = byMessage.get(messageId);
    if (list) list.push(output);
    else byMessage.set(messageId, [output]);
  }
  return byMessage;
}

/**
 * 视频的源目录还在不在（原型 `SessionMoviePreview` 的「找不到源文件」）。只在 Space 扫完、这个来源的扫描没有截断或读不了、
 * 却没有这个视频的条目时才算找不到；还在扫、扫描不完整时不下结论。目录藏得比扫描深度（6 层）还深时会误报。
 */
export function outputSourceMissing(
  output: ConversationOutput,
  space: { ready: boolean; scanning: boolean; issues: readonly SpaceScanIssue[] },
): boolean {
  const target = output.video;
  if (!target || output.entry || !space.ready || space.scanning) return false;
  const sourceKey =
    'projectId' in target ? `project:${target.projectId}` : 'conversationId' in target ? `conv:${target.conversationId}` : null;
  if (!sourceKey) return false;
  return !space.issues.some((issue) => issue.sourceKey === sourceKey);
}

/**
 * 视频卡 16:9 预览取的那一帧（规则在 `@baocut/protocol`，与 Space 缩略图 `space.thumbnail` 同一帧）。
 * 编辑器开着它时用 `media.thumbnail` 取当前快照的封面；其它视频经 Space 缩略图取封面，不用打开视频。
 */
export { posterFrame } from '@baocut/protocol';
