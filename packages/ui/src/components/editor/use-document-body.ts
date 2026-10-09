import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { DocumentRecord } from '@baocut/protocol';
import { useRuntime } from '../../runtime/context.tsx';

/** 文档当前版本的正文（经视频的文档缓存，与预览共用）；还没取到是 undefined。 */
export function useDocumentBody(record: DocumentRecord | undefined): unknown {
  const documents = useRuntime().videos.documents;
  const id = record?.id;
  const revision = record?.currentRevision;
  useEffect(() => {
    if (id && revision) documents.load(id, revision);
  }, [documents, id, revision]);
  const subscribe = useCallback((listener: () => void) => documents.subscribe(listener), [documents]);
  return useSyncExternalStore(subscribe, () => (id && revision ? documents.peek(id, revision) : undefined));
}
