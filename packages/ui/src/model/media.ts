import type { MediaTarget } from '@baocut/protocol';

/** 媒体定位的稳定键：同一个文件得到同一个键，用来缓存句柄、记住播放位置。 */
export function targetKey(target: MediaTarget): string {
  if ('entryId' in target) return `entry:${target.entryId}`;
  if ('videoId' in target) return `video:${target.videoId}:${target.assetId}:${target.revision ?? ''}`;
  if ('attachmentId' in target) return `attachment:${target.conversationId}:${target.attachmentId}`;
  if ('conversationId' in target) return `conv:${target.conversationId}:${target.path}`;
  return `project:${target.projectId}:${target.path}`;
}

/** Inline media and file/Space panes must use the same playback identity. */
export function previewMemoryKey(
  target: MediaTarget,
  entries: readonly import('@baocut/protocol').SpaceEntry[],
  conversations: readonly { id: string; projectId: string | null }[],
): string {
  const entry = 'entryId' in target ? entries.find(e => e.id === target.entryId) : undefined;
  const file = 'path' in target ? target.path : entry?.relPath;
  const projectId = 'projectId' in target ? target.projectId : entry?.source.projectId ??
    ('conversationId' in target ? conversations.find(c => c.id === target.conversationId)?.projectId : null);
  return projectId && file && !/^(?:\/|[a-z]:[\\/])/i.test(file) ? targetKey({projectId,path:file}) : targetKey(target);
}
