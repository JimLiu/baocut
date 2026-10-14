import type { Id, MediaTime, SemanticReason, SpaceSearchDocumentKind, SpaceSearchHit } from '@baocut/protocol';
import type { EmbeddingProfile, EmbeddingRole } from '@baocut/models';
import type { ContentReader } from '../content-index.ts';
import { extractContent } from '../content-extract.ts';
import { searchTerms, type SearchableVideo } from '../content-search.ts';
import type { SpaceViewer } from '../space-queries.ts';
import { anchorOf, frameWindowOf, type ResolvedScope, type SearchService } from '../search-service.ts';
import { encodeHitId } from './hit-id.ts';
import { chunkVideo, joinText, type SentenceRow } from './chunks.ts';
import { reasonOf, semanticError } from './errors.ts';
import type { EmbeddingScheduler } from './scheduler.ts';
import type { SemanticStore } from './store.ts';
import { SEMANTIC_THRESHOLDS } from './thresholds.ts';
import { cosine } from './vector-index.ts';

/**
 * Runtime 内部的语义能力 SemanticContext（创作辅助集成设计 §3.2）：写作选材、章节、术语、翻译记忆、重录、插图与智能体工具
 * 都经它取材，不直接碰 `space.searchV2`。不是网关方法。
 *
 * - **范围先于计算**：一个 SemanticContext 绑定一个主体（`SpaceViewer`），`scope` 只能在它能看到的视频里再收窄，
 *   扫描之前就按主体筛好（与 `space.searchV2` 同一个 `SearchService.resolveScope`）。
 * - **原文不清洗**：返回的文字是文稿原文。
 * - **退路形状一致**：没有模型或索引时 `findRelevantChunks` 退回字面匹配（按命中的词数排序），再不行是 `none`，结果形状不变，
 *   `effectiveMode` 写明走了哪条路。`embedTexts`、`pairSimilar` 没有退路，抛带原因码的错误，由调用方决定（例如精确匹配）。
 * - 查询向量不持久化；文档向量全部来自语义索引当前发布的世代。
 */

export interface ChunkScope {
  /** 只在这些视频里（仍不超过主体的范围）。 */
  videoIds?: Id[];
  /** 只在这个项目里；`null` 是不属于项目的视频。 */
  projectId?: Id | null;
  /** 偏好的时钟；命中按实际时钟给。 */
  view?: 'source' | 'sequence';
}

export interface ChunkRef {
  chunkId: string;
}

export interface RelevantSentence {
  sentenceId: string;
  documentId: Id | null;
  text: string;
  clock: 'sequence' | 'source';
  start: number;
  end: number;
  speaker: string | null;
  /** 为了上下文完整向前后扩进来的邻句（不是命中本身）。 */
  neighbor: boolean;
}

export interface RelevantChunk {
  chunkId: string;
  videoId: Id;
  documentId: Id | null;
  documentKind: SpaceSearchDocumentKind;
  /** 稳定句子身份，供回引与定位（含邻句）。 */
  sentenceIds: string[];
  /** 原文，不清洗（含邻句）。 */
  text: string;
  anchor: { clock: 'source' | 'sequence'; start: MediaTime; end: MediaTime };
  chapter?: { id: string; title: string };
  /** 仅用于排序与阈值：语义是余弦，字面是命中的词占比。 */
  score: number;
  /**
   * 弱命中：语义分数低于弱命中阈值（`weakHit`，未校准）。只标出、不藏起来——G0 里有答案的查询最低分低于无答案查询的
   * 最高分，阈值分不开两者（v0.1 §18.1 校准之前只当提示）。字面一路没有这一项。
   */
  weak?: boolean;
  /** 逐句（引用编号、定位用）。 */
  sentences: RelevantSentence[];
}

export interface RelevantChunkSet {
  chunks: RelevantChunk[];
  coverage: { chapters: string[]; indexed: boolean; stale: boolean };
  effectiveMode: 'semantic' | 'lexical' | 'none';
  /** 没走语义时的原因。 */
  reason: SemanticReason | null;
}

export interface FindRelevantChunksRequest {
  intent: string;
  scope: ChunkScope;
  channel: 'text';
  limit: number;
  order: 'time' | 'relevance';
  neighbors?: number;
  /**
   * 只要分数不低于它的语义命中（只对语义路有效）。不给时不筛：低于服务的 `weakHit`（`semantic-thresholds.json`）的命中标
   * `weak`，照样返回。
   */
  minScore?: number;
  kinds?: SpaceSearchDocumentKind[];
  signal?: AbortSignal;
}

/**
 * 段落配图的一处画面（创作辅助集成设计 §3.5）：一组相邻关键帧的候选窗口。`clock` 为 `sequence` 时 `startSec`/`endSec` 是当前
 * 时间线上的位置，否则是素材的源时间（素材这一段不在时间线上，或索引落后于当前版本）；`at` 是最像的那一帧（源时间，取帧用）。
 * `near` 表示在给的句子附近（±`windowSec`）；`weak` 是低于画面弱命中线（只标出，同一部视频里不按它筛）。
 */
export interface FrameCandidate {
  assetId: Id;
  videoId: Id;
  clock: 'sequence' | 'source';
  startSec: number;
  endSec: number;
  at: number;
  score: number;
  near: boolean;
  weak: boolean;
  /** `space.resolveSearchHit` 用的命中身份。 */
  hitId: string;
}

export interface SimilarPair {
  left: number;
  right: number;
  score: number;
}

export interface SemanticStatus {
  state: 'ready' | 'partial' | 'stale' | 'unavailable';
  reason: SemanticReason | null;
  indexed: number;
  pending: number;
  stale: number;
}

/**
 * 章节边界（创作辅助集成设计 §3.6）用的句群：一份讲话转写在当前版本语义索引里的句群（时间线时间，按顺序）与它们的文档向量。
 * `start` 是这个句群里第一句不与上一个句群重叠的句子的起点（句群之间重叠几句），即从这里往后才是新内容。
 */
export interface TopicUnit {
  start: number;
  end: number;
  text: string;
  vector: Float32Array;
}

export interface SemanticContext {
  /** 当前版本已建好索引时，这份转写的句群与向量（不重新编码）；没有模型、索引不是这一版或没有这份转写时 null。 */
  topicUnits(req: { videoId: Id; documentId: Id }): Promise<TopicUnit[] | null>;
  /** 当前版本画面索引里、在时间线上的关键帧（按时间线秒排）与向量；没有当前版本的画面索引时 null。 */
  timelineFrames(req: { videoId: Id }): Promise<{ at: number; vector: Float32Array }[] | null>;
  embedTexts(texts: string[], opts: { role: EmbeddingRole; profileId?: string; signal?: AbortSignal }): Promise<Float32Array[]>;
  findRelevantChunks(req: FindRelevantChunksRequest): Promise<RelevantChunkSet>;
  /** `near`：一句讲话（稳定句子 ID）或时间线上的一段（秒），前后各放宽 `windowSec`。 */
  matchFrames(req: {
    text: string;
    videoId: Id;
    near?: { sentenceId: string; windowSec: number } | { start: number; end: number; windowSec: number };
    limit: number;
  }): Promise<FrameCandidate[]>;
  pairSimilar(req: { left: ChunkRef[] | string[]; right: ChunkRef[] | string[]; profileId?: string; threshold: number; signal?: AbortSignal }): Promise<SimilarPair[]>;
  status(scope: ChunkScope): Promise<SemanticStatus>;
}

export interface SemanticContextDeps {
  search: SearchService;
  store: () => SemanticStore | null;
  scheduler: () => EmbeddingScheduler | null;
  /** 字面退路要句子身份时读视频当前内容（没有语义索引时）。 */
  reader: Pick<ContentReader, 'readContent'> | null;
  /** 弱命中阈值的缺省；不给时用 `semantic-thresholds.json` 的 `weakHit`。 */
  weakHit?: number;
}

/** 绑定主体的 SemanticContext 工厂：Runtime 建一个，按调用者的主体取用（写作任务、智能体工具）。 */
export type SemanticContextFactory = (viewer: SpaceViewer) => SemanticContext;

export function semanticContextFactory(deps: SemanticContextDeps): SemanticContextFactory {
  return (viewer) => createSemanticContext(deps, viewer);
}

/** 字面退路最多为几部视频读内容（对回句子身份）；更多的命中没有句子身份。 */
const LEXICAL_READ_MAX_VIDEOS = 8;
const LEXICAL_TERM_LIMIT = 200;
/** `matchFrames` 最多给几处、扫描时取多少帧（再按素材并组）。 */
const MATCH_FRAMES_MAX = 20;
const MATCH_FRAMES_SCAN = 200;

export function createSemanticContext(deps: SemanticContextDeps, viewer: SpaceViewer): SemanticContext {
  const profileOf = async (purpose: 'retrieval' | 'symmetric'): Promise<EmbeddingProfile> => {
    const scheduler = deps.scheduler();
    if (!scheduler) throw semanticError('MODEL_NOT_INSTALLED');
    try {
      return await scheduler.profile(purpose);
    } catch (error) {
      throw semanticError(reasonOf(error));
    }
  };

  const embed = async (texts: readonly string[], role: EmbeddingRole, profileId: string | undefined, signal?: AbortSignal): Promise<Float32Array[]> => {
    if (texts.length === 0) return [];
    const purpose = role === 'symmetric' ? 'symmetric' : 'retrieval';
    const profile = await profileOf(purpose);
    if (profileId !== undefined && profileId !== profile.encoderProfileId) throw semanticError('PROFILE_INCOMPATIBLE');
    try {
      const result = await deps.scheduler()!.embed(purpose, { role, inputs: texts.map((text) => ({ text })) }, { priority: 'interactive', ...(signal ? { signal } : {}) });
      return result.vectors;
    } catch (error) {
      throw semanticError(signal?.aborted ? 'SEARCH_CANCELLED' : reasonOf(error));
    }
  };

  return {
    embedTexts: (texts, opts) => embed(texts, opts.role, opts.profileId, opts.signal),

    async timelineFrames({ videoId }) {
      const store = deps.store();
      if (!store) return null;
      const resolved = deps.search.resolveScope(viewer, { videoIds: [videoId] }, null);
      const entry = deps.search.resolveVisualScope(resolved, null).videos.find((v) => v.video.videoId === videoId);
      if (entry?.state !== 'indexed' || !entry.generation) return null;
      const partition = store.visualPartition(entry.generation.id);
      if (!partition) return null;
      const dims = partition.generation.dims;
      return partition.frames
        .flatMap((frame, i) => (frame.sequenceSec === null ? [] : [{ at: frame.sequenceSec, vector: partition.vectors.subarray(i * dims, (i + 1) * dims) }]))
        .sort((a, b) => a.at - b.at);
    },

    async topicUnits({ videoId, documentId }) {
      const store = deps.store();
      const profiled = await deps.search.profile();
      if (!store || !('profile' in profiled)) return null;
      const entry = deps.search.resolveScope(viewer, { videoIds: [videoId] }, profiled.profile).videos.find((v) => v.video.videoId === videoId);
      if (entry?.state !== 'indexed' || !entry.generation) return null;
      const partition = store.partition(entry.generation.id);
      if (!partition) return null;
      const ofDocument = (row: { documentKind: SpaceSearchDocumentKind; documentId: Id | null; clock: 'sequence' | 'source' }) =>
        row.documentKind === 'speech' && row.documentId === documentId && row.clock === 'sequence';
      const dims = partition.generation.dims;
      const picked = partition.chunks.flatMap((chunk, i) => (ofDocument(chunk) ? [{ chunk, vector: partition.vectors.subarray(i * dims, (i + 1) * dims) }] : []));
      picked.sort((a, b) => a.chunk.ord - b.chunk.ord);
      const rows = store.sentences(entry.generation.id).filter(ofDocument);
      const units: TopicUnit[] = [];
      let previous = new Set<string>();
      for (const { chunk, vector } of picked) {
        const ids = new Set(chunk.sentenceIds);
        // 重叠过来的句子之后的第一句；一句太长被切成几块时没有新句子，用这一块自己的起点。
        const fresh = rows.find((row) => row.sentenceIds.some((id) => ids.has(id) && !previous.has(id)));
        units.push({ start: fresh?.start ?? chunk.start, end: chunk.end, text: chunk.text, vector });
        previous = ids;
      }
      return units.length > 0 ? units : null;
    },

    async findRelevantChunks(req) {
      const intent = req.intent.trim();
      const limit = Math.max(1, Math.floor(req.limit));
      const neighbors = Math.max(0, Math.floor(req.neighbors ?? 0));
      const kinds = req.kinds && req.kinds.length > 0 ? req.kinds : null;
      const scopeParams = { ...(req.scope.projectId !== undefined ? { projectId: req.scope.projectId } : {}), ...(req.scope.videoIds ? { videoIds: req.scope.videoIds } : {}) };
      const profiled = await deps.search.profile();
      const profile = 'profile' in profiled ? profiled.profile : null;
      const resolved = deps.search.resolveScope(viewer, scopeParams, profile);
      const rows = new SentenceSource(deps, resolved);
      const stale = resolved.coverage.stale > 0;
      let reason: SemanticReason | null = 'reason' in profiled ? profiled.reason : null;

      if (profile && intent) {
        try {
          const weakHit = deps.weakHit ?? SEMANTIC_THRESHOLDS.thresholds.weakHit.value;
          const hits = (
            await deps.search.semanticCandidates(resolved, profile, intent, Math.max(limit * 3, limit + 10), { kinds, ...(req.signal ? { signal: req.signal } : {}) })
          ).filter((hit) => req.minScore === undefined || hit.score >= req.minScore);
          const chunks: RelevantChunk[] = [];
          const seen = new Set<string>();
          for (const hit of hits) {
            if (chunks.length >= limit) break;
            const key = `${hit.chunk.videoId}\u0000${hit.chunk.sentenceIds.join(',')}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const sentences = await rows.expand(hit.chunk.videoId, hit.chunk, neighbors);
            const chunk = chunkOf(hit.chunk, hit.score, sentences);
            chunks.push(hit.score < weakHit ? { ...chunk, weak: true } : chunk);
          }
          return finish(chunks, req.order, resolved, 'semantic', null, stale);
        } catch (error) {
          const why = reasonOf(error);
          if (why === 'INPUT_TOO_LONG' || why === 'SEARCH_CANCELLED') throw error;
          reason = why;
        }
      }

      // 字面退路：意图切成词，每个词各查一次，按命中的词数排序（意图句通常不会整句出现在文稿里）。
      const terms = searchTerms(intent);
      const index = deps.search.contentIndex;
      if (terms.length === 0 || !index) return finish([], req.order, resolved, 'none', reason ?? 'INDEX_NOT_READY', stale);
      const scored = new Map<string, { hit: SpaceSearchHit; terms: number; order: number }>();
      let order = 0;
      for (const term of terms) {
        const { hits } = index.search(resolved.scope.videos, { query: term, ...(kinds ? { kinds } : {}), limit: LEXICAL_TERM_LIMIT });
        for (const hit of hits) {
          const key = `${hit.videoId}\u0000${hit.documentKind}\u0000${hit.documentId ?? ''}\u0000${hit.time.clock}\u0000${hit.time.start}`;
          const known = scored.get(key);
          if (known) known.terms++;
          else scored.set(key, { hit, terms: 1, order: order++ });
        }
      }
      const ranked = [...scored.values()].sort((a, b) => b.terms - a.terms || a.order - b.order).slice(0, limit);
      if (ranked.length === 0) return finish([], req.order, resolved, 'lexical', reason, stale);
      const chunks: RelevantChunk[] = [];
      for (const { hit, terms: matched } of ranked) {
        const sentences = await rows.lexical(hit, neighbors);
        const text = sentences.length > 0 ? joinText(sentences.map((s) => s.text)) : hit.snippet;
        const start = sentences.length > 0 ? Math.min(...sentences.map((s) => s.start)) : hit.time.start;
        const end = sentences.length > 0 ? Math.max(...sentences.map((s) => s.end)) : hit.time.end;
        const anchor = anchorOf(hit.time.clock, start, end);
        chunks.push({
          chunkId: `lexical:${hit.videoId}:${hit.documentKind}:${hit.documentId ?? ''}:${hit.time.clock}:${hit.time.start}`,
          videoId: hit.videoId,
          documentId: hit.documentId,
          documentKind: hit.documentKind,
          sentenceIds: [...new Set(sentences.map((s) => s.sentenceId))],
          text,
          anchor: { clock: anchor.clock, start: anchor.start, end: anchor.end },
          score: matched / terms.length,
          sentences,
        });
      }
      return finish(chunks, req.order, resolved, 'lexical', reason, stale);
    },

    async matchFrames(req) {
      // 一部视频里找与文字最像的画面（§3.5）：先列句子附近的，再列全片的；同一部视频里不按阈值筛，弱的标出来。
      const resolved = deps.search.resolveScope(viewer, { videoIds: [req.videoId] }, null);
      const scoped = resolved.videos.find((v) => v.video.videoId === req.videoId);
      if (!scoped) throw semanticError('SOURCE_MISSING');
      const profiled = await deps.search.visualProfile();
      if ('reason' in profiled) throw semanticError(profiled.reason, { channel: 'visual' });
      const visual = deps.search.resolveVisualScope(resolved, profiled.profile);
      const limit = Math.max(1, Math.min(req.limit, MATCH_FRAMES_MAX));
      const groups = await deps.search.frameCandidates(visual.videos, profiled.profile, req.text, MATCH_FRAMES_SCAN);
      let around: { start: number; end: number } | null = null;
      const near = req.near;
      if (near && 'start' in near) around = { start: near.start - near.windowSec, end: near.end + near.windowSec };
      else if (near && scoped.generation) {
        const row = deps
          .store()
          ?.sentences(scoped.generation.id)
          .find((s) => s.clock === 'sequence' && s.sentenceIds.includes(near.sentenceId));
        if (row) around = { start: row.start - near.windowSec, end: row.end + near.windowSec };
      }
      const candidates = groups.map((group) => {
        const window = frameWindowOf(group);
        const near = around !== null && window.clock === 'sequence' && window.start < around.end && window.end > around.start;
        return {
          assetId: group.best.assetId,
          videoId: group.video.videoId,
          clock: window.clock,
          startSec: window.start,
          endSec: window.end,
          at: group.best.sourceSec,
          score: group.cosine,
          near,
          weak: group.cosine < SEMANTIC_THRESHOLDS.thresholds.visualWeakHit.value,
          hitId: encodeHitId({
            videoId: group.video.videoId,
            documentId: null,
            kind: 'frame',
            sentenceIds: [],
            revision: group.generation.revision,
            clock: window.clock,
            start: window.start,
            end: window.end,
            chunkId: null,
            text: '',
            frame: { assetId: group.best.assetId, contentHash: group.best.contentHash, sourceStart: window.sourceStart, sourceEnd: window.sourceEnd },
          }),
        } satisfies FrameCandidate;
      });
      return [...candidates.filter((c) => c.near), ...candidates.filter((c) => !c.near)].slice(0, limit);
    },

    async pairSimilar(req) {
      const texts = async (side: ChunkRef[] | string[]): Promise<string[]> => {
        if (side.length === 0 || typeof side[0] === 'string') return side as string[];
        const store = deps.store();
        if (!store) throw semanticError('INDEX_NOT_READY');
        // ChunkRef 只认主体看得到的视频里的 chunk。
        const visible = new Set(deps.search.resolveScope(viewer, {}, null).scope.videos.map((v) => v.videoId));
        const byId = new Map(store.chunksById((side as ChunkRef[]).map((r) => r.chunkId)).filter((c) => visible.has(c.videoId)).map((c) => [c.chunkId, c.text]));
        return (side as ChunkRef[]).map((ref) => {
          const text = byId.get(ref.chunkId);
          if (text === undefined) throw semanticError('SOURCE_MISSING');
          return text;
        });
      };
      const [left, right] = [await texts(req.left), await texts(req.right)];
      const [lv, rv] = [await embed(left, 'symmetric', req.profileId, req.signal), await embed(right, 'symmetric', req.profileId, req.signal)];
      const pairs: SimilarPair[] = [];
      lv.forEach((l, i) =>
        rv.forEach((r, j) => {
          const score = cosine(l, r);
          if (score >= req.threshold) pairs.push({ left: i, right: j, score });
        }),
      );
      return pairs.sort((a, b) => b.score - a.score || a.left - b.left || a.right - b.right);
    },

    async status(scope) {
      const profiled = await deps.search.profile();
      const profile = 'profile' in profiled ? profiled.profile : null;
      const { coverage } = deps.search.resolveScope(
        viewer,
        { ...(scope.projectId !== undefined ? { projectId: scope.projectId } : {}), ...(scope.videoIds ? { videoIds: scope.videoIds } : {}) },
        profile,
      );
      const base = { indexed: coverage.indexed, pending: coverage.pending, stale: coverage.stale };
      if (!profile) return { state: 'unavailable', reason: 'reason' in profiled ? profiled.reason : 'MODEL_NOT_INSTALLED', ...base };
      if (coverage.indexed === 0) return { state: 'unavailable', reason: 'INDEX_NOT_READY', ...base };
      if (coverage.pending > 0 || coverage.failed > 0) return { state: 'partial', reason: 'INDEX_PARTIAL', ...base };
      if (coverage.stale > 0) return { state: 'stale', reason: 'INDEX_PARTIAL', ...base };
      return { state: 'ready', reason: null, ...base };
    },
  };
}

function finish(
  chunks: RelevantChunk[],
  order: 'time' | 'relevance',
  resolved: ResolvedScope,
  effectiveMode: RelevantChunkSet['effectiveMode'],
  reason: SemanticReason | null,
  stale: boolean,
): RelevantChunkSet {
  if (order === 'time') {
    const rank = new Map(resolved.scope.videos.map((v, i) => [v.videoId, i]));
    chunks.sort(
      (a, b) =>
        (rank.get(a.videoId) ?? 0) - (rank.get(b.videoId) ?? 0) ||
        (a.anchor.clock === b.anchor.clock ? 0 : a.anchor.clock === 'sequence' ? -1 : 1) ||
        Number(a.anchor.start.ticks) - Number(b.anchor.start.ticks),
    );
  }
  const chapters = [...new Set(chunks.flatMap((c) => (c.chapter ? [c.chapter.id] : [])))];
  return { chunks, coverage: { chapters, indexed: effectiveMode === 'semantic', stale }, effectiveMode, reason };
}

function chunkOf(
  chunk: { chunkId: string; videoId: Id; documentId: Id | null; documentKind: SpaceSearchDocumentKind; chapter: { id: string; title: string } | null; clock: 'sequence' | 'source'; start: number; end: number; text: string; sentenceIds: string[] },
  score: number,
  sentences: RelevantSentence[],
): RelevantChunk {
  const withNeighbors = sentences.some((s) => s.neighbor);
  const start = sentences.length > 0 ? Math.min(chunk.start, ...sentences.map((s) => s.start)) : chunk.start;
  const end = sentences.length > 0 ? Math.max(chunk.end, ...sentences.map((s) => s.end)) : chunk.end;
  const anchor = anchorOf(chunk.clock, start, end);
  return {
    chunkId: chunk.chunkId,
    videoId: chunk.videoId,
    documentId: chunk.documentId,
    documentKind: chunk.documentKind,
    sentenceIds: sentences.length > 0 ? [...new Set(sentences.map((s) => s.sentenceId))] : chunk.sentenceIds,
    text: withNeighbors ? joinText(sentences.map((s) => s.text)) : chunk.text,
    anchor: { clock: anchor.clock, start: anchor.start, end: anchor.end },
    ...(chunk.chapter ? { chapter: chunk.chapter } : {}),
    score,
    sentences,
  };
}

/**
 * 句子行：优先用语义索引当前世代的（版本与内容索引一致时），否则读视频当前内容现切（字面退路，最多几部视频）。
 */
class SentenceSource {
  readonly #deps: SemanticContextDeps;
  readonly #byVideo: Map<Id, ResolvedScope['videos'][number]>;
  readonly #cache = new Map<Id, Promise<SentenceRow[] | null>>();
  #reads = 0;

  constructor(deps: SemanticContextDeps, resolved: ResolvedScope) {
    this.#deps = deps;
    this.#byVideo = new Map(resolved.videos.map((v) => [v.video.videoId, v]));
  }

  rows(videoId: Id): Promise<SentenceRow[] | null> {
    let rows = this.#cache.get(videoId);
    if (!rows) {
      rows = this.#load(videoId);
      this.#cache.set(videoId, rows);
    }
    return rows;
  }

  async #load(videoId: Id): Promise<SentenceRow[] | null> {
    const scoped = this.#byVideo.get(videoId);
    if (!scoped) return null;
    const store = this.#deps.store();
    if (store && scoped.generation && scoped.generation.revision === scoped.video.revision) return store.sentences(scoped.generation.id);
    if (!this.#deps.reader || this.#reads >= LEXICAL_READ_MAX_VIDEOS) return null;
    this.#reads++;
    return readRows(this.#deps.reader, scoped.video).catch(() => null);
  }

  /** 一个语义命中的句子与前后各 `neighbors` 句。 */
  async expand(
    videoId: Id,
    chunk: { documentId: Id | null; documentKind: SpaceSearchDocumentKind; clock: string; sentenceIds: string[] },
    neighbors: number,
  ): Promise<RelevantSentence[]> {
    if (chunk.documentKind === 'chapter') return [];
    const rows = (await this.rows(videoId)) ?? [];
    const doc = rows.filter((r) => r.documentId === chunk.documentId && r.documentKind === chunk.documentKind && r.clock === chunk.clock);
    const ids = new Set(chunk.sentenceIds);
    const hit = doc.map((r, i) => (r.sentenceIds.some((id) => ids.has(id)) ? i : -1)).filter((i) => i >= 0);
    return around(doc, hit, neighbors);
  }

  /** 一个字面命中（内容索引的一段）对回的句子与前后各 `neighbors` 句。 */
  async lexical(hit: SpaceSearchHit, neighbors: number): Promise<RelevantSentence[]> {
    if (hit.documentKind === 'chapter') return [];
    const scoped = this.#byVideo.get(hit.videoId);
    if (!scoped || scoped.video.revision !== hit.indexedRevision) return [];
    const rows = (await this.rows(hit.videoId)) ?? [];
    const doc = rows.filter((r) => r.documentId === hit.documentId && r.documentKind === hit.documentKind && r.clock === hit.time.clock);
    const matched = doc
      .map((r, i) => (r.start === hit.time.start || (r.start < hit.time.end && hit.time.start < r.end) ? i : -1))
      .filter((i) => i >= 0);
    return around(doc, matched, neighbors);
  }
}

function around(doc: readonly SentenceRow[], hits: readonly number[], neighbors: number): RelevantSentence[] {
  if (hits.length === 0) return [];
  const own = new Set(hits);
  const from = Math.max(0, Math.min(...hits) - neighbors);
  const to = Math.min(doc.length - 1, Math.max(...hits) + neighbors);
  const out: RelevantSentence[] = [];
  for (let i = from; i <= to; i++) {
    const row = doc[i]!;
    const sentenceId = row.sentenceIds[0];
    if (!sentenceId) continue;
    out.push({
      sentenceId,
      documentId: row.documentId,
      text: row.text,
      clock: row.clock,
      start: row.start,
      end: row.end,
      speaker: row.speaker,
      neighbor: !own.has(i),
    });
  }
  return out;
}

async function readRows(reader: Pick<ContentReader, 'readContent'>, video: SearchableVideo): Promise<SentenceRow[]> {
  const content = await reader.readContent(video.dir);
  if (content.videoId !== video.videoId) return [];
  return chunkVideo(content.videoId, extractContent(content, video.dir).segments).sentences;
}
