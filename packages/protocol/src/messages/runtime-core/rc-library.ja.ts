import type { RcLibraryMessages } from './rc-library.ts';

export const ja: RcLibraryMessages = {
  problemSeparator: '。',
  referenceUndecodable: (p) => `参考録音をデコードできません：${p.problems}`,
  clonesNotReady: '声のクローンはまだ準備ができていません',
  entryHasNoFile: 'このエントリにはファイルがありません',
  notCopyable: (p) =>
    `${p.library === 'glossaries' ? '用語集' : p.library === 'voices' ? '声' : '色'}は動画に直接コピーできません：用語集は文字起こしと翻訳のとき、声は音声合成のとき、色はスタイルの編集のときに選びます`,
  captionItemIdsStyleOnly: 'captionItemIds は字幕スタイルにのみ使えます',
  addFromLibraryLabel: (p) => `ライブラリから「${p.name}」を追加`,
  duplicateGlossaries: (p) => `glossaries.${p.step} に同じ用語集が複数回含まれています`,
  tooManyGlossaries: (p) => `各ステップで使える用語集は最大 ${p.max} 個です`,
  glossaryWrongStep: (p) =>
    `「${p.name}」は${p.transcription ? '文字起こし' : '翻訳'}用の用語集のため、${p.transcribeStep ? '文字起こし' : '翻訳'}には使えません`,
  selectionDocumentName: '使用中のライブラリ項目',
  changeSelectionLabel: '使用中のライブラリ項目を変更',
  adoptDefaultsLabel: 'ライブラリの既定の項目を使用',
  noDocumentIdAfterWrite: '書き込み後にドキュメント ID を取得できませんでした',
  speakerBoundTwice: (p) => `話者 ${p.speakerId} が 2 回割り当てられています`,
  noSuchDocument: (p) => `動画にドキュメント ${p.documentId} はありません`,
  documentNotSpeech: (p) =>
    `ドキュメント ${p.documentId} は ${p.kind} です。話者があるのは文字起こし（speech）のみです`,
  speakerNotInTranscript: (p) => `文字起こし ${p.documentId} に話者 ${p.speakerId} はいません`,
  libraryVoiceNoProvider:
    'ライブラリの声は、吹き替えで選んだプロバイダ上のクローンに置き換えられます：providerId は渡さないでください',
  outputNotFound: '生成物が存在しません',
  pathNotAbsolute: 'ファイルパスは絶対パスにしてください',

  serviceClientNoLibraryVoice: '外部サービスのクライアントはライブラリの声を使用できません',
  clonerNotConfigured: (p) => `${p.label} がオンになっていないか、キーがないため、声をクローンできません`,
  cloneExists: (p) => `声「${p.name}」には ${p.label} 上に有効なクローンがすでにあります`,
  clonePurpose: (p) => `声「${p.name}」をクローン`,
  noClone: 'この声にはこのプロバイダ上のクローンがありません',
  remoteCloneNotDeleted: (p) => `${p.label} 上のクローンを削除できなかったため、記録を残しました：${p.reason}`,
  cloneUnsupported: (p) => `${p.providerId} には声のクローン API がありません（現在提供しているのは ElevenLabs のみ）`,
  cloneVersionGone: 'クローンする声のバージョンはもう存在しません',
  oldCloneNotDeleted: (p) => `置き換えた古いクローン（${p.voiceId}）を ${p.label} から削除できませんでした：${p.reason}`,
};
