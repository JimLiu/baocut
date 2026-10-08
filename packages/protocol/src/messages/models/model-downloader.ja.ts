import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const ja: ModelsModelDownloaderMessages = {
  remedyNoSpace:
    'モデルフォルダがあるディスクの空き容量が不足しています。十分な空き容量を確保して（または設定でモデルフォルダを別のディスクに移して）から、もう一度インストールしてください',
  remedyNetwork:
    'ネットワークに接続できないか、ダウンロードが中断されました。ネットワークを確認してもう一度インストールしてください。ダウンロード済みの分は続きから再開します。「設定 › 一般」の「モデルのダウンロード元」でミラーを切り替えることもできます',
  remedyIntegrity:
    'ダウンロードしたファイルのサイズまたは sha256 がマニフェストと一致しません（ダウンロード元またはミラーの内容が正しくありません）。不正なファイルは削除しました。別のダウンロード元に切り替えて、もう一度インストールしてください',
  remedySource:
    'ダウンロード元にこのファイルがないか、アクセスが拒否されました。「設定 › 一般」の「モデルのダウンロード元」（または環境変数 BAOCUT_MODELS_ENDPOINT）で指定したミラーにファイルが揃っているか確認してください',
  remedyManifestIncomplete:
    'このモデルバンドルの内蔵マニフェストには信頼できる sha256 がないため、インストールできません。BaoCut の更新をお待ちください',
  downloadFailed: (p: { file: string; reason: string }) => `${p.file} をダウンロードできませんでした：${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} のサイズまたは sha256 がマニフェストと一致しません`,
  sourceHttp: (p: { file: string; status: number }) => `ダウンロード元が ${p.file} に対して HTTP ${p.status} を返しました`,
  diskFull: 'モデルファイルの書き込み中にディスクがいっぱいになりました',
};
