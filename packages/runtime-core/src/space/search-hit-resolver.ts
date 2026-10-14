import { RpcError, type SemanticResolveResult } from '@baocut/protocol';
import { RcSemantic, RcSpace } from '@baocut/protocol/messages/runtime-core';
import type { ContentReader } from './content-index.ts';
import { extractContent, sourceSegmentsOf, type ContentSegment } from './content-extract.ts';
import { searchScope, type SpaceSearchSource, type SpaceViewer } from './space-queries.ts';
import { joinText } from './semantic/chunks.ts';
import { decodeHitId, type FrameIdentity, type HitIdentity } from './semantic/hit-id.ts';
import { assetSegments } from '../agent-tools/source-chapters.ts';
import type { ReadContentResult } from './content-extract.ts';

/**
 * `space.resolveSearchHit`（EmbeddingGemma 2 检索集成方案 v0.1 §12.2）：按视频的当前版本把命中重新定位。身份是稳定句子 ID，
 * 时间只是显示：
 *
 * - 句子还在当前时间线上：`resolved`，给出它在根序列上的位置（同一句出现几次就几段，跨剪口拆开）。
 * - 句子还在文稿里，但不在当前时间线上（片段被删、素材没放上去）：`not-in-timeline`，给源时间，不伪造时间线位置。
 * - 句子、文档或视频已经没有了，或调用方看不到这个视频：`gone`（看不到与不存在一样回答）。
 * - 字面命中对不回句子身份、视频又改过：`unsupported`（没有可靠的身份可以重新定位）。
 * - 画面命中（`frame`）：身份是素材 + 内容版本 + 源时间窗口。素材还在、内容没换时，把窗口投到这个素材在时间线上的片段
 *   （几处就几段）；没放上时间线是 `not-in-timeline`；素材没了或换了内容是 `gone`。边界是 `window`（候选区间，不是精确时刻）。
 *
 * 每次解析读一次视频的当前内容（引擎的只读查询），不用索引里可能落后的副本。
 */

export interface HitResolverOptions {
  catalog: SpaceSearchSource;
  reader: Pick<ContentReader, 'readContent'> | null;
}

type Span = SemanticResolveResult['spans'][number];

/** 相邻段落之间小于这个间隔（秒）时并成一段。 */
const MERGE_GAP = 0.05;

export async function resolveSearchHit(options: HitResolverOptions, viewer: SpaceViewer, hitId: string): Promise<SemanticResolveResult> {
  const identity = decodeHitId(hitId);
  if (!identity) throw new RpcError('invalid-request', RcSemantic.hitInvalid());
  const gone: SemanticResolveResult = { status: 'gone', videoId: null, revision: null, spans: [], boundary: 'exact' };
  const video = searchScope(options.catalog, viewer, { videoIds: [identity.videoId] }).videos.find((v) => v.videoId === identity.videoId);
  if (!video) return gone;
  if (!options.reader) throw new RpcError('engine-unavailable', RcSpace.engineUnavailable());
  let content;
  try {
    content = await options.reader.readContent(video.dir);
  } catch {
    return gone;
  }
  if (content.videoId !== identity.videoId) return gone;
  if (identity.kind === 'frame' && identity.frame) return resolveFrame(content, identity.frame, identity.text);
  const base = { videoId: content.videoId, revision: content.revision, boundary: 'exact' as const };

  // 对不回句子的字面命中：只有版本没变时位置才可信。
  if (identity.sentenceIds.length === 0) {
    if (content.revision !== identity.revision) return { ...base, status: 'unsupported', spans: [] };
    return {
      ...base,
      status: identity.clock === 'sequence' ? 'resolved' : 'not-in-timeline',
      spans: [{ clock: identity.clock, startSec: identity.start, endSec: identity.end, sentenceIds: [], text: identity.text }],
    };
  }

  const extracted = extractContent(content, video.dir);
  const markers = identity.sentenceIds.filter((id) => id.startsWith('marker:')).map((id) => id.slice('marker:'.length));
  if (markers.length > 0) {
    const chapters = extracted.segments.filter((s) => s.kind === 'chapter' && s.markerId !== undefined && markers.includes(s.markerId));
    if (chapters.length === 0) return { ...gone, videoId: content.videoId, revision: content.revision };
    return { ...base, status: 'resolved', spans: chapters.map((s) => spanOf([s], identity)) };
  }

  const wanted = new Set(identity.sentenceIds);
  const matches = (s: ContentSegment) =>
    s.kind === identity.kind && s.documentId === identity.documentId && (s.sentenceIds ?? []).some((id) => wanted.has(id));
  const found = extracted.segments.filter(matches);
  const onTimeline = found.filter((s) => s.clock === 'sequence');
  if (onTimeline.length > 0) return { ...base, status: 'resolved', spans: merge(onTimeline, identity) };
  if (found.length > 0) return { ...base, status: 'not-in-timeline', spans: merge(found, identity) };

  // 不在时间线投影里：看文稿本身还有没有这一句（源时间）。译文看它译自的那份文稿。
  const doc = content.documents.find((d) => d.documentId === identity.documentId);
  const sourceDoc = identity.kind === 'translation' ? content.documents.find((d) => d.documentId === doc?.sourceDocumentId) : doc;
  if (sourceDoc) {
    const inSource = sourceSegmentsOf(sourceDoc).filter((s) => (s.sentenceIds ?? []).some((id) => wanted.has(id)));
    if (inSource.length > 0) {
      const spans = identity.kind === 'translation' ? merge(inSource, identity).map((span) => ({ ...span, text: identity.text })) : merge(inSource, identity);
      return { ...base, status: 'not-in-timeline', spans };
    }
  }
  return { ...gone, videoId: content.videoId, revision: content.revision };
}

function spanOf(segments: readonly ContentSegment[], identity: HitIdentity): Span {
  const ids = new Set<string>();
  for (const s of segments) for (const id of s.sentenceIds ?? []) ids.add(id);
  if (segments[0]?.markerId) ids.add(`marker:${segments[0].markerId}`);
  return {
    clock: segments[0]!.clock,
    startSec: Math.min(...segments.map((s) => s.start)),
    endSec: Math.max(...segments.map((s) => s.end)),
    sentenceIds: identity.kind === 'chapter' ? [...ids] : [...ids].filter((id) => identity.sentenceIds.includes(id)),
    text: joinText(segments.map((s) => s.text)),
  };
}

/** 按时间排好，相邻（同一时钟、间隔很小）的段落并成一段；同一句在时间线上出现几次就是几段。 */
function merge(segments: readonly ContentSegment[], identity: HitIdentity): Span[] {
  const sorted = [...segments].sort((a, b) => (a.clock === b.clock ? a.start - b.start : a.clock < b.clock ? -1 : 1));
  const groups: ContentSegment[][] = [];
  for (const s of sorted) {
    const last = groups.at(-1);
    const tail = last?.at(-1);
    if (last && tail && tail.clock === s.clock && s.start - tail.end <= MERGE_GAP && s.start >= tail.start) last.push(s);
    else groups.push([s]);
  }
  return groups.map((group) => spanOf(group, identity));
}

/** 画面命中按当前版本重新定位：源时间窗口与素材在根序列上每个片段的交集，换成时间线秒。 */
function resolveFrame(content: ReadContentResult, frame: FrameIdentity, text: string): SemanticResolveResult {
  const base = { videoId: content.videoId, revision: content.revision, boundary: 'window' as const };
  const asset = content.snapshot.assets?.[frame.assetId];
  const record = asset?.revisions?.[asset.currentRevision];
  if (!record || record.contentHash !== frame.contentHash) return { ...base, status: 'gone', spans: [] };
  const root = content.snapshot.sequences?.[content.snapshot.rootSequenceId];
  const spans: Span[] = [];
  for (const segment of root ? assetSegments(root, frame.assetId) : []) {
    const from = Math.max(frame.sourceStart, segment.sourceStart);
    const to = Math.min(frame.sourceEnd, segment.sourceEnd);
    if (!(to > from)) continue;
    const scale = segment.rate.den / segment.rate.num;
    spans.push({
      clock: 'sequence',
      startSec: segment.timelineStart + (from - segment.sourceStart) * scale,
      endSec: segment.timelineStart + (to - segment.sourceStart) * scale,
      sentenceIds: [],
      text,
    });
  }
  if (spans.length > 0) return { ...base, status: 'resolved', spans: spans.sort((a, b) => a.startSec - b.startSec) };
  return {
    ...base,
    status: 'not-in-timeline',
    spans: [{ clock: 'source', startSec: frame.sourceStart, endSec: frame.sourceEnd, sentenceIds: [], text }],
  };
}
