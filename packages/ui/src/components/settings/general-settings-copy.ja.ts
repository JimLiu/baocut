import type { GeneralSettingsMessages } from './general-settings-copy.ts';

export const ja: GeneralSettingsMessages = {
  interfaceGroup: 'インターフェイス',
  language: '言語',
  languageDesc: 'すぐに反映され、再起動は不要です。',
  languageSystem: (current: string) => `システム（${current}）`,
  appearance: '外観',
  appearanceDesc: 'このコンピュータの BaoCut ウインドウにだけ適用されます。',
  schemeSystem: 'システム',
  schemeLight: 'ライト',
  schemeDark: 'ダーク',

  saveFailed: (message: string) => `保存できませんでした：${message}`,

  editingGroup: '編集と文字起こし',
  autoOpen: '文字起こしの後に動画を自動で開く',
  autoOpenDesc: 'ローカルからの読み込みが対象です。リンクからの読み込みがバックグラウンドで完了したときは通知だけで、表示中のページはそのままです。',
  autoOpenNote: 'この設定はまだ機能しません：現在は文字起こしの後も表示中のページのままで、動画は自動で開きません。',
  lineLength: '字幕の行の長さ',
  lineLengthDesc: '自動改行の目標の長さを設定します。手動で編集した行には影響しません。',
  lineLengthNote: (maxChars: number, custom: string | null) =>
    `この設定はまだ機能しません：現在、自動改行は 1 行あたり半角 ${maxChars} 文字分に固定されています（全角文字は 1 文字を半角 2 文字分として数えます）。${custom ? `保存されている値はカスタム値（${custom}）です。` : ''}`,
  cueShading: '文字起こしで字幕の範囲を網掛け',
  cueShadingDesc: '字幕ごとの範囲を薄く網掛けして、どこで区切られているかがわかるようにします。',
  cueShadingNote: 'まだ実装されていません：文字起こしでは字幕の範囲は網掛けされません。',

  downloadsGroup: 'ダウンロードと更新',
  autoUpdateOn: '更新の自動確認とダウンロードをオンにしました',
  autoUpdateOff: '更新の自動ダウンロードをオフにしました',
  downloader: '動画ダウンロードツール',
  downloaderWeb: 'ブラウザではこのコンピュータのダウンロードツールを確認しません。BaoCut デスクトップアプリで確認してください。',
  checking: '確認中…',
  checkFailed: (message: string) => `確認できませんでした：${message}`,
  checkAgain: '再確認',

  sourcesGroup: 'ダウンロード元とオフライン',
  modelsEndpoint: 'モデルのダウンロード元',
  modelsEndpointDesc:
    'ローカルモデルはここからダウンロードされます。空欄にすると公開モデルハブ（Hugging Face）を使用します。接続できない場合は、ミラーのベース URL を入力してください。環境変数 BAOCUT_MODELS_ENDPOINT が設定されている場合はそちらが優先されます。',
  toolsEndpoint: 'ツールのダウンロード元',
  toolsEndpointDesc:
    'yt-dlp などの外部ツールは、ここから「ベース URL/ツール/バージョン/ファイル名」の形でダウンロードされます。空欄にすると公式のリリース URL を使用します。環境変数 BAOCUT_TOOLS_ENDPOINT が設定されている場合はそちらが優先されます。',
  toolsEndpointPlaceholder: '公式のリリース URL',
  strictOffline: '厳格オフライン',
  strictOfflineDesc:
    'オンにすると、モデルと外部ツールをダウンロードせず、リンクから動画もダウンロードしません。クラウドモデルと Agent エンジンがオンラインに接続するかどうかには影響しません。',
  strictOfflineOn: '厳格オフラインをオンにしました',
  strictOfflineOff: '厳格オフラインをオフにしました',
  endpointChanged: (endpoint: string) => `${endpoint} を使用します`,
  endpointReset: (label: string) => `${label} を既定に戻しました`,
  save: '保存',
  resetDefault: '既定に戻す',

  trashDays: 'ゴミ箱の保持日数',
  trashDaysDesc: (fallback: number | null) =>
    `ゴミ箱に入れてからこの日数を過ぎ、どこからも参照されていない項目と、削除した動画は完全に削除されます（起動時とその後 6 時間ごとに確認）。まだ参照されている項目は残ります。空欄にすると既定値${fallback ? `の ${fallback} 日` : ''}に戻ります。`,
};
