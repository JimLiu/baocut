import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const zhHant: JobsCaptionLayerMessages = {
  label: '新增字幕層',
  noSource: '沒有可新增字幕層的文件',
  videoClosed: '影片已關閉，沒有新增字幕層。請開啟影片後重試。',
  empty: '文件中沒有可顯示的字幕，沒有新增字幕層',
  notOnTimeline: '時間軸上沒有片段使用這個素材，字幕無法出現在畫面上。沒有新增字幕層。',
  noDocumentId: '已新增字幕層，但沒有傳回它的文件 ID',
  rejected: '新增字幕層的交易遭到拒絕',
  documentGone: '字幕層對應的文件已不在影片中',
  needsOutputStore: '讀取 Speech Worker 的字幕需要產出庫',
  notSpeech: '這份文件不是逐字稿',
  speechUnreadable: '無法讀取逐字稿內文',
  translationUnreadable: '無法讀取譯文內文',
  unaligned: (p: { count: number }) => `有 ${p.count} 個譯文單元沒有對齊（alignment 為 null），無法推算它們的時間`,
  noSourceSpeech: '找不到這份譯文所依據的逐字稿',
  subtitlesName: '字幕',
  translationName: '譯文',
  styleName: '字幕樣式',
};
