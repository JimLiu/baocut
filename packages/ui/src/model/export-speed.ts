import type { JobRecord } from '@baocut/protocol';

/**
 * 导出的速度与预计剩余时间（产品设计 §8.3）：Runtime 不报速度，界面按任务记录推算。每条 `job.updated` 带着这次进度的数字与
 * Runtime 记下它的时刻（`updatedAt`，毫秒），取最近几秒里最早与最新的两个样本算速度，剩余量除以速度就是剩余时间。
 *
 * - 只看渲染阶段（`generating`：成片画帧、音频混音……）带总量的进度；下载字体、保存文件时不写。换了单位或总量，
 *   或者数字往回走（重试从头来），样本从头记。
 * - 样本少于一秒、这段时间里没有进展时算不出速度，返回 null，界面不写——不编造。
 */

/** 一个进度样本：Runtime 记下它的时刻（毫秒）与已完成量。 */
export interface SpeedSample {
  at: number;
  done: number;
}

/** 一次导出在渲染阶段的样本；`key` 是进度的单位与总量，变了就从头记。 */
export interface SpeedTrack {
  key: string;
  samples: readonly SpeedSample[];
}

export interface ExportSpeed {
  /** 每秒完成的量（按进度单位：帧、秒、字节……）。 */
  rate: number;
  /** 进度单位是帧时的 fps；别的单位 null。 */
  fps: number | null;
  /** 预计还要多少秒。 */
  secondsLeft: number;
}

/** 速度看最近这么久（毫秒）：够平滑掉单个样本的抖动，又跟得上编码速度的变化。 */
export const SPEED_WINDOW_MS = 5000;
/** 样本跨度不到这么久（毫秒）时不算速度。 */
const MIN_SPAN_MS = 1000;

function trackKey(job: Pick<JobRecord, 'kind' | 'state' | 'phase' | 'progress'>): string | null {
  const p = job.progress;
  if (job.kind !== 'export' || job.state !== 'running' || job.phase !== 'generating' || !p || p.total == null || p.total <= 0) return null;
  return `${p.unit}|${p.total}`;
}

/** 用一条新的任务记录更新它的样本；不在渲染、没有总量的导出返回 undefined（丢掉旧样本）。 */
export function trackSpeed(prev: SpeedTrack | undefined, job: Pick<JobRecord, 'kind' | 'state' | 'phase' | 'progress' | 'updatedAt'>): SpeedTrack | undefined {
  const key = trackKey(job);
  const at = Date.parse(job.updatedAt);
  if (!key || !Number.isFinite(at)) return undefined;
  const sample = { at, done: job.progress!.done };
  const last = prev?.key === key ? prev.samples[prev.samples.length - 1] : undefined;
  if (!last || sample.done < last.done || sample.at < last.at) return { key, samples: [sample] };
  if (sample.at === last.at && sample.done === last.done) return prev;
  const samples = [...prev!.samples, sample];
  // 留住窗口起点之前的最后一个样本，速度总按满窗口算。
  while (samples.length > 2 && samples[1]!.at <= at - SPEED_WINDOW_MS) samples.shift();
  return { key, samples };
}

/** 按样本算速度与剩余时间；算不出时 null。 */
export function exportSpeed(track: SpeedTrack | undefined, job: Pick<JobRecord, 'kind' | 'state' | 'phase' | 'progress'>): ExportSpeed | null {
  const key = trackKey(job);
  if (!track || !key || track.key !== key) return null;
  const first = track.samples[0]!;
  const last = track.samples[track.samples.length - 1]!;
  const span = last.at - first.at;
  if (span < MIN_SPAN_MS || last.done <= first.done) return null;
  const rate = ((last.done - first.done) * 1000) / span;
  const p = job.progress!;
  return {
    rate,
    fps: p.unit === 'frames' ? rate : null,
    secondsLeft: Math.max(0, (p.total! - p.done) / rate),
  };
}
