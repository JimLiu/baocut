// i18n-ignore-file: facts and evidence reasons for the model (English)
import path from 'node:path';
import type { Evidence, Id, JobRecord, Money, Project, ResourceRef, RevertPlan, UsageRecord, VideoVersionList, WorkItem } from '@baocut/protocol';
import { sumMoney } from './bot-budget.ts';
import type { BotWorkspace } from './bot-service.ts';

/*
 * BotWorkspace 接到 Runtime 的服务上（技术方案 §13.5、§9.5）：项目来自 Harness，视频来自 Space 目录，证据按 Job 记录核对。
 * 依赖都是取值函数，Space 目录比 Bot 服务晚建好。
 */

export interface RuntimeWorkspaceDeps {
  projects: () => Project[];
  videos: () => { entryId: Id; dir: string; projectId: Id | null; videoId: Id | null; lastActivityAt: string }[];
  /** Job 记录；没有这个 Job 时抛错或返回 undefined。 */
  job: (jobId: Id) => JobRecord | undefined;
  /** 视频的版本记录，新的在前（`VideoService.listVersions`）；读不出时抛错。 */
  versions: (videoId: Id) => Promise<VideoVersionList>;
  /** 用量账本的全部记录（§14.5 频道花费）；不给时不算频道预算。 */
  usage?: () => Promise<UsageRecord[]>;
  /**
   * 整体撤销（BOT-EX-19）：打开视频（读版本、回到版本都要视频开着）与以用户的身份回到某一版（用户在任务上点的）。
   * 线程自己的「改回去」不走这里：只算出该回到哪一版，由线程用普通的视频工具去做，照样过授权、确认与保护范围。不给时不提供撤销。
   */
  openVideo?: (projectId: Id, videoId: Id) => Promise<void>;
  restoreVersion?: (videoId: Id, version: number, before: boolean) => Promise<number | null>;
}

export function runtimeWorkspace(deps: RuntimeWorkspaceDeps): BotWorkspace {
  const job = (jobId: Id): JobRecord | undefined => {
    try {
      return deps.job(jobId);
    } catch {
      return undefined;
    }
  };
  /**
   * 撤销计划：任务资源里的每部视频，线程改过的最早一版是基线（回到它开始之前）。基线之后有用户自己的改动（`user_local` 的操作）
   * 时不能只撤智能体的；有别的会话（别的任务、别的对话）的改动时整个回到基线会连它们一起撤掉，这部视频不撤（`others` 里记着）。
   * 线程没改过的视频不列。
   */
  const inspect = async (item: WorkItem): Promise<{ plan: RevertPlan; others: Set<Id> }> => {
    const others = new Set<Id>();
    const threadId = item.threadId;
    if (!threadId || !deps.openVideo) return { plan: { videos: [] }, others };
    const refs = new Map<Id, Id>();
    for (const ref of item.resources) if (ref.kind === 'video' || ref.kind === 'video-range') refs.set(ref.videoId, ref.projectId);
    const videos: RevertPlan['videos'] = [];
    for (const [videoId, projectId] of refs) {
      let list: VideoVersionList;
      try {
        await deps.openVideo(projectId, videoId);
        list = await deps.versions(videoId);
      } catch {
        videos.push({ projectId, videoId, baseVersion: 0, userEdits: [], agentOnlyPossible: false, reason: `could not read the versions of video ${videoId}` });
        continue;
      }
      const touched = list.versions.filter((v) => v.conversations.some((c) => c.id === threadId));
      if (!touched.length) continue;
      const baseVersion = Math.min(...touched.map((v) => v.version));
      const since = list.versions.filter((v) => v.version >= baseVersion);
      const userEdits = since
        .filter((v) => v.actions.some((a) => a.actor === 'user_local'))
        .map((v) => ({ version: v.version, at: v.updatedAt }))
        .sort((a, b) => a.version - b.version);
      const other = since.filter((v) => v.conversations.some((c) => c.id !== threadId)).sort((a, b) => a.version - b.version)[0];
      if (other) others.add(videoId);
      videos.push({
        projectId,
        videoId,
        baseVersion,
        userEdits,
        agentOnlyPossible: userEdits.length === 0 && !other,
        reason: other
          ? `video ${videoId} also has changes from another conversation in version ${other.version}; undo those parts by hand`
          : userEdits.length
            ? `video ${videoId} has your own edits since version ${baseVersion}`
            : null,
      });
    }
    return { plan: { videos }, others };
  };
  const plan = async (item: WorkItem): Promise<RevertPlan> => (await inspect(item)).plan;
  const revertTools = deps.openVideo && deps.restoreVersion ? { openVideo: deps.openVideo, restoreVersion: deps.restoreVersion } : null;
  return {
    async facts() {
      const projects = deps.projects();
      if (!projects.length) return [];
      const videos = safe(deps.videos);
      const lines: string[] = [];
      for (const project of projects.slice(0, 20)) {
        const own = videos.filter((v) => v.projectId === project.id).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
        lines.push(`project "${project.name}" (${own.length} videos)`);
        for (const video of own.slice(0, 5)) lines.push(`  video "${path.basename(video.dir)}" last changed ${video.lastActivityAt.slice(0, 10)}`);
      }
      return lines;
    },
    async verifyEvidence(evidence: Evidence, item: WorkItem, since: string) {
      // 证据要属于这条任务（§7.5）：Job 是任务的线程提交的，或者落在任务资源里的视频上；版本同理。
      const itemVideos = new Set(item.resources.flatMap((r) => (r.kind === 'video' || r.kind === 'video-range' ? [r.videoId] : [])));
      const byThread = (record: JobRecord) => !!item.threadId && record.submitter.kind === 'agent' && record.submitter.id === item.threadId;
      const ofItem = (record: JobRecord) => byThread(record) || (!!record.videoId && itemVideos.has(record.videoId));
      switch (evidence.kind) {
        case 'job': {
          const record = job(evidence.jobId);
          if (!record) return `job ${evidence.jobId} not found`;
          if (!ofItem(record)) return `job ${evidence.jobId} was not run by this task's thread or on one of its videos`;
          if (record.state !== 'completed') return `job ${evidence.jobId} is ${record.state}`;
          if (record.attempt !== evidence.attempt) return `job ${evidence.jobId} is on attempt ${record.attempt}`;
          if (record.createdAt < since) return `job ${evidence.jobId} finished before this task started`;
          return null;
        }
        case 'export': {
          const record = job(evidence.exportId);
          if (!record) return `export ${evidence.exportId} not found`;
          if (record.videoId && record.videoId !== evidence.videoId) return 'the export belongs to another video';
          if (!ofItem(record) && !itemVideos.has(evidence.videoId)) return `export ${evidence.exportId} was not made by this task's thread or from one of its videos`;
          if (record.state !== 'completed') return `export ${evidence.exportId} is ${record.state}`;
          if (record.createdAt < since) return 'the export is older than this task';
          return null;
        }
        case 'video-version': {
          const known = safe(deps.videos).some((v) => v.videoId === evidence.videoId && v.projectId === evidence.projectId);
          if (!known) return `video ${evidence.videoId} not found in that project`;
          // 只认视频此刻的最新一版，而且是这条任务开始之后才有的：编号或修订号都要对得上。
          let newest: VideoVersionList['versions'][number] | undefined;
          try {
            newest = (await deps.versions(evidence.videoId)).versions[0];
          } catch {
            return `could not read the versions of video ${evidence.videoId}`;
          }
          if (!newest) return `video ${evidence.videoId} has no versions`;
          const touchedByThread = !!item.threadId && newest.conversations.some((c) => c.id === item.threadId);
          if (!itemVideos.has(evidence.videoId) && !touchedByThread) {
            return `video ${evidence.videoId} is not one of this task's videos and its newest version is not from this task's thread`;
          }
          if (String(newest.version) !== evidence.version && newest.toRevision !== evidence.version) {
            return `video ${evidence.videoId} is at version ${newest.version}, not ${evidence.version}`;
          }
          if (newest.updatedAt < since) return `version ${evidence.version} is older than this task`;
          return null;
        }
        case 'past-date':
          return null;
      }
    },
    async describe(ref: ResourceRef) {
      if (ref.kind === 'video' || ref.kind === 'video-range') {
        const video = safe(deps.videos).find((v) => v.videoId === ref.videoId);
        const project = deps.projects().find((p) => p.id === ref.projectId);
        if (!video) return null;
        return `video "${path.basename(video.dir)}" in project "${project?.name ?? ref.projectId}", last changed ${video.lastActivityAt.slice(0, 10)}`;
      }
      if (ref.kind === 'file') return `file ${path.basename(ref.path)}`;
      return null;
    },
    ...(deps.usage
      ? {
          async channelSpend(conversationIds: ReadonlySet<Id>, since: { day: string; month: string }) {
            const records = await deps.usage!();
            const day: Money[] = [];
            const month: Money[] = [];
            for (const record of records) {
              if (record.cost.kind !== 'reported' || record.at < since.month) continue;
              if (!belongsTo(record, conversationIds, job)) continue;
              const money = { amount: record.cost.amount, currency: record.cost.currency };
              month.push(money);
              if (record.at >= since.day) day.push(money);
            }
            return { day: sumMoney(day), month: sumMoney(month) };
          },
        }
      : {}),
    ...(revertTools
      ? {
          revertPlan: plan,
          async revert(item: WorkItem, keepUserEdits: boolean) {
            const { plan: current, others } = await inspect(item);
            const restored: { videoId: Id; version: number }[] = [];
            for (const video of current.videos) {
              if (!video.baseVersion) continue;
              // 别的会话也改过的视频不整体撤：会连别人的改动一起撤掉。
              if (others.has(video.videoId)) continue;
              if (keepUserEdits && !video.agentOnlyPossible) continue;
              const version = await revertTools.restoreVersion(video.videoId, video.baseVersion, true);
              if (version !== null) restored.push({ videoId: video.videoId, version });
            }
            return restored;
          },
          async revertThread(item: WorkItem, to: 'before-thread' | number) {
            if (!item.threadId) return [];
            const videos = (await plan(item)).videos.filter((v) => v.baseVersion > 0);
            // 线程自己撤：有用户或别的会话的改动时不动，由用户在任务上决定。
            const mixed = videos.find((v) => !v.agentOnlyPossible);
            if (mixed) throw new Error(mixed.reason ?? `video ${mixed.videoId} has edits by someone else`);
            if (typeof to === 'number' && videos.length !== 1) throw new Error('a version number only works when the task changed exactly one video');
            return videos.map((video) =>
              to === 'before-thread' ? { videoId: video.videoId, version: video.baseVersion, before: true } : { videoId: video.videoId, version: to, before: false },
            );
          },
        }
      : {}),
    async hungJob(jobIds: readonly Id[]) {
      for (const id of jobIds) {
        const record = job(id);
        if (record && (record.state === 'needs-reconciliation' || record.state === 'interrupted')) return record.kind;
      }
      return null;
    },
  };
}

/** 记录属于这组会话：直接记了会话，或是会话里的智能体交的 Job。 */
function belongsTo(record: UsageRecord, ids: ReadonlySet<Id>, job: (jobId: Id) => JobRecord | undefined): boolean {
  const conversationId = record.ref?.conversationId;
  if (conversationId) return ids.has(conversationId);
  const jobId = record.ref?.jobId;
  if (!jobId) return false;
  const submitter = job(jobId)?.submitter;
  return submitter?.kind === 'agent' && ids.has(submitter.id);
}

function safe<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}
