import {
  RpcError,
  SPACE_RELATED_VIDEOS_DEFAULT_LIMIT,
  SPACE_RELATED_VIDEOS_MAX_LIMIT,
  termOccurs,
  type Id,
  type SemanticReason,
  type SpaceEntry,
  type SpaceRelatedVideo,
  type SpaceRelatedVideosParams,
  type SpaceRelatedVideosResult,
} from '@baocut/protocol';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { SearchService } from './search-service.ts';
import type { SemanticStore, StoredChunk } from './semantic/store.ts';
import { SEMANTIC_THRESHOLDS } from './semantic/thresholds.ts';
import type { VectorScanner } from './semantic/vector-index.ts';
import { visibleEntry, visibleVideo, type SpaceViewer } from './space-queries.ts';

/*
 * 讲相近内容的视频（创作辅助集成设计 §2.4「相关视频」、§2.13；原型 model-space-search.js `related`）。查看框打开视频时才算：
 *
 * - 按意思：这部视频讲话 chunk 的向量取平均（再归一化）当作「整部视频讲什么」，在别的视频的文字索引里逐部取最近的一段
 *   （每部一个分区、k = 1，免得一部话多的视频占满名额），按分数排、低于阈值的不列。只看讲话：字幕与译文是讲话的另一份，
 *   会把平均值拉偏。分数不给出去（不是概率）。
 * - 语义一路用不了（没装模型、这部视频还没建好索引、向量空间不一致）时退回名字相近：名字里有同一个词（§2.13「文件名匹配」），
 *   并写明原因。
 * - 不列：自己、这部视频切出的短视频、它的来源视频（内容本来就重叠）。回收站里的视频不在来源目录里，本来就不在。
 *
 * 阈值 `thresholds.related` 没有校准：在 EmbeddingGemma 2（LiteRT）上看过一个约 90 部视频的本机库，同一主题的（跨语言也算）
 * 落在 0.77–0.91，主题不同的在 0.68–0.75，初值取 0.75。别的 Provider 分数不在一个刻度上。
 */

export type RelatedCatalog = Pick<SpaceCatalog, 'get' | 'videos' | 'index' | 'scanning'>;

export interface RelatedSemantic {
  search: Pick<SearchService, 'profile' | 'resolveScope'>;
  store: () => SemanticStore | null;
  scanner: VectorScanner;
}

const speech = (chunk: StoredChunk) => chunk.documentKind === 'speech';

export async function relatedVideos(
  catalog: RelatedCatalog,
  semantic: RelatedSemantic | null,
  viewer: SpaceViewer,
  params: SpaceRelatedVideosParams,
): Promise<SpaceRelatedVideosResult> {
  const entry = visibleEntry(catalog, viewer, params.entryId);
  if (entry.kind !== 'video') throw new RpcError('invalid-request', RcSpace.relatedNotVideo());
  const limit = Math.max(1, Math.min(params.limit ?? SPACE_RELATED_VIDEOS_DEFAULT_LIMIT, SPACE_RELATED_VIDEOS_MAX_LIMIT));
  const videoId = videoIdOf(entry);
  const parentId = entry.origin?.source === 'derived' ? (entry.origin.videoId ?? null) : null;
  const skip = (other: SpaceEntry): boolean => {
    if (other.id === entry.id) return true;
    const otherId = videoIdOf(other);
    if (otherId !== null && (otherId === videoId || otherId === parentId)) return true;
    if (other.origin?.source !== 'derived') return false;
    // 它切出的短视频，以及与它同一来源切出的其他短视频（内容都来自同一部，本来就重叠）。
    return (videoId !== null && other.origin.videoId === videoId) || (parentId !== null && other.origin.videoId === parentId);
  };
  const byName = (reason: SemanticReason): SpaceRelatedVideosResult => ({
    basis: 'name',
    reason,
    videos: nameMatches(catalog, viewer, entry, skip, limit),
  });

  if (!semantic) return byName('MODEL_NOT_INSTALLED');
  const profiled = await semantic.search.profile();
  if ('reason' in profiled) return byName(profiled.reason);
  const store = semantic.store();
  if (!store || videoId === null) return byName('INDEX_NOT_READY');
  const { profile } = profiled;
  const resolved = semantic.search.resolveScope(viewer, {}, profile);
  const own = resolved.videos.find((v) => v.video.videoId === videoId);
  if (!own?.usable) {
    const other = own?.generation && own.generation.chunkCount > 0 && own.generation.embeddingSpaceId !== profile.embeddingSpaceId;
    return byName(other ? 'PROFILE_INCOMPATIBLE' : 'INDEX_NOT_READY');
  }
  const ownGeneration = own.generation!;
  const centroid = centroidOf(store, ownGeneration.id);
  if (!centroid) return byName('INDEX_NOT_READY');

  const threshold = SEMANTIC_THRESHOLDS.thresholds.related.value;
  const found: Array<SpaceRelatedVideo & { score: number }> = [];
  for (const scoped of resolved.videos) {
    const generation = scoped.generation;
    if (!scoped.usable || !generation || generation.embeddingSpaceId !== ownGeneration.embeddingSpaceId) continue;
    const other = scoped.video.entryId ? entryOf(catalog, scoped.video.entryId) : null;
    if (!other || skip(other)) continue;
    const [best] = semantic.scanner.exactSearch(centroid, [generation.id], 1, speech);
    if (!best || best.score < threshold) continue;
    found.push({
      entryId: other.id,
      videoId: scoped.video.videoId,
      name: other.name,
      passage: { clock: best.chunk.clock, start: best.chunk.start, end: best.chunk.end, text: best.chunk.text },
      sharedName: null,
      score: best.score,
    });
  }
  found.sort((a, b) => b.score - a.score || a.entryId.localeCompare(b.entryId));
  return {
    basis: 'semantic',
    reason: resolved.coverage.knownScopeComplete ? null : 'INDEX_PARTIAL',
    videos: found.slice(0, limit).map(({ score: _score, ...video }) => video),
  };
}

/** 一个世代里讲话 chunk 向量的平均，再归一化（点积就是余弦）；没有讲话时用全部 chunk；一个也没有时 null。 */
export function centroidOf(store: Pick<SemanticStore, 'partition'>, generationId: number): Float32Array | null {
  const partition = store.partition(generationId);
  if (!partition || partition.chunks.length === 0) return null;
  const dims = partition.generation.dims;
  const picked = partition.chunks.some(speech) ? partition.chunks.map(speech) : partition.chunks.map(() => true);
  const sum = new Float32Array(dims);
  partition.chunks.forEach((_, i) => {
    if (!picked[i]) return;
    for (let d = 0; d < dims; d++) sum[d]! += partition.vectors[i * dims + d]!;
  });
  let norm = 0;
  for (let d = 0; d < dims; d++) norm += sum[d]! * sum[d]!;
  if (norm === 0) return null;
  const scale = 1 / Math.sqrt(norm);
  for (let d = 0; d < dims; d++) sum[d]! *= scale;
  return sum;
}

// ---- 名字相近（§2.13 的退路） ----

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * 名字里的词：按空白、标点与符号切开，留下不是纯数字的；含中日韩文字的至少两个字，其他至少三个字符（`to`、`of` 这类不算）。
 * 中日韩名字中间没有分隔时整段是一个词，只有另一个名字里出现这一整段时才算相近。
 */
export function nameTokens(name: string): string[] {
  return name
    .split(/[\s\p{P}\p{S}]+/u)
    .map((t) => t.trim())
    .filter((t) => !/^\d+$/.test(t) && [...t].length >= (CJK.test(t) ? 2 : 3));
}

/** 两个名字里共同的词（取最长的一个）：一个名字里的词出现在另一个名字里（同 `termOccurs`：拉丁写法落在词边界上，不分大小写）。 */
export function sharedName(a: string, b: string): string | null {
  const found = [...nameTokens(a).filter((t) => termOccurs(t, b)), ...nameTokens(b).filter((t) => termOccurs(t, a))];
  return found.sort((x, y) => [...y].length - [...x].length || x.localeCompare(y))[0] ?? null;
}

function nameMatches(catalog: RelatedCatalog, viewer: SpaceViewer, entry: SpaceEntry, skip: (other: SpaceEntry) => boolean, limit: number): SpaceRelatedVideo[] {
  const project = entry.source.projectId;
  const rows: Array<SpaceRelatedVideo & { length: number; sameProject: boolean; order: number }> = [];
  catalog.videos().forEach((video, order) => {
    if (!visibleVideo(viewer, video)) return;
    const other = entryOf(catalog, video.entryId);
    if (!other || other.kind !== 'video' || skip(other)) return;
    const shared = sharedName(entry.name, other.name);
    if (!shared) return;
    rows.push({
      entryId: other.id,
      videoId: videoIdOf(other),
      name: other.name,
      passage: null,
      sharedName: shared,
      length: [...shared].length,
      sameProject: project !== null && video.projectId === project,
      order,
    });
  });
  // 共同的词长的在前；一样长时同一个项目的在前；再按最近活动（`videos()` 的次序）。
  rows.sort((a, b) => b.length - a.length || Number(b.sameProject) - Number(a.sameProject) || a.order - b.order);
  return rows.slice(0, limit).map(({ length: _l, sameProject: _s, order: _o, ...row }) => row);
}

function videoIdOf(entry: SpaceEntry): Id | null {
  return entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : null;
}

function entryOf(catalog: RelatedCatalog, entryId: Id): SpaceEntry | null {
  try {
    return catalog.get(entryId);
  } catch {
    return null;
  }
}
