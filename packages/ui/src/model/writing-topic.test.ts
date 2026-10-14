import { describe, expect, it } from 'vitest';
import { AI_TOOL_SERIES_MAX, type SemanticIndexStatus, type SpaceEntry, type SpaceRelevantChunk } from '@baocut/protocol';
import {
  boundaryDefault,
  pickedChunks,
  SERIES_OTHERS_MAX,
  seriesVideos,
  toggleSeries,
  TOPIC_LONG_SECONDS,
  topicDefault,
  topicSelection,
  topicTool,
  topicUsable,
} from './writing-topic.ts';

const status = (patch: Partial<SemanticIndexStatus> = {}): SemanticIndexStatus => ({
  model: { bundleId: 'embeddinggemma2-text@litert-lm', label: 'EmbeddingGemma 2 Text 270M', encoderProfileId: 'p', embeddingSpaceId: 's', device: 'cpu' },
  reason: null,
  channels: { text: { enabled: true, available: true }, visual: { enabled: false, available: false }, audio: { enabled: false, available: false } },
  coverage: [{ channel: 'text', eligible: 3, indexed: 3, pending: 0, failed: 0, missingInput: 0, excluded: 0, stale: 0, knownScopeComplete: true }],
  cacheBytes: 0,
  paused: false,
  pauseReason: null,
  estimates: [],
  jobId: null,
  ...patch,
});

const chunk = (chunkId: string, videoId: string, chapter: string | null): SpaceRelevantChunk =>
  ({ chunkId, videoId, chapter, clock: 'sequence', start: 0, end: 1, text: chunkId });

const video = (id: string, videoId: string, name: string, extra: Partial<SpaceEntry> = {}): SpaceEntry => ({
  id,
  kind: 'video',
  name,
  fileName: `${name}.mp4`,
  source: { projectId: 'p1', conversationId: null },
  relPath: `${name}.mp4`,
  size: 1,
  lastActivityAt: '2026-10-01T00:00:00Z',
  status: null,
  user: { favorite: false, displayName: null, trashedAt: null },
  ref: { videoId },
  ...extra,
});

describe('按主题选材', () => {
  it('给写总结、写博客、起标题与写简介；润色与章节没有', () => {
    expect(['summary', 'blog', 'chapters', 'polish', 'title', 'desc', 'cover'].filter(topicTool)).toEqual(['summary', 'blog', 'title', 'desc']);
  });

  it('装了模型且入口没置灰才能用；状态没取到、没装模型时不能用', () => {
    expect(topicUsable(status())).toBe(true);
    expect(topicUsable(null)).toBe(false);
    expect(topicUsable(status({ model: null, reason: 'MODEL_NOT_INSTALLED' }))).toBe(false);
  });

  it('缺省：能用且超过 30 分钟才按主题，没装模型时永远整篇', () => {
    expect(topicDefault({ usable: true, duration: TOPIC_LONG_SECONDS + 1 })).toBe('topic');
    expect(topicDefault({ usable: true, duration: TOPIC_LONG_SECONDS })).toBe('all');
    expect(topicDefault({ usable: false, duration: 3 * 3600 })).toBe('all');
  });

  it('selection：主题去掉首尾空白作意图句，空主题不带 intent；勾掉的句群原样作 exclude', () => {
    expect(topicSelection({ topic: '  选模型  ', excluded: new Set(['c2', 'c5']) })).toEqual({ mode: 'topic', intent: '选模型', exclude: ['c2', 'c5'] });
    expect(topicSelection({ topic: ' ', excluded: new Set() })).toEqual({ mode: 'topic' });
  });

  it('挑中的去掉勾掉的；章数按视频加章节去重，没章节的不算', () => {
    const chunks = [chunk('a', 'v1', 'Intro'), chunk('b', 'v1', 'Intro'), chunk('c', 'v2', 'Intro'), chunk('d', 'v1', null), chunk('e', 'v1', 'Setup')];
    expect(pickedChunks(chunks, new Set())).toMatchObject({ chapters: 3 });
    const kept = pickedChunks(chunks, new Set(['e', 'c']));
    expect(kept.chunks.map((c) => c.chunkId)).toEqual(['a', 'b', 'd']);
    expect(kept.chapters).toBe(1);
  });
});

describe('系列文章', () => {
  it('同项目的视频：去掉这部、回收站里的与非视频条目，切出的标成派生，用改过的名字按名字排', () => {
    const entries = [
      video('e1', 'v1', 'Episode 42'),
      video('e2', 'v2', 'Episode 43'),
      video('e3', 'v3', 'Clip', { origin: { source: 'derived', videoId: 'v1' } }),
      video('e4', 'v4', 'Old', { user: { favorite: false, displayName: null, trashedAt: '2026-10-02T00:00:00Z' } }),
      video('e5', 'v5', 'zz', { user: { favorite: false, displayName: 'Episode 41', trashedAt: null } }),
      { ...video('e6', 'v6', 'notes'), kind: 'document', ref: undefined } as SpaceEntry,
    ];
    expect(seriesVideos(entries, 'v1')).toEqual([
      { videoId: 'v3', name: 'Clip', derived: true },
      { videoId: 'v5', name: 'Episode 41', derived: false },
      { videoId: 'v2', name: 'Episode 43', derived: false },
    ]);
  });

  it('这部之外最多再选上限减一部；满了不再加，去掉照常', () => {
    expect(SERIES_OTHERS_MAX).toBe(AI_TOOL_SERIES_MAX - 1);
    let picked: string[] = [];
    for (let i = 0; i < SERIES_OTHERS_MAX + 2; i++) picked = toggleSeries(picked, `v${i}`, true);
    expect(picked).toHaveLength(SERIES_OTHERS_MAX);
    expect(toggleSeries(picked, 'v0', true)).toEqual(picked);
    expect(toggleSeries(picked, 'v0', false)).not.toContain('v0');
  });
});

describe('生成章节的边界', () => {
  it('能用本机语义时按话题检测，否则模型决定', () => {
    expect(boundaryDefault(true)).toBe('topic');
    expect(boundaryDefault(false)).toBe('model');
  });
});
