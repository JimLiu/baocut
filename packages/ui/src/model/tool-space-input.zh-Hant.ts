import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const zhHant: ToolSpaceInputMessages = {
  reasons: {
    trashed: '在垃圾桶中',
    generating: '仍在生成中，完成後才能選擇',
    missing: '檔案遺失，請重新連結後再選擇',
    failed: '上次生成失敗',
    textOnly: '只能讀取 .txt、.md 文件的文字',
    subtitleOnly: '只接受 .srt、.vtt 字幕',
    noPath: '這個項目在這台電腦上沒有檔案；新影片必須從本機檔案開始',
  },
  joinKinds: (labels) => labels.join('、'),
};
