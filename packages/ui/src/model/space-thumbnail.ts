import type { SpaceEntry, SpaceEntryKind, SpaceThumbnail } from '@baocut/protocol';

/**
 * Space 条目缩略图的纯函数（产品设计 §4.2–§4.3；`space.thumbnail`）：哪些条目值得去取、条目的哪些变化要重取，
 * 以及 Runtime 的回答怎么变成界面画的东西。取的排队与缓存在 `runtime/space-thumbnails.ts`。
 */

/** 界面画的缩略图：画面是 data URL，文档与字幕是正文摘要，`none` 画类型占位。 */
export type Thumbnail =
  { kind: 'image'; url: string; width: number; height: number } | { kind: 'text'; excerpt: string } | { kind: 'none' };

export const NO_THUMBNAIL: Thumbnail = { kind: 'none' };

/** Runtime 一定答 `none` 的类型（音频、便携包、模板）不去问。 */
const PICTURED: ReadonlySet<SpaceEntryKind> = new Set(['video', 'export', 'video-file', 'image', 'document', 'subtitle']);

/** 值得去取缩略图：类型有画面或正文，且不是缺失、生成中或失败的（这几种 Runtime 都答 `none`，缺失另画灰底）。 */
export function wantsThumbnail(entry: SpaceEntry): boolean {
  if (!PICTURED.has(entry.kind)) return false;
  return entry.status !== 'missing' && entry.status !== 'generating' && entry.status !== 'failed';
}

/**
 * 条目的版本：这几项任何一项变了都重取（`entry.upsert` 带来新的条目时）。视频改了时间线会刷新最近活动；
 * 文件换了内容会变大小或最近活动；状态从缺失、生成中回来，或指向的视频、路径换了，也要重取。
 */
export function thumbnailVersion(entry: SpaceEntry): string {
  const ref = entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : '';
  return [entry.lastActivityAt, entry.size, entry.status ?? '', ref, entry.relPath].join('|');
}

export function toThumbnail(result: SpaceThumbnail): Thumbnail {
  if (result.kind === 'image') {
    return {
      kind: 'image',
      url: `data:${result.mimeType};base64,${result.data}`,
      width: result.width,
      height: result.height,
    };
  }
  if (result.kind === 'text') return result.excerpt ? { kind: 'text', excerpt: result.excerpt } : NO_THUMBNAIL;
  return NO_THUMBNAIL;
}
