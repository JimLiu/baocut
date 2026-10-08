import type { ToolOutputsMessages } from './tool-outputs.ts';

export const zhHans: ToolOutputsMessages = {
  actionLabel: { 'open-movie': '打开编辑', 'new-movie': '以此新建视频' },
  blockTextOnly: '文稿与字幕要配上视频或音频才能新建视频，这一版还不能从这里做',
  blockTrashed: '回收站里的条目要先恢复',
  blockGenerating: '还在生成，完成后才能用',
  blockMissing: '找不到这个结果在本机的文件',
  handover: {
    subtitle: '把这份字幕翻译成英文，保持时间码不变。',
    document: '根据这份文稿写一篇摘要。',
    audio: '用这段音频做一个视频。',
    image: '以这张图片为封面做一个视频。',
    'video-file': '给这个视频加上字幕。',
    export: '给这个视频加上字幕。',
    video: '继续修改这个视频。',
  },
  handoverDefault: '接着处理这个结果。',
};
