import type { VoicesLibraryMessages } from './voices-library-copy.ts';

export const ja: VoicesLibraryMessages = {
  consentStatement: '自分自身の声である、または話者本人の許可を得ています',
  uploading: (label) => `${label} にアップロード中…`,
  noConsent: '本人の声、または許可を得た声として明記されていないため、第三者にはアップロードしません。先に「編集」で申告にチェックを入れてください。',
  cannotClone: (label) => `この Runtime では ${label} でクローンできません`,
  providerOff: (label, detail) => `${label} は現在使用できません${detail ? `（${detail}）` : ''}：先に「クラウドモデル」で有効にしてキーを設定してください`,
  consentUnstated: '同意の申告なし',
  cloned: (label) => `${label} でクローン済み`,
  cloneStale: (label) => `${label} のクローンが古くなっています`,
  languageUnknown: '言語未指定',
  recorded: 'アプリで録音',
  imported: 'ファイルから読み込み',
  edited: (ago) => `${ago}に編集`,
  nameRequired: '声に名前を付けてください',
  nameTooLong: (max) => `名前は最大 ${max} 文字までです`,
  transcriptTooLong: (max) => `文字起こしは最大 ${max} 文字までです`,
  dontKnow: '不明',
  deleteClones: (labels) => `先に ${labels.join('、')} 上のクローンを削除します。削除できなかった場合、声は残ります。`,
  deleteBody: (clones) => `この声を使っている動画は、次に生成するときに既定の声に戻ります。生成済みの吹き替えには影響しません。${clones}`,
  uploadNotice: (name, size, label) =>
    `「${name}」の参照録音${size ? `（${size}）` : ''}を ${label} にアップロードしてクローンを作成します。以後、${label} でこの声を使うときは相手の声の ID をそのまま使います。声を削除すると、先にこのクローンを削除します。`,
  withRemedy: (message, remedy) => `${message.replace(/[。.]$/, '')}。${remedy}`,
  remedyConsent: '本人の申告がない声は第三者にアップロードされません：先に「編集」で申告にチェックを入れてください。',
  remedyConfigure: '「クラウドモデル」でこのプロバイダを有効にし、キーを設定してください。',
  remedyConflict: 'この声は別の場所で変更されたばかりです。下に最新の内容を表示しています。確認してから保存してください。',
  remedyGrant: '参照録音をプロバイダに送るには送信許可が必要です：設定で許可を発行してから再試行してください。',
};
