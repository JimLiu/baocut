import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const zhHans: JobsCaptionLayerMessages = {
  label: '建立字幕层',
  noSource: '没有要建字幕层的文档',
  videoClosed: '视频已经关闭，没有建立字幕层：打开视频之后重试',
  empty: '文档里没有可以显示的字幕条：没有建立字幕层',
  notOnTimeline: '时间线上没有取用这个素材的片段：字幕投不到画面上，没有建立字幕层',
  noDocumentId: '建立字幕层之后没有拿到文档 ID',
  rejected: '建立字幕层的事务被拒绝',
  documentGone: '要建字幕层的文档已经不在视频里',
  needsOutputStore: '读 Worker 的字幕条要产物库',
  notSpeech: '文档不是转写',
  speechUnreadable: '转写的正文读不了',
  translationUnreadable: '译文的正文读不了',
  unaligned: (p: { count: number }) => `译文有 ${p.count} 个单元没有对齐（alignment 为 null），切不出它们的时间`,
  noSourceSpeech: '译文找不到它译自的转写',
  subtitlesName: '字幕',
  translationName: '译文',
  styleName: '字幕样式',
};
