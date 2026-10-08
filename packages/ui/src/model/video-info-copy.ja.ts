import type { VideoInfoMessages } from './video-info-copy.ts';

export const ja: VideoInfoMessages = {
  section: { media: 'ソースとメディア', source: 'ソース情報' },
  speakers: (count: number) => `話者 ${count} 人`,
  chapters: (count: number) => `チャプター ${count} 個`,
  paragraphs: (count: number) => `段落 ${count} 個`,
  list: (names: readonly string[]) => names.join('、'),
  sourceKind: {
    'link-import': 'URL から読み込み',
    'user-import': 'ローカルファイル',
    generated: '生成',
    library: 'ユーザライブラリ',
  },
  row: {
    contents: '内容',
    translation: '翻訳',
    location: '場所',
    media: 'メディア',
    transcript: '文字起こし',
    channel: 'チャンネル',
    published: '公開日',
    platform: 'プラットフォーム',
    mediaId: '動画 ID',
    url: 'URL',
  },
};
