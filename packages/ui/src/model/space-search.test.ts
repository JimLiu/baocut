import { describe, expect, it } from 'vitest';
import type { SpaceEntry, SpaceSearchHit } from '@baocut/protocol';
import {
  ANY_HIT,
  collectSpeakers,
  exactSpeaker,
  groupHits,
  hitChip,
  hitTarget,
  hitWhere,
  planGroupRows,
  SEARCH_LIMIT,
  searchNote,
  searchRequest,
  seekSeconds,
  snippetParts,
  speakerOptions,
} from './space-search.ts';

const video = (id: string, videoId: string, patch: Partial<SpaceEntry> = {}): SpaceEntry => ({
  id,
  kind: 'video',
  name: id,
  fileName: id,
  source: { projectId: 'p1', conversationId: null },
  relPath: `${id}`,
  size: 0,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  status: null,
  ref: { videoId },
  user: { favorite: false, displayName: null, trashedAt: null },
  ...patch,
});

describe('命中片段', () => {
  it('按位置切开，越界与重叠的收拢', () => {
    expect(snippetParts('今天讲剪辑和字幕', [[2, 4]])).toEqual([
      { text: '今天', hit: false },
      { text: '讲剪', hit: true },
      { text: '辑和字幕', hit: false },
    ]);
    expect(snippetParts('abcdef', [[3, 9], [0, 2], [1, 3]])).toEqual([{ text: 'abcdef', hit: true }]);
    expect(snippetParts('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('打开命中', () => {
  it('优先用条目；条目在回收站里时打不开；只有序列时间能直接跳', () => {
    const entries = [video('v1', 'vid1'), video('v2', 'vid2', { user: { favorite: false, displayName: null, trashedAt: '2026-10-01T00:00:00.000Z' } })];
    expect(hitTarget({ entryId: 'v1', videoId: 'vid1' }, entries)).toEqual({ projectId: 'p1', path: 'v1' });
    expect(hitTarget({ entryId: null, videoId: 'vid1' }, entries)).toEqual({ projectId: 'p1', path: 'v1' });
    expect(hitTarget({ entryId: 'v2', videoId: 'vid2' }, entries)).toBeNull();
    expect(hitTarget({ entryId: null, videoId: 'gone' }, entries)).toBeNull();
    expect(seekSeconds({ time: { clock: 'sequence', start: 12.5, end: 13 } })).toBe(12.5);
    expect(seekSeconds({ time: { clock: 'source', start: 12.5, end: 13 } })).toBeNull();
  });

  it('结果不全时说明', () => {
    expect(searchNote({ complete: true, pendingVideos: 0, truncated: false, hits: [] })).toBeNull();
    expect(searchNote({ complete: false, pendingVideos: 2, truncated: true, hits: new Array(50) })).toBe(
      '还有 2 个视频的内容索引没有更新完，结果可能缺视频或是旧版本的；命中太多，只列出前 50 条。',
    );
  });
});

const hit = (videoId: string, start: number, patch: Partial<SpaceSearchHit> = {}): SpaceSearchHit => ({
  videoId,
  videoName: `视频 ${videoId}`,
  entryId: null,
  projectId: null,
  documentId: 'd1',
  documentKind: 'speech',
  language: 'zh',
  time: { clock: 'sequence', start, end: start + 1 },
  snippet: '剪辑',
  highlights: [[0, 2]],
  speaker: null,
  indexedRevision: 'r1',
  ...patch,
});

describe('过滤与分组', () => {
  it('请求：全部种类不传 kinds，不限说话人不传 speaker；项目照旧', () => {
    expect(searchRequest('剪辑', null, ANY_HIT)).toEqual({ query: '剪辑', limit: SEARCH_LIMIT });
    expect(searchRequest('剪辑', 'none', { kind: 'translation', speaker: '宝玉' })).toEqual({
      query: '剪辑',
      limit: SEARCH_LIMIT,
      projectId: null,
      kinds: ['translation'],
      speaker: '宝玉',
    });
    expect(searchRequest('剪辑', 'p1', { kind: 'all', speaker: '' })).toEqual({ query: '剪辑', limit: SEARCH_LIMIT, projectId: 'p1' });
  });

  it('说话人按名字整串对上（Runtime 是「含有」）；选项并进见过的、带上已选的', () => {
    const hits = [hit('a', 1, { speaker: '宝玉' }), hit('a', 2, { speaker: '宝玉的嘉宾' }), hit('b', 3)];
    expect(exactSpeaker(hits, '宝玉').map((h) => h.time.start)).toEqual([1]);
    expect(exactSpeaker(hits, null)).toHaveLength(3);
    const seen = collectSpeakers([], hits);
    expect(seen).toEqual(['宝玉', '宝玉的嘉宾']);
    expect(collectSpeakers(seen, [hit('c', 1, { speaker: '宝玉' })])).toEqual(seen);
    expect(speakerOptions(['b', 'a'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('按视频分组：组按第一次出现，组里保持原来的顺序', () => {
    const groups = groupHits([hit('a', 1), hit('b', 5), hit('a', 3)]);
    expect(groups.map((g) => [g.videoId, g.videoName, g.hits.map((h) => h.time.start)])).toEqual([
      ['a', '视频 a', [1, 3]],
      ['b', '视频 b', [5]],
    ]);
    expect(groupHits([])).toEqual([]);
  });

  it('每组先给十条，「再显示」一次再放十条（设计稿 planRows）', () => {
    const rows = Array.from({ length: 23 }, (_, i) => i);
    expect(planGroupRows(rows)).toMatchObject({ rest: 13, more: 10, next: 20 });
    expect(planGroupRows(rows).rows).toHaveLength(10);
    expect(planGroupRows(rows, 20)).toMatchObject({ rest: 3, more: 3, next: 30 });
    expect(planGroupRows(rows, 30)).toMatchObject({ rest: 0, more: 0 });
    expect(planGroupRows(rows, 30).rows).toHaveLength(23);
  });

  it('命中行：标签是种类（译文带语言），位置是时间 · 说话人', () => {
    expect(hitChip({ documentKind: 'translation', language: 'en' })).toBe('译文 · en');
    expect(hitChip({ documentKind: 'chapter', language: null })).toBe('章节');
    expect(hitWhere({ time: { clock: 'sequence', start: 65, end: 70 }, speaker: '宝玉' })).toBe('1:05 · 宝玉');
    expect(hitWhere({ time: { clock: 'source', start: 3, end: 4 }, speaker: null })).toBe('素材时间 0:03');
  });
});
