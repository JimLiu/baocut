import { create } from 'zustand';
import type { LibraryEntrySummary, LibraryName } from '@baocut/protocol';
import { onLibraryEntries } from './library-feed.ts';

/**
 * 术语表与品牌库的镜像（`library` 主题，架构设计 §5.9）：两个库的条目概要，按名字排（与 Runtime 的 `library.list` 同序）。
 * 只有列表；颜色值、术语与文件要用 `library.get` 取详情。快照到之前 `ready` 为 false。
 * 主题只订阅一次，经 `library-feed` 分给各个库的镜像（音色在 `voices-store`）。
 */
export interface LibraryStore {
  ready: boolean;
  glossaries: LibraryEntrySummary[];
  brand: LibraryEntrySummary[];
}

export const useLibrary = create<LibraryStore>()(() => ({ ready: false, glossaries: [], brand: [] }));

const byName = (a: LibraryEntrySummary, b: LibraryEntrySummary) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function pick(entries: readonly LibraryEntrySummary[], library: LibraryName): LibraryEntrySummary[] {
  return entries.filter((entry) => entry.library === library).sort(byName);
}

onLibraryEntries((entries) => {
  useLibrary.setState({ ready: true, glossaries: pick(entries, 'glossaries'), brand: pick(entries, 'brand') });
});
