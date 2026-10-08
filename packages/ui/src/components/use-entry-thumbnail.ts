import { useEffect, useSyncExternalStore } from 'react';
import type { SpaceEntry } from '@baocut/protocol';
import { thumbnailVersion, wantsThumbnail, type Thumbnail } from '../model/space-thumbnail.ts';
import { useRuntime } from '../runtime/context.tsx';

/** Space 与会话卡共用缩略图缓存；挂上时按版本取，不必在编辑器里打开视频。 */
export function useEntryThumbnail(entry: SpaceEntry | null): Thumbnail | null {
  const cache = useRuntime().spaceThumbnails;
  const wanted = entry !== null && wantsThumbnail(entry);
  const version = entry ? thumbnailVersion(entry) : '';
  const id = entry?.id;
  const kind = entry?.kind;
  useEffect(() => (wanted && id && kind ? cache.retain(id, kind, version) : undefined), [cache, id, kind, version, wanted]);
  useSyncExternalStore(cache.subscribe, cache.version);
  return wanted && id ? cache.peek(id) : null;
}
