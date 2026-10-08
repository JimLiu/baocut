import type { ToolOutputsMessages } from './tool-outputs.ts';

export const zhHant: ToolOutputsMessages = {
  actionLabel: { 'open-movie': '在編輯器中開啟', 'new-movie': '以此建立新影片' },
  blockTextOnly: '逐字稿與字幕需要搭配影片或音訊檔才能建立新影片，目前還無法從這裡建立',
  blockTrashed: '請先從垃圾桶回復這個項目',
  blockGenerating: '仍在生成中，完成後才能使用',
  blockMissing: '在這台電腦上找不到這個結果的檔案',
  handover: {
    subtitle: '把這份字幕翻譯成另一種語言，時間碼保持不變。',
    document: '為這份逐字稿寫一篇摘要。',
    audio: '用這段音訊製作一部影片。',
    image: '以這張圖片為封面製作一部影片。',
    'video-file': '為這部影片加上字幕。',
    export: '為這部影片加上字幕。',
    video: '繼續修改這部影片。',
  },
  handoverDefault: '繼續處理這個結果。',
};
