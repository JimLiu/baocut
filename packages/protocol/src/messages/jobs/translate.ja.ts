import type { JobsTranslateMessages } from './translate.ts';

export const ja: JobsTranslateMessages = {
  label: '翻訳',
  description:
    '動画内の文字起こしを文ごとに別の言語へ翻訳し、結果を新しい翻訳ドキュメントとして書き込みます。テキストモデルが処理し、Agent は起動しません。',
  stepFreezeSource: '原文の読み取り',
  stepTranslate: '翻訳',
  stepAssemble: '翻訳の組み立て',
  stepWrite: '動画への書き込み',
  videoNotOpen: '動画が開かれていません',
  noStructuredOutput: (p: { model: string }) => `モデル ${p.model} は構造化出力に対応していないため、翻訳には使用できません`,
  workerMismatch: 'Speech Worker の翻訳が固定した原文と一致しません',
  targetLanguageInvalid: 'パラメータ targetLanguage は BCP 47 言語タグである必要があります',
  flagInvalid: (p: { key: string }) => `パラメータ ${p.key} は true または false である必要があります`,
  bilingualNeedsCaptions: 'パラメータ bilingual は captions が true（字幕レイヤーを追加する）の場合にのみ指定できます',
  noDocument: (p: { documentId: string }) => `動画にドキュメント ${p.documentId} がありません`,
  notSpeech: (p: { documentId: string; kind: string }) =>
    `ドキュメント ${p.documentId} は ${p.kind} です。翻訳できるのは文字起こし（speech）だけです`,
  noTranscript: '動画に文字起こしがありません。翻訳する前に文字起こししてください。',
  multipleTranscripts: '動画に文字起こしが複数あります。documentId で翻訳するものを選んでください。',
  videoClosed: '動画が閉じられました',
  sourceGone: '元のドキュメントはもう動画内にありません',
  noSentences: '文字起こしに翻訳する文がありません',
  sameLanguage: (p: { source: string; target: string }) =>
    `文字起こしの言語 ${p.source} が対象言語 ${p.target} と同じため、翻訳は不要です`,
  workerMissing: 'Speech Worker（speech-worker）が見つかりませんでした。先に npm run build:engine を実行してください。',
  documentName: (p: { language: string }) => `翻訳 ${p.language}`,
  videoClosedKept: '動画が閉じられました。翻訳は生成物に残してあります。',
  sourceChanged:
    '翻訳中に元のドキュメントが変更されたため、動画には何も書き込みませんでした。再試行すると、元のドキュメントの現在のバージョンを翻訳します。',
  transactionLabel: (p: { language: string }) => `${p.language} に翻訳`,
  noDocumentId: '翻訳は動画に書き込まれましたが、ドキュメント ID が返されませんでした',
  rejected: '動画に書き込むトランザクションが拒否されました。翻訳は生成物に残してあります。',
};
