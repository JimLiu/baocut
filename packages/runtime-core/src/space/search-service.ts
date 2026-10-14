import crypto from 'node:crypto';
import {
  SEMANTIC_QUERY_MAX_CHARS,
  SPACE_SEARCH_V2_MAX_LIMIT,
  type Id,
  type SearchHitAnchor,
  type SemanticCoverage,
  type SemanticEstimate,
  type SemanticEvidenceType,
  type SemanticHitAction,
  type SemanticIndexStatus,
  type SemanticIndexStatusParams,
  type SemanticReason,
  type SpaceSearchDocumentKind,
  type SpaceSearchHit,
  type SpaceSearchV2Hit,
  type SpaceSearchV2Params,
  type SpaceSearchV2Result,
} from '@baocut/protocol';
import type { EmbeddingProfile } from '@baocut/models';
import type { SearchableVideo } from './content-search.ts';
import { searchScope, type SearchScope, type SpaceSearchSource, type SpaceViewer } from './space-queries.ts';
import type { SemanticCoordinator, SemanticSettings } from './semantic/coordinator.ts';
import { reasonOf, semanticError } from './semantic/errors.ts';
import { estimateOf } from './semantic/estimate.ts';
import { encodeHitId } from './semantic/hit-id.ts';
import type { EmbeddingScheduler } from './semantic/scheduler.ts';
import type { GenerationRow, SemanticStore, StoredChunk, StoredFrame } from './semantic/store.ts';
import { RANKING_VERSION, SEMANTIC_THRESHOLDS } from './semantic/thresholds.ts';
import { emptyScanStats, type ScanHit, type ScanStats, type VectorScanner } from './semantic/vector-index.ts';
import { FRAME_INTERVAL_SEC } from './semantic/visual-lane.ts';

/**
 * `space.searchV2` 与 `space.indexStatus`（EmbeddingGemma 2 检索集成方案 v0.1 §10、§11）。
 *
 * 顺序（§10.1）：校验输入 → 按主体与筛选确定范围（`searchScope`，与 `space.search` 同一套规则）→ 只取范围内视频当前发布的世代 →
 * 在这些世代里精确扫描（范围先于计算：没有「先全库取再删」）→ 字面一路走内容索引（旧 `space.search` 的同一个检索）→
 * 两路按本次查询的 z 分数排（§10.2）→ 去重 → 标弱命中（§11.3）→ 分页。
 *
 * 模式：
 * - `lexical`：就是旧 `space.search` 的命中（同样的顺序与片段），换成 V2 的形状。
 * - `semantic`：只走向量；不可用（没装模型、索引没建、profile 不兼容）时报错，不把空结果当成功（§11.5）。
 * - `hybrid`：两路融合；向量一路不可用时退回字面，结果写 `effectiveMode: 'lexical'` 与 `degraded.reason`。
 *
 * 范围内有还没建好或落后的索引时照样返回结果，并标 `INDEX_PARTIAL`；覆盖情况在 `coverage` 里逐项给出。
 * `view` 只是偏好：命中的锚点按实际的时钟给（素材不在时间线上时是源时间）。
 *
 * 画面通道（`channels` 含 `visual`，§6.2、§6.4）：查询文字用 `text-to-visual` 的 profile 编码，在范围内视频当前发布的画面世代里
 * 精确扫描关键帧；同一素材相邻的帧并成一条（§10.2：采样密不该多拿分）。锚点是候选窗口（`boundary: 'window'`）：世代就是视频
 * 当前版本时用建索引时存下的时间线位置，否则给源时间、`needsResolve`，由 `space.resolveSearchHit` 重新投影。只有 `semantic` 与
 * `hybrid`（画面没有字面一路）；文字与画面都请求时两路按各自的 z 分数排在一起（不请求就不合），一路不可用时另一路照常、写明原因。
 */

export interface SearchServiceOptions {
  catalog: SpaceSearchSource;
  store: () => SemanticStore | null;
  scanner: VectorScanner;
  scheduler: () => EmbeddingScheduler | null;
  coordinator: SemanticCoordinator | null;
  settings: () => SemanticSettings;
  /** 模型包的显示信息（设置页）；没有时用 profile 的 ID。 */
  model?: () => { bundleId: string; label: string } | null;
}

const DEFAULT_LIMIT = 20;
const SNIPPET_MAX = 240;
const CURSOR_TTL_MS = 5 * 60 * 1000;

/** 范围内一个视频的语义索引状况。 */
export interface ScopedVideo {
  video: SearchableVideo;
  generation: GenerationRow | null;
  /** 当前 profile 能用的世代（同一个 embeddingSpaceId、有 chunk）。 */
  usable: boolean;
  /** 计进 `coverage` 的哪一项（智能体按视频看索引状况用）。 */
  state: ScopedVideoState;
}

/** `indexed` 跟上当前版本；`stale` 能用但落后于当前版本；其余同 `SemanticCoverage` 的同名项。 */
export type ScopedVideoState = 'indexed' | 'stale' | 'pending' | 'failed' | 'missingInput' | 'excluded';

export interface ResolvedScope {
  scope: SearchScope;
  videos: ScopedVideo[];
  coverage: SemanticCoverage;
}

/** 范围内一个视频的画面索引状况（状态的意思同 `ScopedVideo`）。 */
export interface VisualScopedVideo {
  video: SearchableVideo;
  generation: GenerationRow | null;
  usable: boolean;
  state: ScopedVideoState;
}

export interface ResolvedVisualScope {
  videos: VisualScopedVideo[];
  coverage: SemanticCoverage;
}

/** 一条画面命中：同一视频、同一素材相邻的几帧。 */
export interface FrameGroup {
  video: SearchableVideo;
  generation: GenerationRow;
  frames: StoredFrame[];
  /** 最像的那一帧与它的余弦。 */
  best: StoredFrame;
  cosine: number;
}

interface Candidate {
  key: string;
  video: SearchableVideo;
  generation: GenerationRow | null;
  chunk: StoredChunk | null;
  lexical: SpaceSearchHit | null;
  /** 字面命中对回的句子身份（对不回时为空）。 */
  sentenceIds: string[];
  lexicalRank: number | null;
  semanticRank: number | null;
  /** 向量一路的余弦（只有向量命中时才有）。 */
  cosine: number | null;
  /** 余弦按这次查询的分数分布换成的标准分（`scoreText` 填）；没有余弦时 null。 */
  z: number | null;
  score: number;
}

export class SearchService {
  readonly #options: SearchServiceOptions;

  constructor(options: SearchServiceOptions) {
    this.#options = options;
  }

  /** 字面一路用的内容索引（SemanticContext 的退路也用它）。 */
  get contentIndex(): SpaceSearchSource['index'] {
    return this.#options.catalog.index;
  }

  // ---- 范围与覆盖 ----

  /**
   * 主体能看到的范围（按项目、videoId 名单筛过）与每个视频的世代、覆盖。`profile` 给时只把同一向量空间的世代算作可用。
   */
  resolveScope(viewer: SpaceViewer, params: { projectId?: Id | null; videoIds?: readonly Id[] }, profile: EmbeddingProfile | null): ResolvedScope {
    const scope = searchScope(this.#options.catalog, viewer, params);
    const store = this.#options.store();
    const generations = store?.activeGenerations(scope.videos.map((v) => v.videoId)) ?? new Map<Id, GenerationRow>();
    const settings = this.#options.settings();
    const coverage: SemanticCoverage = {
      channel: 'text',
      eligible: 0,
      indexed: 0,
      pending: scope.pending,
      failed: 0,
      missingInput: 0,
      excluded: 0,
      stale: 0,
      knownScopeComplete: false,
    };
    const videos: ScopedVideo[] = [];
    for (const video of scope.videos) {
      const generation = generations.get(video.videoId) ?? null;
      const compatible = generation !== null && (profile === null || generation.embeddingSpaceId === profile.embeddingSpaceId);
      const usable = compatible && generation.chunkCount > 0;
      const source = store?.source(video.videoId) ?? null;
      const wanted = settings.indexedProjects === 'all' || (video.projectId !== null && settings.indexedProjects.includes(video.projectId));
      let state: ScopedVideoState;
      if (compatible && generation.chunkCount === 0 && generation.revision === video.revision) state = 'missingInput';
      else if (usable) state = generation.revision === video.revision ? 'indexed' : 'stale';
      else if (!wanted) state = 'excluded';
      else if (source?.state === 'failed' && source.wantedRevision === video.revision) state = 'failed';
      else state = 'pending';
      videos.push({ video, generation, usable, state });
      if (state === 'stale') {
        coverage.indexed++;
        coverage.stale++;
      } else coverage[state]++;
    }
    coverage.eligible = coverage.indexed + coverage.pending + coverage.failed;
    coverage.knownScopeComplete =
      coverage.pending === 0 && coverage.failed === 0 && coverage.stale === 0 && !this.#options.catalog.scanning && this.#options.catalog.index !== null;
    return { scope, videos, coverage };
  }

  /**
   * 画面索引在范围内的状况。设置里没开画面、也没有要过的视频算 `excluded`；只有文字模型包时 `profile` 为 null，世代都算可用
   * （状况只看建没建）。
   */
  resolveVisualScope(resolved: ResolvedScope, profile: EmbeddingProfile | null): ResolvedVisualScope {
    const store = this.#options.store();
    const ids = resolved.scope.videos.map((v) => v.videoId);
    const generations = store?.activeVisualGenerations(ids) ?? new Map<Id, GenerationRow>();
    const settings = this.#options.settings();
    const all = settings.channels.includes('visual');
    const coverage: SemanticCoverage = { ...resolved.coverage, channel: 'visual', eligible: 0, indexed: 0, pending: resolved.scope.pending, failed: 0, missingInput: 0, excluded: 0, stale: 0 };
    const videos: VisualScopedVideo[] = [];
    for (const video of resolved.scope.videos) {
      const generation = generations.get(video.videoId) ?? null;
      const compatible = generation !== null && (profile === null || generation.embeddingSpaceId === profile.embeddingSpaceId);
      const usable = compatible && generation.chunkCount > 0;
      const source = store?.visualSource(video.videoId) ?? null;
      const wantedProject = settings.indexedProjects === 'all' || (video.projectId !== null && settings.indexedProjects.includes(video.projectId));
      const wanted = wantedProject && (source !== null || all);
      let state: ScopedVideoState;
      if (compatible && generation.chunkCount === 0 && generation.revision === video.revision) state = 'missingInput';
      else if (usable) state = generation.revision === video.revision ? 'indexed' : 'stale';
      else if (!wanted) state = 'excluded';
      else if (source?.state === 'failed' && source.wantedRevision === video.revision) state = 'failed';
      else state = 'pending';
      videos.push({ video, generation, usable, state });
      if (state === 'stale') {
        coverage.indexed++;
        coverage.stale++;
      } else coverage[state]++;
    }
    coverage.eligible = coverage.indexed + coverage.pending + coverage.failed;
    coverage.knownScopeComplete =
      coverage.pending === 0 && coverage.failed === 0 && coverage.stale === 0 && !this.#options.catalog.scanning && this.#options.catalog.index !== null;
    return { videos, coverage };
  }

  /** 画面检索的 profile（`text-to-visual`）；没有取帧来源时 `CHANNEL_UNAVAILABLE`，只有文字模型包时 `MODEL_NOT_INSTALLED`。 */
  async visualProfile(): Promise<{ profile: EmbeddingProfile } | { reason: SemanticReason }> {
    if (!this.#options.coordinator?.visual) return { reason: 'CHANNEL_UNAVAILABLE' };
    const scheduler = this.#options.scheduler();
    if (!scheduler) return { reason: 'MODEL_NOT_INSTALLED' };
    try {
      return { profile: await scheduler.profile('text-to-visual') };
    } catch (error) {
      return { reason: reasonOf(error) };
    }
  }

  /**
   * 画面一路：在可用的画面世代里找与文字最像的 `k` 帧，同一素材相邻的帧并成一组（组的分数取最高的一帧）。失败时抛带原因码
   * （`channel: 'visual'`）的 `RpcError`。`SemanticContext.matchFrames` 也用它。
   */
  async frameCandidates(
    videos: readonly VisualScopedVideo[],
    profile: EmbeddingProfile,
    text: string,
    k: number,
    options: { signal?: AbortSignal; stats?: ScanStats } = {},
  ): Promise<FrameGroup[]> {
    const scheduler = this.#options.scheduler();
    if (!scheduler) throw semanticError('MODEL_NOT_INSTALLED', { channel: 'visual' });
    if (!this.#options.store()) throw semanticError('INDEX_NOT_READY', { channel: 'visual' });
    // 范围里一部视频都没有（例如会话只看自己的目录、目录里没有视频）：没有可扫的，不是索引没好。
    if (videos.length === 0) return [];
    const usable = videos.filter((v) => v.usable);
    if (usable.length === 0) {
      const incompatible = videos.some((v) => v.generation !== null && v.generation.chunkCount > 0 && v.generation.embeddingSpaceId !== profile.embeddingSpaceId);
      throw semanticError(incompatible ? 'PROFILE_INCOMPATIBLE' : 'INDEX_NOT_READY', { channel: 'visual' });
    }
    let vector: Float32Array;
    try {
      const result = await scheduler.embed('text-to-visual', { role: 'query', inputs: [{ text }] }, { priority: 'interactive', ...(options.signal ? { signal: options.signal } : {}) });
      vector = result.vectors[0]!;
    } catch (error) {
      throw semanticError(options.signal?.aborted ? 'SEARCH_CANCELLED' : reasonOf(error), { max: SEMANTIC_QUERY_MAX_CHARS, channel: 'visual' });
    }
    if (vector.length !== profile.dims) throw semanticError('PROFILE_INCOMPATIBLE', { channel: 'visual' });
    const byGeneration = new Map(usable.map((v) => [v.generation!.id, v]));
    const hits = this.#options.scanner.exactFrameSearch(vector, [...byGeneration.keys()], k, options.stats);
    return groupFrames(hits, byGeneration);
  }

  /** 当前检索 profile；没装模型或不可用时给原因。 */
  async profile(): Promise<{ profile: EmbeddingProfile } | { reason: SemanticReason }> {
    const scheduler = this.#options.scheduler();
    if (!scheduler) return { reason: 'MODEL_NOT_INSTALLED' };
    try {
      return { profile: await scheduler.profile('retrieval') };
    } catch (error) {
      return { reason: reasonOf(error) };
    }
  }

  /**
   * 向量一路：只在 `videos` 里可用的世代上扫描。失败时抛带原因码的 `RpcError`。`SemanticContext` 也用它。
   */
  async semanticCandidates(
    resolved: ResolvedScope,
    profile: EmbeddingProfile,
    text: string,
    k: number,
    options: { kinds?: readonly SpaceSearchDocumentKind[] | null; signal?: AbortSignal; stats?: ScanStats } = {},
  ): Promise<ScanHit[]> {
    const scheduler = this.#options.scheduler();
    if (!scheduler) throw semanticError('MODEL_NOT_INSTALLED');
    if (!this.#options.store()) throw semanticError('INDEX_NOT_READY');
    if (resolved.videos.length === 0) return [];
    const usable = resolved.videos.filter((v) => v.usable);
    if (usable.length === 0) {
      const incompatible = resolved.videos.some((v) => v.generation !== null && v.generation.chunkCount > 0 && v.generation.embeddingSpaceId !== profile.embeddingSpaceId);
      throw semanticError(incompatible ? 'PROFILE_INCOMPATIBLE' : 'INDEX_NOT_READY');
    }
    let vector: Float32Array;
    try {
      const result = await scheduler.embed('retrieval', { role: 'query', inputs: [{ text }] }, { priority: 'interactive', ...(options.signal ? { signal: options.signal } : {}) });
      vector = result.vectors[0]!;
    } catch (error) {
      throw semanticError(options.signal?.aborted ? 'SEARCH_CANCELLED' : reasonOf(error), { max: SEMANTIC_QUERY_MAX_CHARS });
    }
    if (vector.length !== profile.dims) throw semanticError('PROFILE_INCOMPATIBLE');
    const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
    return this.#options.scanner.exactSearch(
      vector,
      usable.map((v) => v.generation!.id),
      k,
      kinds ? (chunk) => kinds.has(chunk.documentKind) : undefined,
      options.stats,
    );
  }

  // ---- space.searchV2 ----

  async searchV2(viewer: SpaceViewer, params: SpaceSearchV2Params, signal?: AbortSignal): Promise<SpaceSearchV2Result> {
    if (params.query.kind !== 'text') throw semanticError('CHANNEL_UNAVAILABLE');
    const text = params.query.text;
    if ([...text].length > SEMANTIC_QUERY_MAX_CHARS) throw semanticError('INPUT_TOO_LONG', { max: SEMANTIC_QUERY_MAX_CHARS });
    if (params.appearance === 'rendered') throw semanticError('APPEARANCE_UNAVAILABLE');
    const channels = params.channels && params.channels.length > 0 ? [...new Set(params.channels)] : ['text' as const];
    if (channels.some((channel) => channel !== 'text' && channel !== 'visual')) throw semanticError('CHANNEL_UNAVAILABLE');
    if (channels.includes('visual')) {
      // 画面没有字面一路；没有取帧来源（不建画面索引）时这一路不存在。
      if (params.mode === 'lexical' || !this.#options.coordinator?.visual) throw semanticError('CHANNEL_UNAVAILABLE', { channel: 'visual' });
      return this.#withVisual(viewer, { ...params, channels }, text, signal);
    }
    const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_LIMIT, SPACE_SEARCH_V2_MAX_LIMIT));
    const kinds = params.kinds && params.kinds.length > 0 ? params.kinds : null;

    const wantsSemantic = params.mode !== 'lexical';
    const profiled = wantsSemantic ? await this.profile() : null;
    const profile = profiled && 'profile' in profiled ? profiled.profile : null;
    const resolved = this.resolveScope(viewer, params, profile);
    const queryDigest = digest([text, params.mode, channels, kinds, params.projectId ?? '*', params.videoIds ?? null, params.view ?? 'sequence', RANKING_VERSION]);
    const scopeHash = digest(resolved.videos.map((v) => `${v.video.videoId}:${v.video.revision}:${v.generation?.id ?? '-'}`));
    const offset = params.cursor ? readCursor(params.cursor, queryDigest, scopeHash) : 0;

    if (params.mode === 'lexical') return this.#lexical(resolved, text, kinds, offset, limit, queryDigest, scopeHash);

    const route = await this.#textRoute(resolved, profiled!, params.mode, text, kinds, signal);
    if ('failure' in route) {
      if (params.mode === 'semantic') throw semanticError(route.failure);
      const lexical = this.#lexical(resolved, text, kinds, offset, limit, queryDigest, scopeHash);
      return { ...lexical, degraded: { reason: route.failure } };
    }
    const scale = scalesOf({ text: route.stats }).text!;
    const cap = SEMANTIC_THRESHOLDS.fusion.mergedCandidates.value;
    const merged = dedupe(scoreText(route.candidates, scale));
    const kept = flagWeak(
      merged.slice(0, cap).map((c) => ({ score: c.score, z: c.z, lexical: c.lexicalRank !== null, item: c })),
    );
    const page = kept.slice(offset, offset + limit);
    const next = offset + page.length;
    const partial = !resolved.coverage.knownScopeComplete;
    return {
      hits: page.map((s) => hitOf(s.item, s.weak)),
      effectiveMode: params.mode,
      degraded: partial ? { reason: 'INDEX_PARTIAL' } : null,
      coverage: [resolved.coverage],
      rankingVersion: RANKING_VERSION,
      nextCursor: next < kept.length ? writeCursor(queryDigest, scopeHash, next) : null,
      truncated: merged.length > cap,
    };
  }

  /**
   * 文字一路的候选：向量一路扫出的 chunk（带余弦），`hybrid` 时再并上字面一路（同一个 chunk 合成一条）；附带向量一路这次扫过的
   * 全部余弦的分布（换标准分用）。向量一路不可用时给原因；输入问题、取消与 `semantic` 模式下的失败直接抛出。
   */
  async #textRoute(
    resolved: ResolvedScope,
    profiled: { profile: EmbeddingProfile } | { reason: SemanticReason },
    mode: SpaceSearchV2Params['mode'],
    text: string,
    kinds: readonly SpaceSearchDocumentKind[] | null,
    signal?: AbortSignal,
  ): Promise<{ candidates: Candidate[]; stats: ScanStats } | { failure: SemanticReason }> {
    if (!('profile' in profiled)) return { failure: profiled.reason };
    const stats = emptyScanStats();
    let semantic: ScanHit[];
    try {
      semantic = await this.semanticCandidates(resolved, profiled.profile, text, SEMANTIC_THRESHOLDS.fusion.perRouteCandidates.value, {
        kinds,
        stats,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const reason = reasonOf(error);
      // 输入问题与取消不退回：调用方要知道。
      if (reason === 'INPUT_TOO_LONG' || reason === 'SEARCH_CANCELLED' || mode === 'semantic') throw error;
      return { failure: reason };
    }
    const candidates = new Map<string, Candidate>();
    const byVideo = new Map(resolved.videos.map((v) => [v.video.videoId, v]));
    semantic.forEach((hit, index) => {
      const scoped = byVideo.get(hit.chunk.videoId);
      if (!scoped) return;
      candidates.set(`chunk:${hit.chunk.chunkId}`, {
        key: `chunk:${hit.chunk.chunkId}`,
        video: scoped.video,
        generation: scoped.generation,
        chunk: hit.chunk,
        lexical: null,
        sentenceIds: hit.chunk.sentenceIds,
        lexicalRank: null,
        semanticRank: index + 1,
        cosine: hit.score,
        z: null,
        score: 0,
      });
    });
    if (mode === 'hybrid') {
      for (const candidate of this.#lexicalCandidates(resolved, text, kinds)) {
        const existing = candidates.get(candidate.key);
        if (existing) {
          existing.lexicalRank ??= candidate.lexicalRank;
          existing.lexical ??= candidate.lexical;
          continue;
        }
        candidates.set(candidate.key, candidate);
      }
    }
    return { candidates: [...candidates.values()], stats };
  }

  /** 字面一路的候选（内容索引的命中，对回语义库的 chunk 与句子）。 */
  #lexicalCandidates(resolved: ResolvedScope, text: string, kinds: readonly SpaceSearchDocumentKind[] | null): Candidate[] {
    const byVideo = new Map(resolved.videos.map((v) => [v.video.videoId, v]));
    const lexical = this.#options.catalog.index?.search(resolved.scope.videos, {
      query: text,
      ...(kinds ? { kinds } : {}),
      limit: SEMANTIC_THRESHOLDS.fusion.perRouteCandidates.value,
    }) ?? { hits: [], truncated: false };
    const mapper = new LexicalMapper(this.#options.store(), byVideo);
    const out: Candidate[] = [];
    const seen = new Set<string>();
    lexical.hits.forEach((hit, index) => {
      const scoped = byVideo.get(hit.videoId);
      if (!scoped) return;
      const mapped = mapper.map(hit);
      const key = mapped.chunk ? `chunk:${mapped.chunk.chunkId}` : `lex:${hit.videoId}:${hit.documentKind}:${hit.documentId ?? ''}:${hit.time.clock}:${hit.time.start}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
        video: scoped.video,
        generation: scoped.generation,
        chunk: mapped.chunk,
        lexical: hit,
        sentenceIds: mapped.sentenceIds,
        lexicalRank: index + 1,
        semanticRank: null,
        cosine: null,
        z: null,
        score: 0,
      });
    });
    return out;
  }

  /**
   * 请求了画面：画面一路，加上请求了的文字一路。两路的余弦各自按这次查询的分布换成标准分（§10.2）再放在一起排：哪一路真的
   * 相关，哪一路排前面；不按名次交错。
   */
  async #withVisual(viewer: SpaceViewer, params: SpaceSearchV2Params & { channels: SpaceSearchV2Params['channels'] & {} }, text: string, signal?: AbortSignal): Promise<SpaceSearchV2Result> {
    const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_LIMIT, SPACE_SEARCH_V2_MAX_LIMIT));
    const fusion = SEMANTIC_THRESHOLDS.fusion;
    const kinds = params.kinds && params.kinds.length > 0 ? params.kinds : null;
    const passThrough = (error: unknown): SemanticReason => {
      const reason = reasonOf(error);
      if (reason === 'INPUT_TOO_LONG' || reason === 'SEARCH_CANCELLED') throw error;
      return reason;
    };

    // 文字一路：向量不可用时（`hybrid`）退回字面，`semantic` 时这一路算失败。
    const wantsText = params.channels.includes('text');
    const textProfiled = wantsText ? await this.profile() : null;
    const textProfile = textProfiled && 'profile' in textProfiled ? textProfiled.profile : null;
    const resolved = this.resolveScope(viewer, params, textProfile);
    let textCandidates: Candidate[] | null = null;
    let textStats: ScanStats | null = null;
    let textFailure: SemanticReason | null = null;
    let textDegraded: SemanticReason | null = null;
    if (textProfiled) {
      try {
        const route = await this.#textRoute(resolved, textProfiled, params.mode, text, kinds, signal);
        if ('failure' in route && params.mode === 'semantic') textFailure = route.failure;
        else if ('failure' in route) {
          textCandidates = this.#lexicalCandidates(resolved, text, kinds);
          textDegraded = route.failure;
        } else {
          textCandidates = route.candidates;
          textStats = route.stats;
          if (!resolved.coverage.knownScopeComplete) textDegraded = 'INDEX_PARTIAL';
        }
      } catch (error) {
        textFailure = passThrough(error);
      }
    }

    // 画面一路。
    const profiled = await this.visualProfile();
    const profile = 'profile' in profiled ? profiled.profile : null;
    const visualScope = this.resolveVisualScope(resolved, profile);
    let groups: FrameGroup[] | null = null;
    const visualStats = emptyScanStats();
    let visualFailure: SemanticReason | null = 'reason' in profiled ? profiled.reason : null;
    if (profile) {
      try {
        groups = await this.frameCandidates(visualScope.videos, profile, text, fusion.perRouteCandidates.value, { stats: visualStats, ...(signal ? { signal } : {}) });
      } catch (error) {
        visualFailure = passThrough(error);
      }
    }
    // 请求的通道一路都不可用：报画面的原因（不把空结果当成功，§11.5）；有一路可用时照常返回，`degraded` 写另一路的原因。
    if (!groups && !textCandidates) throw semanticError(visualFailure ?? 'MODEL_NOT_INSTALLED', { channel: 'visual' });

    const scales = scalesOf({ ...(textStats ? { text: textStats } : {}), ...(groups ? { visual: visualStats } : {}) });
    const scored: (Scored<(rank: number, weak: boolean) => SpaceSearchV2Hit> & { key: string })[] = [];
    if (textCandidates) {
      for (const c of dedupe(scoreText(textCandidates, scales.text ?? null))) {
        scored.push({ score: c.score, z: c.z, lexical: c.lexicalRank !== null, key: `t:${c.key}`, item: (_rank, weak) => hitOf(c, weak) });
      }
    }
    if (groups && scales.visual) {
      const visual = scales.visual;
      for (const group of groups) {
        const z = (group.cosine - visual.mean) / visual.dev;
        scored.push({ score: fusion.weights.visual.value * z, z, lexical: false, key: `v:${group.generation.id}:${group.frames[0]!.ord}`, item: (rank, weak) => frameHitOf(group, rank, weak) });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    const cap = fusion.mergedCandidates.value;
    const kept = flagWeak(scored.slice(0, cap));
    const queryDigest = digest([text, params.mode, params.channels, kinds, params.projectId ?? '*', params.videoIds ?? null, params.view ?? 'sequence', RANKING_VERSION]);
    const scopeHash = digest([
      ...resolved.videos.map((v) => `${v.video.videoId}:${v.video.revision}:${v.generation?.id ?? '-'}`),
      ...visualScope.videos.map((v) => `v:${v.video.videoId}:${v.generation?.id ?? '-'}`),
    ]);
    const offset = params.cursor ? readCursor(params.cursor, queryDigest, scopeHash) : 0;
    const page = kept.slice(offset, offset + limit);
    const next = offset + page.length;
    const coverage = [...(textCandidates ? [resolved.coverage] : []), visualScope.coverage];
    const reason =
      textFailure ??
      (groups ? null : visualFailure) ??
      textDegraded ??
      (groups && !visualScope.coverage.knownScopeComplete ? 'INDEX_PARTIAL' : null);
    return {
      hits: page.map((s) => ({ ...s.item(s.score, s.weak), rank: s.score })),
      effectiveMode: groups ? params.mode : textDegraded && textDegraded !== 'INDEX_PARTIAL' ? 'lexical' : params.mode,
      degraded: reason ? { reason } : null,
      coverage,
      rankingVersion: RANKING_VERSION,
      nextCursor: next < kept.length ? writeCursor(queryDigest, scopeHash, next) : null,
      truncated: scored.length > cap,
    };
  }

  #lexical(
    resolved: ResolvedScope,
    text: string,
    kinds: readonly SpaceSearchDocumentKind[] | null,
    offset: number,
    limit: number,
    queryDigest: string,
    scopeHash: string,
  ): SpaceSearchV2Result {
    const { hits, truncated } = this.#options.catalog.index?.search(resolved.scope.videos, {
      query: text,
      ...(kinds ? { kinds } : {}),
      limit: offset + limit,
    }) ?? { hits: [], truncated: false };
    const byVideo = new Map(resolved.videos.map((v) => [v.video.videoId, v]));
    const mapper = new LexicalMapper(this.#options.store(), byVideo);
    const page = hits.slice(offset, offset + limit);
    const k = SEMANTIC_THRESHOLDS.fusion.k.value;
    return {
      hits: page.flatMap((hit, index) => {
        const scoped = byVideo.get(hit.videoId);
        if (!scoped) return [];
        const mapped = mapper.map(hit);
        return [
          hitOf({
            key: '',
            video: scoped.video,
            generation: scoped.generation,
            chunk: null,
            lexical: hit,
            sentenceIds: mapped.sentenceIds,
            lexicalRank: offset + index + 1,
            semanticRank: null,
            cosine: null,
            z: null,
            score: 1 / (k + offset + index + 1),
          }, false),
        ];
      }),
      effectiveMode: 'lexical',
      degraded: null,
      coverage: [resolved.coverage],
      rankingVersion: RANKING_VERSION,
      nextCursor: truncated ? writeCursor(queryDigest, scopeHash, offset + page.length) : null,
      truncated,
    };
  }

  // ---- space.indexStatus ----

  async indexStatus(viewer: SpaceViewer, params: SemanticIndexStatusParams = {}): Promise<SemanticIndexStatus> {
    const profiled = await this.profile();
    const profile = 'profile' in profiled ? profiled.profile : null;
    const resolved = this.resolveScope(viewer, params, profile);
    const settings = this.#options.settings();
    const store = this.#options.store();
    const described = this.#options.model?.() ?? null;
    const blocked = this.#options.coordinator?.blockedReason ?? null;
    // 画面：有取帧来源、能拿到 `text-to-visual` 的 profile（装了能读图的模型包）时可用。
    const visualProfiled = this.#options.coordinator?.visual ? await this.visualProfile() : null;
    const visualProfile = visualProfiled && 'profile' in visualProfiled ? visualProfiled.profile : null;
    const visualScope = this.#options.coordinator?.visual ? this.resolveVisualScope(resolved, visualProfile) : null;
    return {
      model: profile
        ? {
            bundleId: described?.bundleId ?? profile.embeddingSpaceId,
            label: described?.label ?? profile.encoderProfileId,
            encoderProfileId: profile.encoderProfileId,
            embeddingSpaceId: profile.embeddingSpaceId,
            device: profile.device,
          }
        : null,
      reason: 'reason' in profiled ? profiled.reason : !store ? 'INDEX_NOT_READY' : ((blocked as SemanticReason | null) ?? null),
      channels: {
        text: { enabled: settings.channels.includes('text'), available: profile !== null && store !== null },
        visual: { enabled: settings.channels.includes('visual'), available: visualProfile !== null && store !== null },
        audio: { enabled: settings.channels.includes('audio'), available: false },
      },
      coverage: visualScope ? [resolved.coverage, visualScope.coverage] : [resolved.coverage],
      // 磁盘占用是全局的（不分主体）：只给用户本人。
      cacheBytes: viewer.kind === 'user' ? (store?.sizeBytes() ?? 0) : 0,
      paused: this.#options.coordinator?.paused ?? false,
      pauseReason: this.#options.coordinator?.pauseReason ?? null,
      estimates: this.#estimates(resolved, visualScope, profile, visualProfile),
      jobId: null,
    };
  }

  /**
   * 各路还要建多久（§13.2）：开着的通道估待建与落后的视频；画面没开时估打开之后要建的（纳入的项目里还没有可用画面世代的）。
   * 内容索引还没读到的视频时长未知。
   */
  #estimates(
    resolved: ResolvedScope,
    visualScope: ResolvedVisualScope | null,
    profile: EmbeddingProfile | null,
    visualProfile: EmbeddingProfile | null,
  ): SemanticEstimate[] {
    const settings = this.#options.settings();
    const store = this.#options.store();
    const index = this.#options.catalog.index;
    const durationOf = (video: SearchableVideo) => index?.at(video.dir)?.facts.timeline?.durationSec ?? null;
    const unread = Array.from({ length: resolved.scope.pending }, () => null);
    const out: SemanticEstimate[] = [];
    if (settings.channels.includes('text')) {
      const durations = resolved.videos.filter((v) => v.state === 'pending' || v.state === 'stale').map((v) => durationOf(v.video));
      out.push(estimateOf({ channel: 'text', durations: [...durations, ...unread], profile, store, ifEnabled: false }));
    }
    if (visualScope) {
      const enabled = settings.channels.includes('visual');
      const wantedProject = (projectId: Id | null) =>
        settings.indexedProjects === 'all' || (projectId !== null && settings.indexedProjects.includes(projectId));
      const durations = visualScope.videos
        .filter((v) => v.state === 'pending' || v.state === 'stale' || (!enabled && v.state === 'excluded' && wantedProject(v.video.projectId)))
        .map((v) => durationOf(v.video));
      out.push(estimateOf({ channel: 'visual', durations: [...durations, ...unread], profile: visualProfile, store, ifEnabled: !enabled }));
    }
    return out;
  }
}

// ---- 字面命中对回 chunk ----

/** 字面命中（内容索引的段落）对回语义索引的句子与 chunk：同一份文档、同一时钟、时间重叠；世代版本与命中版本相同时才对。 */
class LexicalMapper {
  readonly #store: SemanticStore | null;
  readonly #byVideo: ReadonlyMap<Id, ScopedVideo>;
  readonly #cache = new Map<number, { sentences: ReturnType<SemanticStore['sentences']>; chunks: StoredChunk[] }>();

  constructor(store: SemanticStore | null, byVideo: ReadonlyMap<Id, ScopedVideo>) {
    this.#store = store;
    this.#byVideo = byVideo;
  }

  map(hit: SpaceSearchHit): { chunk: StoredChunk | null; sentenceIds: string[] } {
    const generation = this.#byVideo.get(hit.videoId)?.generation ?? null;
    if (!this.#store || !generation || generation.revision !== hit.indexedRevision) return { chunk: null, sentenceIds: [] };
    let data = this.#cache.get(generation.id);
    if (!data) {
      data = { sentences: this.#store.sentences(generation.id), chunks: this.#store.generationChunks(generation.id) };
      this.#cache.set(generation.id, data);
    }
    const sameDoc = (row: { documentId: Id | null; documentKind: SpaceSearchDocumentKind; clock: string }) =>
      row.documentId === hit.documentId && row.documentKind === hit.documentKind && row.clock === hit.time.clock;
    if (hit.documentKind === 'chapter') {
      const chunk = data.chunks.find((c) => sameDoc(c) && Math.abs(c.start - hit.time.start) < 1e-3) ?? null;
      return { chunk, sentenceIds: chunk?.sentenceIds ?? [] };
    }
    const ids = new Set<string>();
    for (const row of data.sentences) {
      if (!sameDoc(row)) continue;
      if (overlaps(row.start, row.end, hit.time.start, hit.time.end)) for (const id of row.sentenceIds) ids.add(id);
    }
    if (ids.size === 0) return { chunk: null, sentenceIds: [] };
    let best: StoredChunk | null = null;
    let bestOverlap = 0;
    for (const chunk of data.chunks) {
      if (!sameDoc(chunk)) continue;
      const overlap = chunk.sentenceIds.filter((id) => ids.has(id)).length;
      if (overlap > bestOverlap) {
        best = chunk;
        bestOverlap = overlap;
      }
    }
    return { chunk: best, sentenceIds: [...ids] };
  }
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aStart === bStart) return true;
  return aStart < bEnd && bStart < aEnd;
}

// ---- 融合、去重 ----

/** 一路向量的分数刻度：这次查询的平均余弦与标准差。 */
export interface ScoreScale {
  mean: number;
  dev: number;
}

/**
 * 每一路的刻度（§10.2）：均值各路分开算（两路的查询编码不同，分数的水平不同），标准差几路合在一起算（各路按自己的标准差缩放会
 * 把分布窄的一路放大）。扫过的向量少（单部视频、刚建好的库）时，均值与方差按先验（`fusion.prior*`，在评测库上量的）收缩，
 * 先验相当于 `priorCount` 个样本；标准差不低于 `devFloor`。
 */
export function scalesOf(stats: { text?: ScanStats; visual?: ScanStats }): { text?: ScoreScale; visual?: ScoreScale } {
  const f = SEMANTIC_THRESHOLDS.fusion;
  const n0 = f.priorCount.value;
  const priors = {
    text: { mean: f.priorTextMean.value, dev: f.priorTextDev.value },
    visual: { mean: f.priorVisualMean.value, dev: f.priorVisualDev.value },
  };
  const means: { text?: number; visual?: number } = {};
  let squares = 0;
  let count = 0;
  for (const channel of ['text', 'visual'] as const) {
    const s = stats[channel];
    if (!s) continue;
    const prior = priors[channel];
    const mean = (s.sum + n0 * prior.mean) / (s.count + n0);
    means[channel] = mean;
    // Σ (x - mean)² = Σx² - 2·mean·Σx + n·mean²，加上先验的 n0·σ0²。
    squares += s.sumSq - 2 * mean * s.sum + s.count * mean * mean + n0 * prior.dev * prior.dev;
    count += s.count + n0;
  }
  const dev = Math.max(count > 0 ? Math.sqrt(Math.max(squares, 0) / count) : 0, f.devFloor.value);
  return {
    ...(means.text !== undefined ? { text: { mean: means.text, dev } } : {}),
    ...(means.visual !== undefined ? { visual: { mean: means.visual, dev } } : {}),
  };
}

/**
 * 文字一路的分数（§10.2）：向量命中的标准分 × 权重，字面命中再加 `lexicalBonus`（只有字面命中、不在向量候选里的算标准分 0）。
 * 同分时先看哪一路的名次靠前，再按 key 排，结果稳定。`scale` 为 null（向量一路不可用）时只有字面分。
 */
function scoreText(candidates: Candidate[], scale: ScoreScale | null): Candidate[] {
  const f = SEMANTIC_THRESHOLDS.fusion;
  for (const c of candidates) {
    c.z = scale && c.cosine !== null ? (c.cosine - scale.mean) / scale.dev : null;
    c.score = f.weights.semantic.value * (c.z ?? 0) + (c.lexicalRank !== null ? f.weights.lexical.value * f.lexicalBonus.value : 0);
  }
  const order = (c: Candidate) => Math.min(c.semanticRank ?? Infinity, c.lexicalRank ?? Infinity);
  return candidates.sort((a, b) => b.score - a.score || order(a) - order(b) || a.key.localeCompare(b.key));
}

interface Scored<T> {
  score: number;
  z: number | null;
  /** 字面命中：从不标弱。 */
  lexical: boolean;
  key?: string;
  item: T;
}

/**
 * 标弱命中（P2 的折叠依据）：不是字面命中，并且标准分低于 `strongZ`，或分数不到第一名的 `strongRatio`。只标出、不删；
 * 输入已按分数排好。
 */
function flagWeak<T>(sorted: Scored<T>[]): (Scored<T> & { weak: boolean })[] {
  const t = SEMANTIC_THRESHOLDS.thresholds;
  const top = sorted[0]?.score ?? 0;
  return sorted.map((s) => ({
    ...s,
    weak: !s.lexical && (s.z === null || s.z < t.strongZ.value || (top > 0 && s.score < t.strongRatio.value * top)),
  }));
}

/**
 * 去重，只留排名靠前的：
 * - 同一个视频、同一份文档里句子身份大半重叠的（相邻 chunk 的重叠句、同一句的字面与语义命中）；
 * - 同一个视频、同一时钟上时间大半重叠的讲话类命中（同一段话的文稿、字幕与译文），否则一段话会占掉好几条。章节不参与。
 */
function dedupe(sorted: readonly Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  for (const c of sorted) {
    const ids = c.chunk?.sentenceIds ?? c.sentenceIds;
    const span = spanOf(c);
    const sameSpan = span !== null && kept.some((other) => other.video.videoId === c.video.videoId && sameSpeechSpan(span, spanOf(other)));
    const duplicate =
      sameSpan ||
      (ids.length > 0 &&
        kept.some((other) => {
          if (other.video.videoId !== c.video.videoId) return false;
          const otherChunk = other.chunk;
          const otherKind = otherChunk?.documentKind ?? other.lexical?.documentKind;
          const otherDoc = otherChunk ? otherChunk.documentId : (other.lexical?.documentId ?? null);
          const kind = c.chunk?.documentKind ?? c.lexical?.documentKind;
          const doc = c.chunk ? c.chunk.documentId : (c.lexical?.documentId ?? null);
          if (otherKind !== kind || otherDoc !== doc) return false;
          const otherIds = new Set(otherChunk?.sentenceIds ?? other.sentenceIds);
          const shared = ids.filter((id) => otherIds.has(id)).length;
          return shared * 2 > ids.length;
        }));
    if (!duplicate) kept.push(c);
  }
  return kept;
}

interface Span {
  clock: string;
  start: number;
  end: number;
}

/** 讲话类命中（文稿、字幕、译文）的时间范围；章节为 null。 */
function spanOf(c: Candidate): Span | null {
  const kind = c.chunk?.documentKind ?? c.lexical?.documentKind;
  if (!kind || kind === 'chapter') return null;
  if (c.lexical) return { clock: c.lexical.time.clock, start: c.lexical.time.start, end: c.lexical.time.end };
  return c.chunk ? { clock: c.chunk.clock, start: c.chunk.start, end: c.chunk.end } : null;
}

/** 同一时钟上、重叠超过较短一段的一半（零长的一段落在另一段里也算）。 */
function sameSpeechSpan(a: Span, b: Span | null): boolean {
  if (!b || a.clock !== b.clock) return false;
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  if (shorter <= 0) return overlap >= 0;
  return overlap * 2 > shorter;
}

// ---- 命中 ----

const EVIDENCE: Record<SpaceSearchDocumentKind, SemanticEvidenceType> = {
  speech: 'transcript',
  caption: 'caption',
  translation: 'translation',
  chapter: 'summary',
};

function hitOf(c: Candidate, weak: boolean): SpaceSearchV2Hit {
  const chunk = c.chunk;
  const lexical = c.lexical;
  const documentKind = (chunk?.documentKind ?? lexical?.documentKind)!;
  const documentId = chunk ? chunk.documentId : (lexical?.documentId ?? null);
  // 字面命中的片段与高亮更准（句子级）；纯语义命中给 chunk 原文，不假高亮。
  const time = lexical ? lexical.time : { clock: chunk!.clock, start: chunk!.start, end: chunk!.end };
  const revision = lexical ? lexical.indexedRevision : c.generation!.revision;
  const sentenceIds = lexical ? c.sentenceIds : chunk!.sentenceIds;
  const matchedBy: Array<'lexical' | 'semantic'> = [];
  if (c.lexicalRank !== null) matchedBy.push('lexical');
  if (c.semanticRank !== null) matchedBy.push('semantic');
  const actions: SemanticHitAction[] = ['preview', 'cite'];
  if (time.clock === 'sequence') actions.splice(1, 0, 'open-in-timeline');
  const text = chunk?.text ?? lexical!.snippet;
  return {
    hitId: encodeHitId({
      videoId: c.video.videoId,
      documentId,
      kind: documentKind,
      sentenceIds,
      revision,
      clock: time.clock,
      start: time.start,
      end: time.end,
      chunkId: chunk?.chunkId ?? null,
      text: lexical ? lexical.snippet : clip(text),
    }),
    target: { kind: 'document-span', videoId: c.video.videoId, documentId, documentKind, sentenceIds },
    videoName: c.video.videoName,
    entryId: c.video.entryId,
    projectId: c.video.projectId,
    matchChannels: ['text'],
    matchedBy,
    evidenceType: EVIDENCE[documentKind],
    snippet: lexical ? lexical.snippet : clip(text),
    highlights: lexical ? lexical.highlights : [],
    speaker: lexical ? lexical.speaker : chunk!.speaker,
    language: lexical ? lexical.language : chunk!.language,
    anchor: anchorOf(time.clock, time.start, time.end),
    indexedRevision: revision,
    needsResolve: revision !== c.video.revision,
    chapter: chunk?.chapter ?? null,
    rank: c.score,
    weak,
    actions,
  };
}

/** 采样点两侧各半个间隔：一帧代表的源时间窗口。 */
const FRAME_HALF_WINDOW = FRAME_INTERVAL_SEC / 2;
/** 同一素材相邻两帧在时间线上的间隔与源时间的间隔相差不超过这么多（秒）才并成一组（中间没有剪口）。 */
const FRAME_JOIN_TOLERANCE = 0.5;
/** 相邻两帧的余弦相差不超过这么多才并成一组（同一个镜头里的帧分数相近；换了画面分数会落下去）。未校准。 */
const FRAME_JOIN_MARGIN = 0.03;

/**
 * 扫描出的帧按视频世代、素材分组：同一世代里序号相邻、同一素材、中间没有剪口、分数相近的帧并成一组；组按最高余弦排序。
 * 只并扫描出来的帧（前 `k` 个），不往外扩。
 */
export function groupFrames(hits: readonly { frame: StoredFrame; score: number }[], byGeneration: ReadonlyMap<number, { video: SearchableVideo; generation: GenerationRow | null }>): FrameGroup[] {
  const sorted = [...hits].sort((a, b) => a.frame.generationId - b.frame.generationId || a.frame.ord - b.frame.ord);
  const groups: FrameGroup[] = [];
  let current: FrameGroup | null = null;
  let lastScore = 0;
  for (const { frame, score } of sorted) {
    const scoped = byGeneration.get(frame.generationId);
    if (!scoped?.generation) continue;
    const last = current?.frames.at(-1);
    const joins =
      current !== null &&
      last !== undefined &&
      Math.abs(score - lastScore) <= FRAME_JOIN_MARGIN &&
      last.generationId === frame.generationId &&
      last.ord + 1 === frame.ord &&
      last.assetId === frame.assetId &&
      last.contentHash === frame.contentHash &&
      ((last.sequenceSec === null && frame.sequenceSec === null) ||
        (last.sequenceSec !== null &&
          frame.sequenceSec !== null &&
          Math.abs(frame.sequenceSec - last.sequenceSec - (frame.sourceSec - last.sourceSec)) <= FRAME_JOIN_TOLERANCE));
    lastScore = score;
    if (current && joins) {
      current.frames.push(frame);
      if (score > current.cosine) {
        current.cosine = score;
        current.best = frame;
      }
      continue;
    }
    current = { video: scoped.video, generation: scoped.generation, frames: [frame], best: frame, cosine: score };
    groups.push(current);
  }
  return groups.sort((a, b) => b.cosine - a.cosine || a.generation.id - b.generation.id || a.frames[0]!.ord - b.frames[0]!.ord);
}

/** 画面命中的时间窗口：世代是视频当前版本、几帧都在时间线上时用时间线位置，否则用源时间（要重新解析）。 */
export function frameWindowOf(group: FrameGroup): { clock: 'sequence' | 'source'; start: number; end: number; sourceStart: number; sourceEnd: number } {
  const first = group.frames[0]!;
  const last = group.frames.at(-1)!;
  const sourceStart = Math.max(0, first.sourceSec - FRAME_HALF_WINDOW);
  const sourceEnd = last.sourceSec + FRAME_HALF_WINDOW;
  const current = group.generation.revision === group.video.revision;
  if (current && first.sequenceSec !== null && last.sequenceSec !== null) {
    return { clock: 'sequence', start: Math.max(0, first.sequenceSec - FRAME_HALF_WINDOW), end: last.sequenceSec + FRAME_HALF_WINDOW, sourceStart, sourceEnd };
  }
  return { clock: 'source', start: sourceStart, end: sourceEnd, sourceStart, sourceEnd };
}

function frameHitOf(group: FrameGroup, rank: number, weak: boolean): SpaceSearchV2Hit {
  const window = frameWindowOf(group);
  const revision = group.generation.revision;
  const actions: SemanticHitAction[] = ['preview', 'cite'];
  if (window.clock === 'sequence') actions.splice(1, 0, 'open-in-timeline');
  return {
    hitId: encodeHitId({
      videoId: group.video.videoId,
      documentId: null,
      kind: 'frame',
      sentenceIds: [],
      revision,
      clock: window.clock,
      start: window.start,
      end: window.end,
      chunkId: null,
      text: '',
      frame: { assetId: group.best.assetId, contentHash: group.best.contentHash, sourceStart: window.sourceStart, sourceEnd: window.sourceEnd },
    }),
    target: { kind: 'asset-span', assetId: group.best.assetId, videoId: group.video.videoId, representation: 'keyframe' },
    videoName: group.video.videoName,
    entryId: group.video.entryId,
    projectId: group.video.projectId,
    matchChannels: ['visual'],
    matchedBy: ['semantic'],
    evidenceType: 'visual',
    snippet: '',
    highlights: [],
    speaker: null,
    language: null,
    anchor: { ...anchorOf(window.clock, window.start, window.end), boundary: 'window' },
    indexedRevision: revision,
    needsResolve: revision !== group.video.revision,
    chapter: null,
    rank,
    weak,
    actions,
  };
}

export function anchorOf(clock: 'sequence' | 'source', start: number, end: number): SearchHitAnchor {
  return {
    clock,
    start: { ticks: String(Math.round(start * 1000)), timescale: 1000 },
    end: { ticks: String(Math.round(end * 1000)), timescale: 1000 },
    startSec: start,
    endSec: end,
    boundary: 'exact',
  };
}

function clip(text: string): string {
  const chars = [...text];
  return chars.length <= SNIPPET_MAX ? text : `${chars.slice(0, SNIPPET_MAX).join('')}…`;
}

// ---- 游标 ----

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function writeCursor(query: string, scope: string, offset: number): string {
  return Buffer.from(JSON.stringify({ q: query, s: scope, o: offset, t: Date.now() }), 'utf8').toString('base64url');
}

/** 游标里记着查询、范围（视频版本与世代）与位置；任何一项变了或过期都报 `CURSOR_STALE`，不静默换一批结果。 */
function readCursor(cursor: string, query: string, scope: string): number {
  let value: { q?: unknown; s?: unknown; o?: unknown; t?: unknown };
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof value;
  } catch {
    throw semanticError('CURSOR_STALE');
  }
  if (
    value.q !== query ||
    value.s !== scope ||
    typeof value.o !== 'number' ||
    !Number.isInteger(value.o) ||
    value.o < 0 ||
    typeof value.t !== 'number' ||
    Date.now() - value.t > CURSOR_TTL_MS
  ) {
    throw semanticError('CURSOR_STALE');
  }
  return value.o;
}
