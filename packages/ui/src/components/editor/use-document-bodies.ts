import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { DocumentRecord, Id } from '@baocut/protocol';
import { useRuntime } from '../../runtime/context.tsx';

/**
 * 几份文档的正文（转写与选中的译文）。新版本还在取时先用上一版，免得每改一次闪一下；`fresh` 里是已经取到当前版本的。
 * 文稿面板（transcript-panel.tsx）与轻量视图的逐句（use-lite-lines.ts）共用。
 */
export function useDocumentBodies(records: readonly DocumentRecord[]): { bodies: ReadonlyMap<Id, unknown>; fresh: ReadonlySet<Id> } {
  const documents = useRuntime().videos.documents;
  const key = records.map((r) => `${r.id}@${r.currentRevision}`).join(',');
  useEffect(() => {
    // 按「文档@版本」取：`key` 变了才需要再取。
    for (const r of records) documents.load(r.id, r.currentRevision);
  }, [documents, key]);
  const subscribe = useCallback((listener: () => void) => documents.subscribe(listener), [documents]);
  const ready = useSyncExternalStore(subscribe, () =>
    records.map((r) => (documents.peek(r.id, r.currentRevision) === undefined ? 0 : 1)).join(''),
  );
  const last = useRef(new Map<Id, unknown>());
  return useMemo(() => {
    const bodies = new Map<Id, unknown>();
    const fresh = new Set<Id>();
    for (const r of records) {
      const value = documents.peek(r.id, r.currentRevision);
      if (value !== undefined) {
        last.current.set(r.id, value);
        fresh.add(r.id);
      }
      const shown = value ?? last.current.get(r.id);
      if (shown !== undefined) bodies.set(r.id, shown);
    }
    return { bodies, fresh };
    // `key` 与 `ready`：文档的版本换了、正文取到了才重算。
  }, [documents, key, ready]);
}
