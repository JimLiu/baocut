import { describe, expect, it } from 'vitest';
import type { ExportJobInfo, GeneratedOutput, JobRecord } from '@baocut/protocol';
import { job } from '../testing/task-records.ts';
import {
  cancelPending,
  cancelledLine,
  exportButtonLabel,
  exportDoneLine,
  exportOutputs,
  exportPhaseLabel,
  exportProgressLine,
  exportSpeedParts,
  exportTimeLeft,
  exportTitle,
  exportView,
  latestLiveExport,
  tabOfKind,
} from './export-job.ts';

const info = (settings: ExportJobInfo['settings']): ExportJobInfo => ({
  settings,
  snapshotArtifactId: 'snap',
  videoRevision: '3',
  sequenceId: 'seq',
  destination: { dir: '/p/exports', files: ['访谈.mp4'], overwrite: false },
});

const exportJob = (patch: Partial<JobRecord> & Pick<JobRecord, 'jobId'>): JobRecord =>
  job({ kind: 'export', phase: 'generating', modelId: 'export:video', export: info({ kind: 'video', format: 'mp4' }), ...patch });

const output = (path: string, byteLength: number, media: GeneratedOutput['media']): GeneratedOutput => ({
  artifactId: `sha256:${path}`,
  mediaType: 'video/mp4',
  byteLength,
  assetId: null,
  media,
  path,
});

describe('导出任务', () => {
  it('取这个视频最近一条在跑的导出，别的视频、别的种类、结束了的都不算', () => {
    const jobs = [
      exportJob({ jobId: 'old', createdAt: '2026-10-01T09:00:00Z' }),
      exportJob({ jobId: 'new', createdAt: '2026-10-01T10:00:00Z', state: 'queued' }),
      exportJob({ jobId: 'done', createdAt: '2026-10-01T11:00:00Z', state: 'completed', endedAt: '2026-10-01T11:01:00Z' }),
      exportJob({ jobId: 'other', createdAt: '2026-10-01T12:00:00Z', videoId: 'v2' }),
      job({ jobId: 'tx', createdAt: '2026-10-01T13:00:00Z' }),
    ];
    expect(latestLiveExport(jobs, 'v1')?.jobId).toBe('new');
    expect(latestLiveExport([], 'v1')).toBeNull();
  });

  it('顶栏按钮：百分比只在有总量时念', () => {
    expect(exportButtonLabel(null)).toBe('导出');
    expect(exportButtonLabel(exportJob({ jobId: 'j', state: 'queued' }))).toBe('导出排队中');
    expect(exportButtonLabel(exportJob({ jobId: 'j', progress: { done: 31, total: 100, unit: 'frames' } }))).toBe('导出中 · 31%');
    expect(exportButtonLabel(exportJob({ jobId: 'j', progress: { done: 3, total: null, unit: 'outputs' } }))).toBe('导出中…');
  });

  it('视图：在跑、完成、取消、中断、失败', () => {
    expect(exportView(exportJob({ jobId: 'j' }))).toBe('run');
    expect(exportView(exportJob({ jobId: 'j', state: 'interrupted', endedAt: null }))).toBe('run');
    expect(exportView(exportJob({ jobId: 'j', state: 'interrupted', endedAt: '2026-10-01T09:05:00Z' }))).toBe('interrupted');
    expect(exportView(exportJob({ jobId: 'j', state: 'completed' }))).toBe('done');
    expect(exportView(exportJob({ jobId: 'j', state: 'cancelled' }))).toBe('cancelled');
    expect(exportView(exportJob({ jobId: 'j', state: 'failed' }))).toBe('failed');
  });

  it('标题、所在页与阶段按种类说', () => {
    expect(exportTitle({ kind: 'video', format: 'mp4' })).toBe('导出视频 · MP4');
    expect(exportTitle({ kind: 'transcript', format: 'md' })).toBe('导出文稿 · Markdown');
    expect(exportTitle({ kind: 'portable' })).toBe('导出便携包');
    expect(exportTitle({ kind: 'project', format: 'xmeml' })).toBe('导出工程 · FCP7 XML');
    expect(tabOfKind('portable')).toBe('project');
    expect(tabOfKind('subtitles')).toBe('subtitles');
    expect(exportPhaseLabel(exportJob({ jobId: 'j' }))).toBe('编码中');
    expect(exportPhaseLabel(exportJob({ jobId: 'j', export: info({ kind: 'audio', format: 'mp3' }) }))).toBe('混音中');
    expect(exportPhaseLabel(exportJob({ jobId: 'j', phase: 'validating' }))).toBe('校验结果');
    expect(exportPhaseLabel(exportJob({ jobId: 'j', phase: 'publishing' }))).toBe('保存文件');
    expect(exportPhaseLabel(exportJob({ jobId: 'j', state: 'queued', phase: 'queued' }))).toBe('排队中');
    const wait = { reason: 'resources' as const, dimensions: ['memory' as const], detail: '等待资源：内存不够', since: '2026-10-03T00:00:00.000Z' };
    expect(exportPhaseLabel(exportJob({ jobId: 'j', state: 'queued', phase: 'queued', wait }))).toBe('等待资源：内存不够');
  });

  it('进度只写 Runtime 报的事实', () => {
    expect(exportProgressLine(exportJob({ jobId: 'j', progress: { done: 1200, total: 3600, unit: 'frames' } }))).toBe('已画 1,200 / 3,600 帧');
    expect(exportProgressLine(exportJob({ jobId: 'j', progress: { done: 40, total: 180, unit: 'seconds' } }))).toBe('已处理 0:40 / 3:00');
    expect(exportProgressLine(exportJob({ jobId: 'j', progress: { done: 1, total: 3, unit: 'outputs' } }))).toBe('已写 1 / 3 个文件');
    expect(exportProgressLine(exportJob({ jobId: 'j', progress: { done: 120 * 1024 ** 2, total: 1.2 * 1024 ** 3, unit: 'bytes' } }))).toBe('已打包 120 MB / 1.2 GB');
    expect(exportProgressLine(exportJob({ jobId: 'j', progress: null }))).toBeNull();
  });

  it('速度与剩余时间：分:秒，超过一小时写时；算不出时不写', () => {
    expect(exportSpeedParts({ rate: 58.4, fps: 58.4, secondsLeft: 83.2 })).toEqual(['58 fps', '剩余 1:24']);
    expect(exportSpeedParts({ rate: 2.46, fps: 2.46, secondsLeft: 3723 })).toEqual(['2.5 fps', '剩余 1:02:03']);
    expect(exportSpeedParts({ rate: 10, fps: null, secondsLeft: 10 })).toEqual(['剩余 0:10']);
    expect(exportSpeedParts(null)).toEqual([]);
    expect(exportTimeLeft({ rate: 58.4, fps: 58.4, secondsLeft: 3723 })).toBe('剩余 1:02:03');
    expect(exportTimeLeft(null)).toBeNull();
  });

  it('输出读实际路径：重名时 Runtime 加过的序号照实显示', () => {
    const done = exportJob({
      jobId: 'j',
      state: 'completed',
      result: {
        documentId: null,
        artifactId: 'a',
        outputs: [output('/p/exports/访谈 (2).mp4', 84 * 1024 ** 2, { kind: 'video', durationSec: 206, width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac' })],
      },
    });
    expect(exportOutputs(done)).toEqual([{ key: 'sha256:/p/exports/访谈 (2).mp4:0', name: '访谈 (2).mp4', path: '/p/exports/访谈 (2).mp4', meta: '1920×1080 · 3:26 · 84 MB' }]);
    expect(exportDoneLine(done)).toBe('访谈 (2).mp4 · 84 MB');
  });

  it('取消：没写完的删掉；点了取消还在跑时算「正在取消」', () => {
    expect(cancelledLine(exportJob({ jobId: 'j', state: 'cancelled', result: null }))).toBe('没写完的文件已删掉 · 视频本身不受影响');
    const cancellation = { requestedAt: '2026-10-01T09:01:00Z', localStoppedAt: null, remote: 'not-applicable' as const, cost: 'none' as const };
    expect(cancelPending(exportJob({ jobId: 'j', cancellation }))).toBe(true);
    expect(cancelPending(exportJob({ jobId: 'j', cancellation, state: 'completed', endedAt: '2026-10-01T09:02:00Z' }))).toBe(false);
  });
});
