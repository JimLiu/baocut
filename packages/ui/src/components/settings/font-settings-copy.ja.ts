import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const ja: FontSettingsMessages = {
  lead: (total: number | null) =>
    `フォントの入手元は 3 つあります。アプリに付属するもの、このコンピュータにインストールされているもの、Google Fonts ディレクトリのもの（${total === null ? '約 2000' : `約 ${total.toLocaleString(intlLocale())}`} ファミリー、オープンソースライセンス、必要に応じてダウンロード）です。ダウンロード時に送信されるのはファミリー名とウェイトだけで、アカウントは不要です。フォントは動画フォルダではなく、アプリのデータに保存されます。`,
  download: 'ダウンロード',
  autoDownload: 'フォントを自動でダウンロード',
  autoDownloadDesc:
    'プレビュー、動画を開くとき、書き出しで、このコンピュータにないフォントが必要になると Google Fonts からダウンロードします。オフにすると、表示と書き出しにはまず代替フォントが使われます。フォントを選ぶときに手動でダウンロードすることもできます。厳格オフラインでは何もダウンロードしません。',
  cssEndpoint: 'スタイルシートの URL',
  cssEndpointDesc: 'ミラーのベース URL。空欄にすると https://fonts.googleapis.com を使用します。',
  fileEndpoint: 'フォントファイルの URL',
  fileEndpointDesc: 'フォントファイルはこの URL 以下からのみ取得します。空欄にすると https://fonts.gstatic.com を使用します。',
  downloaded: 'ダウンロード済みのフォント',
  summary: (families: number, size: string) => `${families} ファミリー · ${size}`,
  none: 'まだありません',
  clearAll: 'すべて消去',
  empty: 'フォントを選ぶときにダウンロードしたフォントや、動画を開くときや書き出し時に自動でダウンロードしたフォントがここに表示されます。',
  clearTitle: 'ダウンロードしたフォントを消去しますか？',
  clear: '消去',
  cancel: 'キャンセル',
  removed: (family: string, size: string) => `「${family}」を削除しました · ${size} を解放`,
  inUseTip: '完了していない書き出しで使用中です。書き出しが終わってから削除してください',
  removeTip: 'このフォントのダウンロード済みファイルを削除',
  removeLabel: (tip: string, family: string) => `${tip}：${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) =>
    `ウェイト ${weights} · ${size} · ${licence}${ago ? ` · ${ago} にダウンロード` : ''}`,
  inUse: '書き出しで使用中',
};
