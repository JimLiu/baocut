import type { JobsSpeakersMessages } from './speakers.ts';

export const ja: JobsSpeakersMessages = {
  label: '話者を識別',
  description:
    '動画内の既存の文字起こしについて、声から話者を区別します（ローカルモデルを使用し、文字起こしはやり直しません）。結果は提案として示され、確認後に edits.applySpeakers で適用します。',
  stepDiarize: '話者分離',
  stepPropose: '結果の整理',
  videoNotOpen: '動画が開かれていません',
  notFromAsset: 'この文字起こしは動画内の素材に属していないため、声で話者を区別できません',
  modelMissing: 'このコンピュータには話者分離モデルがありません',
  modelNotInstalled: '話者分離モデルがまだインストールされていません。先にダウンロードしてください。',
  transcriptUnreadable: '文字起こしを読み取れませんでした',
  videoClosed: '動画が閉じられました',
  transcriptGone: '文字起こしはもう動画内にありません',
  noWords: '文字起こしに単語がありません',
  untimedWords: '文字起こしにタイミングのない単語があるため、声で話者を区別できません',
  sourceMissing: '素材のソースファイルが見つかりませんでした',
  hashMismatch: 'speakers.json のハッシュが Worker の報告と一致しません',
  wordCountMismatch: 'speakers.json と文字起こしの単語数が一致しません',
  transcriptChanged: '話者の識別後に文字起こしが変更されました。もう一度話者を識別してください。',
  translationChanged: '話者の識別後に翻訳が変更されました。もう一度話者を識別してください。',
  unknownSpeaker: 'この話者は提案に含まれていません',
  nameInvalid: (p: { max: number }) => `話者名は空にできず、${p.max} 文字以内である必要があります`,
  applyFailed: '提案を適用できませんでした',
};
