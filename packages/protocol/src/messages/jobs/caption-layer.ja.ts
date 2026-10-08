import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const ja: JobsCaptionLayerMessages = {
  label: '字幕レイヤーを追加',
  noSource: '字幕レイヤーを追加するドキュメントがありません',
  videoClosed: '動画が閉じられたため、字幕レイヤーは追加されませんでした。動画を開いてから再試行してください。',
  empty: 'ドキュメントに表示できる字幕がないため、字幕レイヤーは追加されませんでした',
  notOnTimeline: 'タイムライン上にこの素材を使うクリップがないため、字幕を画面に表示できません。字幕レイヤーは追加されませんでした。',
  noDocumentId: '字幕レイヤーは追加されましたが、ドキュメント ID が返されませんでした',
  rejected: '字幕レイヤーを追加するトランザクションが拒否されました',
  documentGone: '字幕レイヤーのドキュメントはもう動画内にありません',
  needsOutputStore: 'Speech Worker の字幕を読み取るには生成物ストアが必要です',
  notSpeech: 'ドキュメントは文字起こしではありません',
  speechUnreadable: '文字起こしの本文を読み取れませんでした',
  translationUnreadable: '翻訳の本文を読み取れませんでした',
  unaligned: (p: { count: number }) =>
    `${p.count} 個の翻訳ユニットが対応付けられていないため（alignment が null）、タイミングを算出できません`,
  noSourceSpeech: 'この翻訳の元になった文字起こしが見つかりませんでした',
  subtitlesName: '字幕',
  translationName: '翻訳',
  styleName: '字幕スタイル',
};
