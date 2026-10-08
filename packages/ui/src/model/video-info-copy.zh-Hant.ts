import type { VideoInfoMessages } from './video-info-copy.ts';

export const zhHant: VideoInfoMessages = {
  section: { media: '來源與媒體', source: '來源資訊' },
  speakers: (count: number) => `${count} 位說話者`,
  chapters: (count: number) => `${count} 個章節`,
  paragraphs: (count: number) => `${count} 段`,
  list: (names: readonly string[]) => names.join('、'),
  sourceKind: {
    'link-import': '從網址匯入',
    'user-import': '本機檔案',
    generated: '生成',
    library: '使用者資料庫',
  },
  row: {
    contents: '內容',
    translation: '譯文',
    location: '位置',
    file: '來源檔案',
    media: '媒體',
    transcript: '轉錄',
    channel: '頻道',
    published: '發布時間',
    platform: '平台',
    mediaId: '影片 ID',
    url: '網址',
    title: '原標題',
    description: '原簡介',
  },
};
