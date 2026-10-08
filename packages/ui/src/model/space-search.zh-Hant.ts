import type { SpaceSearchMessages } from './space-search.ts';

export const zhHant: SpaceSearchMessages = {
  documentKind: { speech: '逐字稿', caption: '字幕', translation: '譯文', chapter: '章節' },
  pendingVideos: (count: number) => `還有 ${count} 部影片的內容索引尚未更新完成，結果可能缺少部分影片或不是最新內容`,
  indexUpdating: '內容索引正在更新，結果可能不是最新內容',
  truncated: (count: number) => `符合的結果太多，只顯示前 ${count} 筆`,
  notes: (notes: readonly string[]) => `${notes.join('；')}。`,
  sourceTime: (clock: string) => `素材時間 ${clock}`,
};
