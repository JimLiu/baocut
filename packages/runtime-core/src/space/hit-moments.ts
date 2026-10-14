import { SPACE_MOMENT_PAD_SEC, mediaTimeToSeconds, type SpaceHitMoment, type SpaceHitMomentSpan, type VersionRef } from '@baocut/protocol';
import type { ReadContentResult } from './content-extract.ts';

/**
 * 检索命中的那一刻（`space.hitMoments`，创作辅助集成设计 §2.1）：按视频当前的工作稿，找命中那里看得见的素材与源时间。
 *
 * - 时间线秒的命中：根序列上那一秒看得见的视频片段（启用着、轨道可见、素材有画面，叠在上面的轨道优先，同 `posterFrame` 与预览的
 *   取法）。要播的区间是命中前后各 `SPACE_MOMENT_PAD_SEC` 秒，不超出这个片段，换成素材的源时间。定格的片段只有画面。
 * - 源时间的命中（文稿不在时间线上）：文稿对应的素材（译文看它译自的文稿），区间直接是源时间，不超出素材的时长。
 *
 * 纯函数：取帧与找文件在 `SpaceThumbnails.moments`。找不到时 null。
 */
export interface MomentPlan {
  asset: VersionRef;
  /** 画面取这一刻（源时间，秒）。 */
  at: number;
  frame: { contentHash: string; mediaType: string; durationSec: number | null };
  clip: NonNullable<SpaceHitMoment['clip']> | null;
}

export function momentPlan(content: Pick<ReadContentResult, 'snapshot' | 'documents'>, span: SpaceHitMomentSpan): MomentPlan | null {
  const start = span.startSec;
  const end = Math.max(span.startSec, span.endSec);
  return span.clock === 'sequence'
    ? sequenceMoment(content.snapshot, start, end)
    : sourceMoment(content, span.documentId ?? null, start, end);
}

function sequenceMoment(snapshot: ReadContentResult['snapshot'], start: number, end: number): MomentPlan | null {
  const sequence = snapshot.sequences?.[snapshot.rootSequenceId];
  if (!sequence?.tracks || !sequence.items || !snapshot.assets) return null;
  const tracks = new Map(sequence.tracks.map((track) => [track.id, track]));
  const fps = sequence.fps;
  let best: { order: number; plan: MomentPlan } | null = null;
  for (const item of sequence.items) {
    if (item.type !== 'video' || !item.enabled) continue;
    const track = tracks.get(item.trackId);
    if (!track?.visible || (best && best.order > track.order)) continue;
    const from = (item.span.fromFrame * fps.den) / fps.num;
    const until = ((item.span.fromFrame + item.span.durationFrames) * fps.den) / fps.num;
    if (start < from || start >= until) continue;
    const record = snapshot.assets[item.assetRef.id]?.revisions[item.assetRef.revision];
    if (!record?.video) continue;
    const frame = {
      contentHash: record.contentHash,
      mediaType: record.mediaType,
      durationSec: record.duration ? mediaTimeToSeconds(record.duration) : null,
    };
    if (item.timeMap.kind === 'hold') {
      best = {
        order: track.order,
        plan: { asset: item.assetRef, at: round(mediaTimeToSeconds(item.timeMap.sourceAt)), frame, clip: null },
      };
      continue;
    }
    const sourceIn = mediaTimeToSeconds(item.timeMap.sourceIn);
    const rate = item.timeMap.rate.num / item.timeMap.rate.den;
    const source = (t: number) => round(Math.max(0, sourceIn + (t - from) * rate));
    const clip = {
      assetId: item.assetRef.id,
      revision: item.assetRef.revision,
      from: source(Math.max(from, start - SPACE_MOMENT_PAD_SEC)),
      to: source(Math.min(until, end + SPACE_MOMENT_PAD_SEC)),
      hitFrom: source(start),
      hitTo: source(Math.min(until, end)),
    };
    best = { order: track.order, plan: { asset: item.assetRef, at: clip.hitFrom, frame, clip } };
  }
  return best?.plan ?? null;
}

function sourceMoment(
  content: Pick<ReadContentResult, 'snapshot' | 'documents'>,
  documentId: string | null,
  start: number,
  end: number,
): MomentPlan | null {
  const doc = documentId ? content.documents.find((d) => d.documentId === documentId) : undefined;
  if (!doc) return null;
  const origin = doc.sourceAssetId ? doc : content.documents.find((d) => d.documentId === doc.sourceDocumentId);
  const assetId = origin?.sourceAssetId;
  const asset = assetId ? content.snapshot.assets?.[assetId] : undefined;
  const record = asset?.revisions[asset.currentRevision];
  if (!assetId || !asset || !record?.video) return null;
  const duration = record.duration ? mediaTimeToSeconds(record.duration) : null;
  const clamp = (t: number) => round(Math.max(0, duration === null ? t : Math.min(duration, t)));
  const clip = {
    assetId,
    revision: asset.currentRevision,
    from: clamp(start - SPACE_MOMENT_PAD_SEC),
    to: clamp(end + SPACE_MOMENT_PAD_SEC),
    hitFrom: clamp(start),
    hitTo: clamp(end),
  };
  return {
    asset: { id: assetId, revision: asset.currentRevision },
    at: clip.hitFrom,
    frame: { contentHash: record.contentHash, mediaType: record.mediaType, durationSec: duration },
    clip,
  };
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
