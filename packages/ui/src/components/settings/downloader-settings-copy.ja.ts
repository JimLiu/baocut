import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const ja: DownloaderSettingsMessages = {
  lead: 'リンクからの動画のダウンロードには yt-dlp を使います。「動画をダウンロード」、リンクからの文字起こし、Agent はすべてここの設定でダウンロードします。',
  toolGroup: 'ダウンロードツール',
  cookiesLead: 'ダウンロード時にブラウザのサインイン状態を使うので、サインインが必要な動画もダウンロードできます。既定では検出されたすべてのブラウザを使います。',
  autoUpdate: "yt-dlp を自動更新",
  autoUpdateDesc:
    "新しい安定版を 1 日 1 回確認します。新しい版があれば、チェックサムを照合してから BaoCut がダウンロードしたものを置き換えます。置き換えが終わるまでは今のものでダウンロードできます。自分でインストールした yt-dlp は変更されません。",
  autoUpdateChecked: (when: string, version: string) => `前回の確認：${when} · 最新バージョン ${version}`,
};
