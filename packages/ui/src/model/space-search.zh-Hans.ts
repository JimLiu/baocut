import type { SpaceSearchMessages } from './space-search.ts';

export const zhHans: SpaceSearchMessages = {
  documentKind: { speech: '转录', caption: '字幕', translation: '译文', chapter: '章节' },
  pendingVideos: (count: number) => `还有 ${count} 个视频的内容索引没有更新完，结果可能缺视频或是旧版本的`,
  indexUpdating: '内容索引正在更新，结果可能是旧版本的',
  truncated: (count: number) => `命中太多，只列出前 ${count} 条`,
  notes: (notes: readonly string[]) => `${notes.join('；')}。`,
  sourceTime: (clock: string) => `素材时间 ${clock}`,
};
