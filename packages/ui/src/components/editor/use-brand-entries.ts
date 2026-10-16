import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryEntry, LibraryEntrySummary } from '@baocut/protocol';
import { entryKey } from '../../model/library-entry.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { getLibraryEntry } from '../../runtime/library-commands.ts';
import { useLibrary } from '../../state/library-store.ts';

/**
 * 品牌库里某一种条目的内容（摘要里没有，逐条读出来，按版本缓存）：`pick` 把读到的条目换成调用方要的形状，读不出来或
 * `pick` 给 null 的那条不摆。`ready` 之前别说「还没有」：库的快照或条目还在路上。次序同品牌页（按名字）。
 */
export function useBrandEntries<T>(
  kind: string,
  pick: (summary: LibraryEntrySummary, entry: LibraryEntry) => T | null,
  idOf: (item: T) => string,
): { ready: boolean; items: T[] } {
  const runtime = useRuntime();
  const libraryReady = useLibrary((s) => s.ready);
  const summaries = useLibrary((s) => s.brand);
  const list = useMemo(() => summaries.filter((s) => s.kind === kind), [summaries, kind]);
  const signature = list.map(entryKey).join('|');
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const [loaded, setLoaded] = useState<{ signature: string; items: T[] }>({ signature: '', items: [] });
  useEffect(() => {
    if (!list.length) return;
    let live = true;
    void Promise.all(
      list.map((summary) =>
        getLibraryEntry(runtime, summary).then(
          (entry) => pickRef.current(summary, entry),
          () => null,
        ),
      ),
    ).then((items) => {
      if (live) setLoaded({ signature, items: items.filter((item): item is Awaited<T> => item !== null) });
    });
    return () => {
      live = false;
    };
    // signature 概括了 list。
  }, [runtime, signature]);
  if (!list.length) return { ready: libraryReady, items: EMPTY as T[] };
  if (loaded.signature === signature) return { ready: true, items: loaded.items };
  // 库里刚多了、少了或改了一条：新的一批读回来之前，先摆上一批里还在库里的，列表不闪空。
  const ids = new Set(list.map((summary) => summary.id));
  return { ready: false, items: loaded.items.filter((item) => ids.has(idOf(item))) };
}

const EMPTY: never[] = [];
