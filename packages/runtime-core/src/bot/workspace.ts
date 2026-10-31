// i18n-ignore-file: facts and evidence reasons for the model (English)
import path from 'node:path';
import type { Evidence, Id, JobRecord, Money, Project, ResourceRef, UsageRecord, VideoVersionList, WorkItem } from '@baocut/protocol';
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
}

export function runtimeWorkspace(deps: RuntimeWorkspaceDeps): BotWorkspace {
  const job = (jobId: Id): JobRecord | undefined => {
    try {
      return deps.job(jobId);
    } catch {
      return undefined;
    }
  };
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
    async verifyEvidence(evidence: Evidence, _item: WorkItem, since: string) {
      switch (evidence.kind) {
        case 'job': {
          const record = job(evidence.jobId);
          if (!record) return `job ${evidence.jobId} not found`;
          if (record.state !== 'completed') return `job ${evidence.jobId} is ${record.state}`;
          if (record.attempt !== evidence.attempt) return `job ${evidence.jobId} is on attempt ${record.attempt}`;
          if (record.createdAt < since) return `job ${evidence.jobId} finished before this task started`;
          return null;
        }
        case 'export': {
          const record = job(evidence.exportId);
          if (!record) return `export ${evidence.exportId} not found`;
          if (record.state !== 'completed') return `export ${evidence.exportId} is ${record.state}`;
          if (record.videoId && record.videoId !== evidence.videoId) return 'the export belongs to another video';
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
