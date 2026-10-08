import { useEffect, useMemo, useState } from 'react';
import type { BrandContent, LibraryEntry, LibraryEntrySummary } from '@baocut/protocol';
import { isDynamicSticker } from '../../model/library-brand.ts';
import { entryKey } from '../../model/library-entry.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { getLibraryEntry } from '../../runtime/library-commands.ts';
import { useLibrary } from '../../state/library-store.ts';

export interface BrandSticker {
  summary: LibraryEntrySummary;
  entry: LibraryEntry;
  /** 进「动态贴纸」那一页（Lottie）；否则进「贴纸」那一页。 */
  dynamic: boolean;
}

/**
 * 品牌库里的贴纸（元素页的「我的贴纸」）：摘要里没有文件类型，分不出图片与 Lottie，逐条读出来（按版本缓存）。
 * 读不出来的那条不摆。`ready` 之前别说「还没有」：库的快照或条目还在路上。次序同品牌页（按名字）。
 */
export function useBrandStickers(): { ready: boolean; stickers: BrandSticker[] } {
  const runtime = useRuntime();
  const libraryReady = useLibrary((s) => s.ready);
  const summaries = useLibrary((s) => s.brand);
  const list = useMemo(() => summaries.filter((s) => s.kind === 'sticker'), [summaries]);
  const signature = list.map(entryKey).join('|');
  const [loaded, setLoaded] = useState<{ signature: string; stickers: BrandSticker[] }>({ signature: '', stickers: [] });
  useEffect(() => {
    if (!list.length) return;
    let live = true;
    void Promise.all(
      list.map((summary) =>
        getLibraryEntry(runtime, summary).then(
          (entry): BrandSticker | null => {
            const content = entry.content as BrandContent;
            return content.kind === 'sticker' ? { summary, entry, dynamic: isDynamicSticker(content) } : null;
          },
          () => null,
        ),
      ),
    ).then((stickers) => {
      if (live) setLoaded({ signature, stickers: stickers.filter((s): s is BrandSticker => s !== null) });
    });
    return () => {
      live = false;
    };
    // signature 概括了 list。
  }, [runtime, signature]);
  if (!list.length) return { ready: libraryReady, stickers: EMPTY };
  if (loaded.signature === signature) return { ready: true, stickers: loaded.stickers };
  // 库里刚多了、少了或改了一条：新的一批读回来之前，先摆上一批里还在库里的，网格不闪空。
  const ids = new Set(list.map((summary) => summary.id));
  return { ready: false, stickers: loaded.stickers.filter((sticker) => ids.has(sticker.summary.id)) };
}

const EMPTY: BrandSticker[] = [];
