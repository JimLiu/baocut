import { afterEach, describe, expect, it } from 'vitest';
import { RpcError, type Id, type SpaceEntry } from '@baocut/protocol';
import type { SpaceVideo } from '../space-catalog.ts';
import { centroidOf, nameTokens, relatedVideos, sharedName, type RelatedCatalog, type RelatedSemantic } from './related-videos.ts';
import type { ScopedVideo } from './search-service.ts';
import type { GenerationRow, StoredChunk, VectorPartition } from './semantic/store.ts';
import { SEMANTIC_THRESHOLDS } from './semantic/thresholds.ts';
import type { ScanHit } from './semantic/vector-index.ts';
import { USER_VIEWER } from './space-queries.ts';

/**
 * 相关视频（创作辅助集成设计 §2.4）：整部视频讲话向量的平均、逐部取最近的一段、排除切出的短视频与来源视频、只比同一向量空间、
 * 退回名字相近。语义一路用假的库与扫描（向量手写），名字一路只看 Space 目录。
 */

interface Fake {
  entryId: Id;
  videoId: Id;
  name: string;
  projectId?: Id | null;
  /** 派生自哪部视频（切出的短视频）。 */
  parent?: Id;
  kind?: SpaceEntry['kind'];
  /** 每个 chunk：文字、向量、种类（缺省讲话）。 */
  chunks?: Array<{ text: string; v: number[]; kind?: StoredChunk['documentKind'] }>;
  space?: string;
}

function entryOf(f: Fake): SpaceEntry {
  return {
    id: f.entryId,
    kind: f.kind ?? 'video',
    name: f.name,
    fileName: f.name,
    source: { projectId: f.projectId ?? null, conversationId: null },
    relPath: f.name,
    size: 0,
    lastActivityAt: '2026-01-01T00:00:00Z',
    createdAt: null,
    updatedAt: null,
    status: null,
    user: { favorite: false, displayName: null, trashedAt: null },
    ref: { videoId: f.videoId },
    ...(f.parent ? { origin: { source: 'derived' as const, videoId: f.parent, range: { start: 0, end: 10 } } } : {}),
  } as SpaceEntry;
}

function normalize(v: number[]): number[] {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

function world(fakes: Fake[]) {
  const entries = new Map(fakes.map((f) => [f.entryId, entryOf(f)]));
  const catalog: RelatedCatalog = {
    get: (id) => {
      const e = entries.get(id);
      if (!e) throw new RpcError('not-found', 'gone');
      return e;
    },
    videos: () =>
      fakes
        .filter((f) => (f.kind ?? 'video') === 'video')
        .map((f): SpaceVideo => ({ entryId: f.entryId, dir: `/v/${f.videoId}`, projectId: f.projectId ?? null, conversationId: null, lastActivityAt: '', videoId: f.videoId })),
    index: null,
    scanning: false,
  };
  const generations = new Map<number, VectorPartition>();
  const scoped: ScopedVideo[] = [];
  fakes.forEach((f, i) => {
    if (!f.chunks) return;
    const id = i + 1;
    const dims = f.chunks[0]!.v.length;
    const generation: GenerationRow = {
      id,
      videoId: f.videoId,
      channel: 'text',
      revision: 'r1',
      encoderProfileId: 'p',
      embeddingSpaceId: f.space ?? 'space-a',
      dims,
      chunkCount: f.chunks.length,
    };
    const chunks = f.chunks.map(
      (c, ord): StoredChunk => ({
        chunkId: `${f.videoId}-c${ord}`,
        generationId: id,
        videoId: f.videoId,
        documentId: 'd',
        documentKind: c.kind ?? 'speech',
        evidenceType: 'transcript' as StoredChunk['evidenceType'],
        sentenceIds: [],
        text: c.text,
        speaker: null,
        language: 'en',
        ord,
        clock: 'sequence',
        start: ord * 10,
        end: ord * 10 + 5,
        chapter: null,
        embeddingKey: `${f.videoId}-${ord}`,
      }),
    );
    generations.set(id, { generation, chunks, vectors: Float32Array.from(f.chunks.flatMap((c) => normalize(c.v))) });
    scoped.push({
      video: { dir: `/v/${f.videoId}`, videoId: f.videoId, videoName: f.name, entryId: f.entryId, projectId: f.projectId ?? null, revision: 'r1' },
      generation,
      usable: generation.embeddingSpaceId === 'space-a',
      state: 'indexed',
    });
  });
  const scanned: number[] = [];
  const semantic: RelatedSemantic = {
    search: {
      profile: async () => ({ profile: { embeddingSpaceId: 'space-a', dims: 3 } as never }),
      resolveScope: () => ({ scope: { videos: [], pending: 0 }, videos: scoped, coverage: { knownScopeComplete: true } as never }),
    },
    store: () => ({ partition: (id: number) => generations.get(id) ?? null }) as never,
    scanner: {
      exactSearch: (query, ids, k, filter) => {
        const hits: ScanHit[] = [];
        for (const id of ids) {
          scanned.push(id);
          const p = generations.get(id)!;
          p.chunks.forEach((chunk, i) => {
            if (filter && !filter(chunk)) return;
            let dot = 0;
            for (let d = 0; d < query.length; d++) dot += query[d]! * p.vectors[i * query.length + d]!;
            hits.push({ chunk, score: dot });
          });
        }
        return hits.sort((a, b) => b.score - a.score).slice(0, k);
      },
      exactFrameSearch: () => [],
      invalidate: () => {},
    },
  };
  return { catalog, semantic, scanned, scoped };
}

const threshold = SEMANTIC_THRESHOLDS.thresholds.related.value;
afterEach(() => {
  SEMANTIC_THRESHOLDS.thresholds.related.value = threshold;
});

describe('相关视频 · 按意思', () => {
  const base: Fake[] = [
    { entryId: 'e1', videoId: 'v1', name: 'Camera review', chunks: [{ text: 'battery life', v: [1, 0, 0] }, { text: 'lens', v: [0.8, 0.2, 0] }, { text: 'Untertitel', v: [0, 0, 1], kind: 'translation' }] },
    // 话多的一部：好几段都接近，也只占一行。
    { entryId: 'e2', videoId: 'v2', name: 'Battery test', chunks: [{ text: 'battery a', v: [1, 0.05, 0] }, { text: 'battery b', v: [0.95, 0.1, 0] }, { text: 'battery c', v: [0.9, 0.1, 0] }] },
    { entryId: 'e3', videoId: 'v3', name: 'Lens talk', chunks: [{ text: 'lens only', v: [0.6, 0.6, 0] }, { text: 'cooking', v: [0, 1, 0] }] },
    { entryId: 'e4', videoId: 'v4', name: 'Pasta night', chunks: [{ text: 'pasta', v: [0, 0.2, 1] }, { text: 'Sauce', v: [1, 0, 0], kind: 'caption' }] },
    // 从 v1 切出的短视频：内容一样，不列。
    { entryId: 'e5', videoId: 'v5', name: 'Camera review short', parent: 'v1', chunks: [{ text: 'battery life', v: [1, 0, 0] }] },
    // 另一个向量空间的世代：不扫。
    { entryId: 'e6', videoId: 'v6', name: 'Old index', chunks: [{ text: 'battery', v: [1, 0, 0] }], space: 'space-b' },
  ];

  it('整部视频讲话向量的平均（不算译文与字幕），归一化', () => {
    const { semantic } = world(base);
    const c = centroidOf(semantic.store()!, 1)!;
    expect(Math.hypot(...c)).toBeCloseTo(1, 5);
    expect(c[2]).toBe(0);
    expect(c[0]!).toBeGreaterThan(c[1]!);
    // 一段讲话也没有时用全部 chunk。
    const only = world([{ entryId: 'e1', videoId: 'v1', name: 'x', chunks: [{ text: 'cap', v: [0, 1, 0], kind: 'caption' }] }]);
    expect(Array.from(centroidOf(only.semantic.store()!, 1)!)).toEqual([0, 1, 0]);
  });

  it('逐部取最近的一段讲话，按分数排；不列切出的短视频、别的向量空间、低于阈值的', async () => {
    SEMANTIC_THRESHOLDS.thresholds.related.value = 0.5;
    const { catalog, semantic, scanned } = world(base);
    const result = await relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'e1' });
    expect(result.basis).toBe('semantic');
    expect(result.reason).toBeNull();
    expect(result.videos.map((v) => v.entryId)).toEqual(['e2', 'e3']);
    expect(result.videos[0]).toEqual({ entryId: 'e2', videoId: 'v2', name: 'Battery test', passage: { clock: 'sequence', start: 20, end: 25, text: 'battery c' }, sharedName: null });
    expect(result.videos[1]!.passage!.text).toBe('lens only');
    // 字幕那一段离得近也不算（只比讲话）；v4 的讲话低于阈值。
    expect(result.videos.some((v) => v.entryId === 'e4')).toBe(false);
    expect(scanned).not.toContain(6);
    expect(result.videos.some((v) => 'score' in v)).toBe(false);
    expect((await relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'e1', limit: 1 })).videos).toHaveLength(1);
    SEMANTIC_THRESHOLDS.thresholds.related.value = 1.01;
    expect((await relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'e1' })).videos).toEqual([]);
  });

  it('短视频那一头：不列它的来源视频，也不列同一来源切出的其他短视频', async () => {
    SEMANTIC_THRESHOLDS.thresholds.related.value = 0.5;
    const sibling: Fake = { entryId: 'e7', videoId: 'v7', name: 'Lens short', parent: 'v1', chunks: [{ text: 'lens', v: [0.8, 0.2, 0] }] };
    const { catalog, semantic } = world([...base, sibling]);
    const result = await relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'e5' });
    expect(result.videos.map((v) => v.entryId)).toEqual(['e2', 'e3']);
    // 来源视频那一头照样不列切出的短视频。
    expect((await relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'e1' })).videos.map((v) => v.entryId)).toEqual(['e2', 'e3']);
  });

  it('退回名字：没有语义服务、没装模型、这部视频没建好索引或在别的向量空间', async () => {
    const { catalog, semantic, scoped } = world(base);
    expect(await relatedVideos(catalog, null, USER_VIEWER, { entryId: 'e1' })).toMatchObject({ basis: 'name', reason: 'MODEL_NOT_INSTALLED' });
    const noModel: RelatedSemantic = { ...semantic, search: { ...semantic.search, profile: async () => ({ reason: 'MODEL_UNAVAILABLE' }) } };
    expect(await relatedVideos(catalog, noModel, USER_VIEWER, { entryId: 'e1' })).toMatchObject({ basis: 'name', reason: 'MODEL_UNAVAILABLE' });
    expect(await relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'e6' })).toMatchObject({ basis: 'name', reason: 'PROFILE_INCOMPATIBLE' });
    scoped.splice(0, 1);
    const named = await relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'e1' });
    expect(named.basis).toBe('name');
    expect(named.reason).toBe('INDEX_NOT_READY');
    // 「Camera review short」是切出的短视频，名字再像也不列。
    expect(named.videos).toEqual([]);
  });

  it('不是视频的条目报错', async () => {
    const { catalog, semantic } = world([...base, { entryId: 'doc', videoId: 'x', name: 'Notes', kind: 'document' }]);
    await expect(relatedVideos(catalog, semantic, USER_VIEWER, { entryId: 'doc' })).rejects.toMatchObject({ code: 'invalid-request' });
  });
});

describe('相关视频 · 名字相近', () => {
  it('名字里有同一个词：长的在前、同一个项目的在前；不列自己、短视频与来源视频', async () => {
    const { catalog } = world([
      { entryId: 'e1', videoId: 'v1', name: 'Code & Wander · Episode 42', projectId: 'p1' },
      { entryId: 'e2', videoId: 'v2', name: 'Code & Wander · Episode 41', projectId: 'p2' },
      { entryId: 'e3', videoId: 'v3', name: 'Wander notes', projectId: 'p1' },
      { entryId: 'e4', videoId: 'v4', name: 'Episode 42 trailer', projectId: 'p1', parent: 'v1' },
      { entryId: 'e5', videoId: 'v5', name: 'Cooking', projectId: 'p1' },
      { entryId: 'e6', videoId: 'v6', name: 'Wandering', projectId: 'p1' },
    ]);
    const result = await relatedVideos(catalog, null, USER_VIEWER, { entryId: 'e1' });
    expect(result.basis).toBe('name');
    expect(result.videos.map((v) => [v.entryId, v.sharedName])).toEqual([
      ['e2', 'Episode'],
      ['e3', 'Wander'],
    ]);
    expect(result.videos.every((v) => v.passage === null)).toBe(true);
  });

  it('切词：标点与符号切开，纯数字不算；拉丁写法至少三个字符、落在词边界上；中日韩至少两个字，整段比', () => {
    expect(nameTokens('中 → EN · 科浪访谈双语版 #3')).toEqual(['科浪访谈双语版']);
    expect(nameTokens('My trip to Paris (2026)')).toEqual(['trip', 'Paris']);
    expect(sharedName('Trip to Paris', 'Paris by night')).toBe('Paris');
    expect(sharedName('Wander', 'Wandering')).toBeNull();
    expect(sharedName('EN → 中 · Code & Wander 双语版', '中 → EN · 科浪访谈双语版')).toBe('双语版');
    expect(sharedName('第 03 讲', '第 03 期')).toBeNull();
  });
});
