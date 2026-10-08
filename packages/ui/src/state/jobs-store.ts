import { create } from 'zustand';
import { applyJobsEvent } from '@baocut/client';
import type { Id, JobLiveSegment, JobRecord, JobsEvent, JobsSnapshot } from '@baocut/protocol';
import { exportSpeed, trackSpeed, type ExportSpeed, type SpeedTrack } from '../model/export-speed.ts';
import { holdSegments } from '../model/live-transcript.ts';
import { jobLive } from '../model/task-list.ts';

type Segments = Readonly<Record<Id, readonly JobLiveSegment[]>>;
type Speeds = Readonly<Record<Id, SpeedTrack>>;

/** 计算任务（Job）镜像：转写、配音、生成这些长活（架构设计 §7）。后台任务页、rail 角标与任务胶囊共用。 */
export interface JobsStore {
  ready: boolean;
  jobs: JobRecord[];
  /** 还在跑的转录任务到目前为止识别出的段落，按 `jobId`（架构设计 §6.6「实时文稿」）。 */
  liveSegments: Segments;
  /** 转写 Job 已完成、客户端丢掉了实时段落，但流程还在建字幕层：先留着，字幕轨出来之前临时行与文稿接着画（`holdSegments`）。 */
  heldSegments: Segments;
  /** 在跑的导出最近几秒的进度样本，按 `jobId`：导出窗口与后台任务据此写速度与剩余时间（`exportSpeed`）。 */
  speeds: Speeds;
  replace(snapshot: JobsSnapshot): void;
  apply(event: JobsEvent): void;
}

const NONE: Segments = Object.freeze({});
const NO_SPEEDS: Speeds = Object.freeze({});
const EMPTY: readonly JobLiveSegment[] = Object.freeze([]);

/** 按新到的任务记录更新进度样本；不在跑的导出丢掉。没有变化时引用不变。 */
function trackSpeeds(speeds: Speeds, jobs: readonly JobRecord[]): Speeds {
  let next: Record<Id, SpeedTrack> | null = null;
  for (const job of jobs) {
    const prev = speeds[job.jobId];
    const track = trackSpeed(prev, job);
    if (track === prev) continue;
    next ??= { ...speeds };
    if (track) next[job.jobId] = track;
    else delete next[job.jobId];
  }
  return next ?? speeds;
}

export const useJobs = create<JobsStore>()((set) => ({
  ready: false,
  jobs: [],
  liveSegments: NONE,
  heldSegments: NONE,
  speeds: NO_SPEEDS,
  replace: (snapshot) =>
    set((s) => {
      const liveSegments = snapshot.liveSegments ?? NONE;
      // 整份替换：不在快照里的任务的样本一起丢掉。
      const ids = new Set(snapshot.jobs.map((j) => j.jobId));
      const kept = Object.fromEntries(Object.entries(s.speeds).filter(([id]) => ids.has(id)));
      return {
        ready: true,
        jobs: snapshot.jobs,
        liveSegments,
        heldSegments: holdSegments(s.liveSegments, liveSegments, s.heldSegments, snapshot.jobs),
        speeds: trackSpeeds(kept, snapshot.jobs),
      };
    }),
  // 只把快照的两项交给 reducer、两项都写回：reducer 删掉某个任务的段落时不能被浅合并留下旧的。
  apply: (event) =>
    set((s) => {
      const next = applyJobsEvent({ jobs: s.jobs, liveSegments: s.liveSegments as Record<Id, JobLiveSegment[]> }, event);
      const liveSegments = next.liveSegments ?? NONE;
      const speeds = event.type === 'job.updated' ? trackSpeeds(s.speeds, [event.job]) : s.speeds;
      return { jobs: next.jobs, liveSegments, heldSegments: holdSegments(s.liveSegments, liveSegments, s.heldSegments, next.jobs), speeds };
    }),
}));

/** 还没结束的任务（含崩溃后正在自动重跑的，见 `jobLive`）。 */
export function isJobLive(job: JobRecord): boolean {
  return jobLive(job);
}

/** 一个转写任务到目前为止识别出的段落（含刚结束、还留着的）；没有时是同一个空数组，不变时引用不变。 */
export function useLiveSegments(jobId: Id | null | undefined): readonly JobLiveSegment[] {
  return useJobs((s) => (jobId ? (s.liveSegments[jobId] ?? s.heldSegments[jobId] ?? EMPTY) : EMPTY));
}

/** 一次导出的速度与预计剩余时间；不是在跑的导出、还算不出时 null。 */
export function useExportSpeed(jobId: Id | null | undefined): ExportSpeed | null {
  const track = useJobs((s) => (jobId ? s.speeds[jobId] : undefined));
  const job = useJobs((s) => (jobId && s.speeds[jobId] ? s.jobs.find((j) => j.jobId === jobId) : undefined));
  return track && job ? exportSpeed(track, job) : null;
}
