import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const zhHans: ToolSpaceInputMessages = {
  reasons: {
    trashed: '在回收站里',
    generating: '还在生成，完成后才能选',
    missing: '文件找不到了，接回之后再选',
    failed: '上次生成失败了',
    textOnly: '只能读 .txt、.md 文档的文字',
    subtitleOnly: '只收 .srt、.vtt 字幕',
    noPath: '找不到这个条目在本机的文件，新建视频要从本机文件开始',
  },
  joinKinds: (labels) => labels.join('、'),
};
