import { describe, expect, it } from 'vitest';
import { chapter, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { chapterPieces, clampCustom, clipPieces, initialRange, mergeSegments, parseRangeTime, rangePlan, rangeScope, type RangeState } from './export-range.ts';

// 60 秒的片子：三段视频（0–20、20–40、45–60），中间空了 5 秒；三章（0、20、45 秒）。
const seq = sequence(
  [track('v1', 'visual', 1), track('v2', 'visual', 2, { visible: false })],
  [
    videoItem('c3', 'v1', 1350, 450),
    videoItem('c1', 'v1', 0, 600),
    videoItem('c2', 'v1', 600, 600),
    videoItem('off', 'v1', 1200, 150, { enabled: false }),
    videoItem('hidden', 'v2', 0, 300),
  ],
  { markers: [chapter('m1', 0, '开场'), chapter('m2', 600, '正文'), chapter('m3', 1350, '  ')] },
);
const assets = { asset_v: { id: 'asset_v', kind: 'video' as const, name: 'clip.mp4', currentRevision: '1', revisions: {} } };
const chapters = chapterPieces(seq);
const clips = clipPieces(seq, assets, {});
const state = (patch: Partial<RangeState>): RangeState => ({ mode: 'all', chapterIds: [], clipIds: [], custom: { start: 0, end: 60 }, ...patch });

describe('导出范围：章节与片段', () => {
  it('章节到下一章为止，最后一章到片尾；没名字的写「第 N 章」', () => {
    expect(chapters.map((c) => [c.id, c.label, c.start, c.end])).toEqual([
      ['m1', '开场', 0, 20],
      ['m2', '正文', 20, 45],
      ['m3', '第 3 章', 45, 60],
    ]);
  });

  it('章节标记自己带时长时到时长为止', () => {
    const own = chapterPieces(sequence([track('v1', 'visual', 1)], [videoItem('c', 'v1', 0, 1800)], { markers: [chapter('m', 300, '高光', { durationFrames: 150 })] }));
    expect(own.map((c) => [c.start, c.end])).toEqual([[10, 15]]);
  });

  it('片段只算启用的、轨道没隐藏的视频实例，按起点编号', () => {
    expect(clips.map((c) => [c.id, c.label, c.name, c.start, c.end])).toEqual([
      ['c1', '片段 1', 'clip.mp4', 0, 20],
      ['c2', '片段 2', 'clip.mp4', 20, 40],
      ['c3', '片段 3', 'clip.mp4', 45, 60],
    ]);
  });
});

describe('导出范围：落成请求', () => {
  it('整片不带 range', () => {
    const plan = rangePlan(state({}), chapters, clips, 60);
    expect(plan.whole).toBe(true);
    expect(plan.label).toBe('整片 1:00');
    expect(rangeScope(plan)).toEqual({});
  });

  it('相邻的几段拼成一段，发一个 range', () => {
    const plan = rangePlan(state({ mode: 'clips', clipIds: ['c2', 'c1'] }), chapters, clips, 60);
    expect(plan.segments).toEqual([{ start: 0, end: 40 }]);
    expect(plan.label).toBe('2 段连成一段 · 0:40');
    expect(rangeScope(plan)).toEqual({ range: { start: 0, end: 40 } });
  });

  it('不相邻的几段各出一份，发 ranges', () => {
    const plan = rangePlan(state({ mode: 'clips', clipIds: ['c1', 'c3'] }), chapters, clips, 60);
    expect(plan.label).toBe('2 段 · 共 0:35');
    expect(rangeScope(plan)).toEqual({ ranges: [{ start: 0, end: 20 }, { start: 45, end: 60 }] });
  });

  it('章节一段写章名', () => {
    const plan = rangePlan(state({ mode: 'chapters', chapterIds: ['m2'] }), chapters, clips, 60);
    expect(plan.label).toBe('正文 · 0:25');
    expect(rangeScope(plan)).toEqual({ range: { start: 20, end: 45 } });
  });

  it('一段都没勾时是空的，不带 range', () => {
    const plan = rangePlan(state({ mode: 'chapters' }), chapters, clips, 60);
    expect(plan.empty).toBe(true);
    expect(rangeScope(plan)).toEqual({});
  });

  it('自定义夹进片长，至少半秒', () => {
    expect(clampCustom(-3, 80, 60)).toEqual({ start: 0, end: 60 });
    expect(clampCustom(30, 30.1, 60)).toEqual({ start: 30, end: 30.5 });
    expect(clampCustom(59.9, 60, 60)).toEqual({ start: 59.5, end: 60 });
    const plan = rangePlan(state({ mode: 'custom', custom: { start: 45, end: 78.25 } }), chapters, clips, 60);
    expect(plan.label).toBe('0:45.0–1:00.0');
    expect(rangeScope(plan)).toEqual({ range: { start: 45, end: 60 } });
  });

  it('合并时按起点排、重叠的也并起来', () => {
    expect(mergeSegments([{ start: 10, end: 20 }, { start: 0, end: 12 }, { start: 30, end: 31 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 31 },
    ]);
  });

  it('时间码输入：秒数或 m:ss.d', () => {
    expect(parseRangeTime('1:05.3')).toBeCloseTo(65.3);
    expect(parseRangeTime('12')).toBe(12);
    expect(parseRangeTime('abc')).toBeNull();
  });

  it('打开时预先勾好播放头所在的章节，片段优先勾选中的', () => {
    const init = initialRange(chapters, clips, 25, ['c3'], 60);
    expect(init).toEqual({ mode: 'all', chapterIds: ['m2'], clipIds: ['c3'], custom: { start: 0, end: 60 } });
    expect(initialRange(chapters, clips, 25, [], 60).clipIds).toEqual(['c2']);
    expect(initialRange([], [], 42, [], 60).clipIds).toEqual([]);
  });
});
