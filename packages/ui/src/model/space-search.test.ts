import { describe, expect, it } from 'vitest';
import { SEMANTIC_QUERY_MAX_CHARS, SPACE_SEARCH_V2_MAX_LIMIT, type SpaceEntry, type SpaceSearchHit, type SpaceSearchV2Hit } from '@baocut/protocol';
import {
  ANY_HIT,
  canWriteFromHit,
  collectSpeakers,
  exactSpeaker,
  groupHits,
  hitChip,
  hitTarget,
  hitVideoEntry,
  hitWhere,
  hitWords,
  matchedByKind,
  MEANING_IN_VIDEO_SHOWN,
  meaningInVideoRequest,
  meaningInVideoRows,
  meaningQueryReady,
  planGroupRows,
  foldWeakHits,
  SEARCH_LIMIT,
  searchNote,
  searchRequest,
  searchV2Request,
  seekSeconds,
  semanticHitRows,
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

  it('交给 Agent 带命中所在视频的条目；用于写作只给讲话内容、只在有 AI 工具的宿主', () => {
    const entries = [video('v1', 'vid1'), video('v2', 'vid2', { user: { favorite: false, displayName: null, trashedAt: '2026-10-01T00:00:00.000Z' } })];
    expect(hitVideoEntry({ entryId: null, videoId: 'vid1' }, entries)?.id).toBe('v1');
    expect(hitVideoEntry({ entryId: 'v2', videoId: 'vid2' }, entries)).toBeNull();
    expect(hitVideoEntry({ entryId: null, videoId: 'gone' }, entries)).toBeNull();
    expect(canWriteFromHit({ documentKind: 'speech' }, false)).toBe(true);
    expect(canWriteFromHit({ documentKind: 'speech' }, true)).toBe(false);
    for (const documentKind of ['caption', 'translation', 'chapter'] as const) expect(canWriteFromHit({ documentKind }, false)).toBe(false);
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

const v2 = (patch: Partial<SpaceSearchV2Hit> = {}): SpaceSearchV2Hit => ({
  hitId: 'h1',
  target: { kind: 'document-span', videoId: 'v1', documentId: 'd1', documentKind: 'speech', sentenceIds: ['s1', 's2'] },
  videoName: '访谈',
  entryId: 'e1',
  projectId: 'p1',
  matchChannels: ['text'],
  matchedBy: ['semantic'],
  evidenceType: 'transcript',
  snippet: '我们先把定价讲清楚',
  highlights: [],
  speaker: '宝玉',
  language: 'zh',
  anchor: { clock: 'sequence', start: { ticks: '65', timescale: 1 }, end: { ticks: '70', timescale: 1 }, startSec: 65, endSec: 70, boundary: 'exact' },
  indexedRevision: 'r1',
  needsResolve: false,
  chapter: null,
  rank: 1,
  weak: false,
  actions: ['preview', 'open-in-timeline', 'cite'],
  ...patch,
});

describe('综合搜索', () => {
  it('请求：综合模式只找讲话内容，查询按上限截断；项目与种类照旧', () => {
    const long = 'x'.repeat(SEMANTIC_QUERY_MAX_CHARS + 10);
    expect(searchV2Request(long, null, ANY_HIT)).toEqual({
      query: { kind: 'text', text: 'x'.repeat(SEMANTIC_QUERY_MAX_CHARS) },
      mode: 'hybrid',
      channels: ['text'],
      limit: SPACE_SEARCH_V2_MAX_LIMIT,
    });
    expect(searchV2Request('定价', 'none', { ...ANY_HIT, kind: 'caption' })).toMatchObject({ projectId: null, kinds: ['caption'] });
    expect(searchV2Request('定价', 'p1', ANY_HIT)).toMatchObject({ projectId: 'p1' });
  });

  it('命中摊平成旧的形状，另带怎么找到的、在不在时间线上、要不要重新解析；素材片段命中不收', () => {
    const rows = semanticHitRows([
      v2(),
      v2({ hitId: 'h2', actions: ['preview', 'cite'], needsResolve: true, videoName: null, matchedBy: ['lexical', 'semantic'] }),
      v2({ hitId: 'h3', target: { kind: 'asset-span', assetId: 'a1', videoId: 'v1', representation: 'keyframe' } }),
    ]);
    expect(rows.map((r) => r.hitId)).toEqual(['h1', 'h2']);
    expect(rows[0]).toMatchObject({
      videoId: 'v1',
      videoName: '访谈',
      documentKind: 'speech',
      time: { clock: 'sequence', start: 65, end: 70 },
      inTimeline: true,
      needsResolve: false,
    });
    expect(rows[1]).toMatchObject({ videoName: 'v1', inTimeline: false, needsResolve: true });
    expect(groupHits(rows)).toHaveLength(1);
  });

  it('怎么找到的：两路都对上、只是字面、只是意思相近', () => {
    expect(matchedByKind(['lexical', 'semantic'])).toBe('both');
    expect(matchedByKind(['lexical'])).toBe('lexical');
    expect(matchedByKind(['semantic'])).toBe('semantic');
  });

  it('命中原因写出的词：片段里标出的字面命中，按先后、去重（不分大小写），最多三个；纯语义没有高亮时为空', () => {
    const snippet = '剪辑的节奏，Cut 与 cut，再讲剪辑和转场、调色';
    const at = (word: string, from = 0) => [snippet.indexOf(word, from), snippet.indexOf(word, from) + word.length] as [number, number];
    expect(hitWords({ snippet, highlights: [at('剪辑'), at('Cut'), at('cut'), at('剪辑', 5), at('转场'), at('调色')] })).toEqual([
      '剪辑',
      'Cut',
      '转场',
    ]);
    expect(hitWords({ snippet, highlights: [] })).toEqual([]);
  });
});

describe('文稿查找条下的意思相近', () => {
  it('至少两个字、不是正则时才找；只找这部视频的讲话内容，按时间线投影，查询去掉首尾空白并截断', () => {
    expect(meaningQueryReady('定', false)).toBe(false);
    expect(meaningQueryReady('  定价 ', false)).toBe(true);
    expect(meaningQueryReady('定价', true)).toBe(false);
    expect(meaningInVideoRequest(' 定价 ', 'v1')).toEqual({
      query: { kind: 'text', text: '定价' },
      mode: 'hybrid',
      channels: ['text'],
      videoIds: ['v1'],
      kinds: ['speech'],
      view: 'sequence',
      limit: SPACE_SEARCH_V2_MAX_LIMIT,
    });
    expect(meaningInVideoRequest('x'.repeat(SEMANTIC_QUERY_MAX_CHARS + 5), 'v1').query).toEqual({ kind: 'text', text: 'x'.repeat(SEMANTIC_QUERY_MAX_CHARS) });
  });

  it('只留只靠意思找到的：字面命中（含两路都对上的）不列；按名次取前几条再按时间排', () => {
    const at = (s: number) => ({ clock: 'sequence' as const, start: { ticks: String(s), timescale: 1 }, end: { ticks: String(s + 2), timescale: 1 }, startSec: s, endSec: s + 2, boundary: 'exact' as const });
    const hits = [
      v2({ hitId: 'lex', matchedBy: ['lexical'], anchor: at(1) }),
      v2({ hitId: 'both', matchedBy: ['lexical', 'semantic'], anchor: at(2) }),
      ...Array.from({ length: MEANING_IN_VIDEO_SHOWN + 2 }, (_, i) => v2({ hitId: `s${i}`, anchor: at(100 - i * 10) })),
    ];
    const rows = meaningInVideoRows(hits);
    expect(rows.map((r) => r.hitId)).toEqual(['s4', 's3', 's2', 's1', 's0']);
    expect(rows.map((r) => r.time.start)).toEqual([60, 70, 80, 90, 100]);
  });
});

describe('弱命中折起来', () => {
  it('有明显相关的才折，全是弱命中或字面模式时不折', () => {
    const row = (id: string, weak?: boolean) => ({ id, ...(weak === undefined ? {} : { weak }) });
    expect(foldWeakHits([row('a', false), row('b', true), row('c', false)])).toEqual({ shown: [row('a', false), row('c', false)], folded: [row('b', true)] });
    expect(foldWeakHits([row('a', true), row('b', true)])).toEqual({ shown: [row('a', true), row('b', true)], folded: [] });
    expect(foldWeakHits([row('a'), row('b')])).toEqual({ shown: [row('a'), row('b')], folded: [] });
  });
});
