import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
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

/** 几份文档当前版本的正文（同 `useDocumentBody`），与 `records` 一一对应；还没取到的是 undefined。 */
export function useDocumentBodies(records: readonly DocumentRecord[]): unknown[] {
  const documents = useRuntime().videos.documents;
  const key = records.map((r) => `${r.id}@${r.currentRevision}`).join('|');
  useEffect(() => {
    for (const r of records) documents.load(r.id, r.currentRevision);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` 已经概括了 records 里要的部分
  }, [documents, key]);
  const subscribe = useCallback((listener: () => void) => documents.subscribe(listener), [documents]);
  // 快照只是「哪几份到了」，正文按版本不变，取到后引用稳定。
  const loaded = useSyncExternalStore(subscribe, () => records.map((r) => (documents.peek(r.id, r.currentRevision) === undefined ? 0 : 1)).join(''));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上
  return useMemo(() => records.map((r) => documents.peek(r.id, r.currentRevision)), [documents, key, loaded]);
}
