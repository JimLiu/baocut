import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@baocut/protocol';
import { job, task } from '../testing/task-records.ts';
import { jobRow, agentRow, type TaskContext, type TaskRow } from './task-list.ts';
import { CARD_MAX, pillCard, pillFace, pillLabel, pillList, pillRow } from './task-pill.ts';

const ctx: TaskContext = { projects: [], conversations: [{ id: 'c2', projectId: null, activity: 'awaiting-approval' }] };
const NOW = Date.parse('2026-10-01T10:00:00Z');
const at = (minute: number) => `2026-10-01T09:${String(minute).padStart(2, '0')}:00Z`;

/** 一条 Job 行；`videoId` 不给时属于打开的视频 v1。 */
const jobAt = (jobId: string, minute: number, patch: Partial<JobRecord> = {}) =>
  jobRow(job({ jobId, startedAt: at(minute), createdAt: at(minute), ...patch }), ctx);

const ids = (rows: TaskRow[]) => rows.map((r) => r.id);

describe('pillList', () => {
  it('只收活着的：在跑、排队、等批准；结束了的不进表', () => {
    const rows = [
      jobAt('run', 1),
      jobAt('queue', 2, { state: 'queued', startedAt: null }),
      jobAt('done', 3, { state: 'completed' }),
      agentRow(task({ taskId: 'wait', conversationId: 'c2', startedAt: at(4) }), ctx),
      agentRow(task({ taskId: 'over', status: 'stopped', startedAt: at(5) }), ctx),
    ];
    expect(ids(pillList(rows))).toEqual(['wait', 'run', 'queue']);
  });

  it('排序：正在看的 → 这个视频的 → 其余在跑的 → 排队的；同档后起的在前', () => {
    const rows = [
      jobAt('other-old', 1, { videoId: 'v2' }),
      jobAt('other-new', 5, { videoId: 'v2' }),
      jobAt('other-queued', 9, { videoId: 'v2', state: 'queued', startedAt: null }),
      jobAt('mine-old', 2),
      jobAt('mine-new', 3),
      jobAt('focus', 0, { videoId: 'v3' }),
    ];
    expect(ids(pillList(rows, { videoId: 'v1', focusId: 'focus' }))).toEqual([
      'focus',
      'mine-new',
      'mine-old',
      'other-new',
      'other-old',
      'other-queued',
    ]);
  });

  it('这个视频的导出不进表；别的视频的导出照常', () => {
    const mineExport: TaskRow = { ...jobAt('mine-export', 1), kind: 'export' };
    const otherExport: TaskRow = { ...jobAt('other-export', 2, { videoId: 'v2' }), kind: 'export' };
    expect(ids(pillList([mineExport, otherExport, jobAt('mine', 3)], { videoId: 'v1' }))).toEqual(['mine', 'other-export']);
  });

  it('mineOnly 只报这个视频的；Agent 任务没有视频，不进视频栏的胶囊；没打开视频时什么都不报', () => {
    const rows = [jobAt('mine', 1), jobAt('other', 2, { videoId: 'v2' }), agentRow(task({ taskId: 'agent', startedAt: at(3) }), ctx)];
    expect(ids(pillList(rows, { videoId: 'v1', mineOnly: true }))).toEqual(['mine']);
    expect(ids(pillList(rows, { videoId: null, mineOnly: true }))).toEqual([]);
  });
});

describe('pillFace / pillLabel', () => {
  it('「+N」恒等于卡片里其余的行数；表空时不画', () => {
    const list = [jobAt('a', 3, { progress: { done: 37, total: 100, unit: 'seconds' } }), jobAt('b', 2), jobAt('c', 1)];
    const face = pillFace(list)!;
    expect(face.label).toBe('转录 · 37%');
    expect(face.more).toBe(2);
    expect(face.more).toBe(pillCard(list, 'v1', NOW).rows.length - 1);
    expect(pillFace([])).toBeNull();
  });

  it('不确定进度只念种类；排队念「排队中」；等批准念「需要你确认」', () => {
    expect(pillLabel(jobAt('a', 1))).toBe('转录');
    expect(pillLabel(jobAt('b', 1, { state: 'queued' }))).toBe('转录 · 排队中');
    expect(pillLabel(agentRow(task({ taskId: 'w', conversationId: 'c2' }), ctx))).toBe('Agent 任务 · 需要你确认');
  });
});

describe('pillRow / pillCard', () => {
  it('一行：标题、阶段 · 在哪、开始时间 · 这个视频、进度', () => {
    const row = pillRow(jobAt('a', 15, { progress: { done: 1, total: 4, unit: 'segments' } }), 'v1', NOW);
    expect(row).toEqual({
      id: 'a',
      title: '转录',
      detail: '识别中 · whisper-large-v3 · 本机',
      meta: '45 分钟前开始 · 这个视频',
      state: '25%',
      progress: 25,
      cancellable: true,
    });
  });

  it('刚起的念「刚开始」；排队的不写开始时间、不画进度条；不确定进度转圈', () => {
    const fresh = pillRow(jobRow(job({ jobId: 'f', startedAt: '2026-10-01T09:59:40Z' }), ctx), null, NOW);
    expect(fresh.meta).toBe('刚开始');
    expect(fresh.progress).toBe('indet');
    const queued = pillRow(jobAt('q', 1, { state: 'queued', videoId: 'v2' }), 'v1', NOW);
    expect(queued.meta).toBe('');
    expect(queued.progress).toBeNull();
  });

  it(`多条时是计数头、最多 ${CARD_MAX} 行与溢出数；单条时没有计数头`, () => {
    const list = Array.from({ length: 7 }, (_, i) => jobAt(`j${i}`, i));
    const card = pillCard(list, 'v1', NOW);
    expect(card).toMatchObject({ multi: true, title: '7 个后台任务', overflow: 2 });
    expect(card.rows).toHaveLength(CARD_MAX);
    expect(pillCard(list.slice(0, 1), 'v1', NOW)).toMatchObject({ multi: false, title: null, overflow: 0 });
  });
});
