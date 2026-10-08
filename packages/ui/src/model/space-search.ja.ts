import type { SpaceSearchMessages } from './space-search.ts';

export const ja: SpaceSearchMessages = {
  documentKind: { speech: '文字起こし', caption: '字幕', translation: '翻訳', chapter: 'チャプター' },
  pendingVideos: (count: number) =>
    `${count} 本の動画のコンテンツインデックスの更新が終わっていません。結果に一部の動画が含まれていないか、古い可能性があります`,
  indexUpdating: 'コンテンツインデックスを更新中です。結果が古い可能性があります',
  truncated: (count: number) => `一致する項目が多すぎるため、最初の ${count} 件だけを表示しています`,
  notes: (notes: readonly string[]) => `${notes.join('。')}。`,
  sourceTime: (clock: string) => `素材の時間 ${clock}`,
};
