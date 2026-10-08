import type { ModelsInstallMessages } from './models-install-copy.ts';

const KEEP = 'ダウンロード済みの部分は保持され、次回はその続きからダウンロードします。';
const SOURCE = '「設定 › 一般」の「モデルのダウンロード元」';

export const ja: ModelsInstallMessages = {
  planSize: (size) => `${size} をダウンロード`,
  planSizeEstimate: (size) => `約 ${size}（サイズ不明のファイルがあるため、登録されている見積もりを使用）`,
  amountEstimate: (size) => `約 ${size}`,
  noSpace: (need, have) =>
    `ディスクの空き容量が足りません：${need} 必要ですが、モデルフォルダのあるディスクの空きは ${have} しかありません。空き容量を確保してからダウンロードしてください。`,
  resumed: (size) => `前回ダウンロード済みの ${size} はそのまま使い、再ダウンロードしません。`,
  space: (size) => `ディスクの空き ${size}`,
  lineKeep: 'インストール済み。そのままにします',
  lineSize: (size, count) => `${size} · ファイル ${count} 個`,
  lineUnknown: (count) => `サイズ不明 · ファイル ${count} 個`,
  queued: 'ダウンロード待機中',
  downloading: (amount) => `${amount} をダウンロード中`,
  downloadingUnknown: (amount) => `ダウンロード中 · ${amount} 受信済み`,
  verifying: '検証して公開中',
  pausedKept: (amount) => `一時停止中 · ${amount} は保持済み。再開すると続きからダウンロードします`,
  paused: '一時停止中',
  remedyNoSpace: (need, have) =>
    `${need !== null && have !== null ? `${need} 必要ですが、空きは ${have} しかありません。` : ''}ディスクの空き容量を確保してから、もう一度ダウンロードしてください。${KEEP}`,
  remedyNetwork: `ネットワークを確認してから、もう一度ダウンロードしてください。${KEEP}既定のダウンロード元に接続できない場合は、${SOURCE}でミラーに切り替えてください。`,
  remedyIntegrity: `ダウンロード元のファイルがマニフェストのサイズまたは sha256 と一致しなかったため、不正なファイルを削除しました。別のダウンロード元（${SOURCE}）に切り替えてから、もう一度ダウンロードしてください。`,
  remedySource: `ダウンロード元にこのファイルがないか、アクセスが拒否されました。${SOURCE}（または環境変数 BAOCUT_MODELS_ENDPOINT）で設定したミラーが完全かどうかを確認してください。`,
  remedyManifest: 'このモデルパッケージの内蔵マニフェストに信頼できる sha256 がないため、BaoCut が更新されるまでインストールできません。',
  remedyOffline: '厳格オフラインモードがオンのため、何もダウンロードしません。ダウンロードするには、先に設定で厳格オフラインモードをオフにしてください。',
  remedySizeChanged: 'ダウンロードサイズが変わりました。新しい内容でもう一度確認してください。',
  remedyInUse:
    'タスクがこのモデルパッケージを使用中です（文字起こし、合成、確認、インストールのいずれか）。終わるのを待つか、バックグラウンドタスクでキャンセルしてから、もう一度削除してください。',
  remedyUnavailable:
    'モデルパッケージは現在使用できません（インストールが不完全、無効になっている、またはこのコンピュータで非対応）。先に修復するか、もう一度有効にしてください。',
  remedyInstallFailed: `もう一度ダウンロードしてみてください。${KEEP}`,
  problemText: (message, remedy) =>
    /[。！？]$/.test(message) ? `${message}${remedy}` : /[.!?]$/.test(message) ? `${message} ${remedy}` : `${message}。${remedy}`,
  removalBody: (unknown, frees, kept) =>
    [
      unknown ? 'このモデルパッケージだけが使うファイルを削除します。' : frees !== null ? `約 ${frees} の空きができます。` : null,
      ...kept.map((k) => `${k.repo} は ${k.usedBy.join('、')} がまだ使用しているため残します。`),
      'もう一度使うには、再ダウンロードが必要です。',
    ]
      .filter(Boolean)
      .join(''),
  removed: (bundleId) => `${bundleId} を削除しました`,
  removedKept: (bundleId, repos) => `${bundleId} を削除しました · ${repos.join('、')} はほかのモデルパッケージがまだ使用しているため残しました`,
};
