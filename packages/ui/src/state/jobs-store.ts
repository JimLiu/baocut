import { create } from 'zustand';
import { applyJobsEvent } from '@baocut/client';
import type { Id, JobLiveSegment, JobRecord, JobsEvent, JobsSnapshot } from '@baocut/protocol';
import { holdSegments } from '../model/live-transcript.ts';
import { jobLive } from '../model/task-list.ts';

type Segments = Readonly<Record<Id, readonly JobLiveSegment[]>>;

/** 计算任务（Job）镜像：转写、配音、生成这些长活（架构设计 §7）。后台任务页、rail 角标与任务胶囊共用。 */
export interface JobsStore {
  ready: boolean;
  jobs: JobRecord[];
  /** 还在跑的转录任务到目前为止识别出的段落，按 `jobId`（架构设计 §6.6「实时文稿」）。 */
  liveSegments: Segments;
  /** 转写 Job 已完成、客户端丢掉了实时段落，但流程还在建字幕层：先留着，字幕轨出来之前临时行与文稿接着画（`holdSegments`）。 */
  heldSegments: Segments;
  replace(snapshot: JobsSnapshot): void;
  apply(event: JobsEvent): void;
}

const NONE: Segments = Object.freeze({});
const EMPTY: readonly JobLiveSegment[] = Object.freeze([]);

export const useJobs = create<JobsStore>()((set) => ({
  ready: false,
  jobs: [],
  liveSegments: NONE,
  heldSegments: NONE,
  replace: (snapshot) =>
    set((s) => {
      const liveSegments = snapshot.liveSegments ?? NONE;
      return {
        ready: true,
        jobs: snapshot.jobs,
        liveSegments,
        heldSegments: holdSegments(s.liveSegments, liveSegments, s.heldSegments, snapshot.jobs),
      };
    }),
  // 只把快照的两项交给 reducer、两项都写回：reducer 删掉某个任务的段落时不能被浅合并留下旧的。
  apply: (event) =>
    set((s) => {
      const next = applyJobsEvent({ jobs: s.jobs, liveSegments: s.liveSegments as Record<Id, JobLiveSegment[]> }, event);
      const liveSegments = next.liveSegments ?? NONE;
      return { jobs: next.jobs, liveSegments, heldSegments: holdSegments(s.liveSegments, liveSegments, s.heldSegments, next.jobs) };
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
