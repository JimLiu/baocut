import { create } from 'zustand';
import type { LibraryEntrySummary } from '@baocut/protocol';
import { onLibraryEntries } from './library-feed.ts';

/** 我的声音：用户库里 `voices` 的条目（摘要），按名字排。完整内容（逐字稿、语言、授权声明）按需 `library.get`。 */
export interface VoicesStore {
  ready: boolean;
  voices: LibraryEntrySummary[];
}

export const useVoices = create<VoicesStore>()(() => ({ ready: false, voices: [] }));

onLibraryEntries((entries) => {
  const voices = entries.filter((e) => e.library === 'voices').sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
  useVoices.setState({ ready: true, voices });
});
