import type { BrandContent, LibraryEntry, LibraryEntrySummary } from '@baocut/protocol';
import { isDynamicSticker } from '../../model/library-brand.ts';
import { useBrandEntries } from './use-brand-entries.ts';

export interface BrandSticker {
  summary: LibraryEntrySummary;
  entry: LibraryEntry;
  /** 进「动态贴纸」那一页（Lottie）；否则进「贴纸」那一页。 */
  dynamic: boolean;
}

const pickSticker = (summary: LibraryEntrySummary, entry: LibraryEntry): BrandSticker | null => {
  const content = entry.content as BrandContent;
  return content.kind === 'sticker' ? { summary, entry, dynamic: isDynamicSticker(content) } : null;
};
const stickerId = (sticker: BrandSticker) => sticker.summary.id;

/**
 * 品牌库里的贴纸（元素页的「我的贴纸」）：摘要里没有文件类型，分不出图片与 Lottie，逐条读出来（按版本缓存）。
 * 读不出来的那条不摆。`ready` 之前别说「还没有」：库的快照或条目还在路上。次序同品牌页（按名字）。
 */
export function useBrandStickers(): { ready: boolean; stickers: BrandSticker[] } {
  const { ready, items } = useBrandEntries('sticker', pickSticker, stickerId);
  return { ready, stickers: items };
}
