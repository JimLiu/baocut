import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const ja: SettingDescriptionMessages = {
  'agent.defaultDriver': '新しいセッションで使う Agent。null は組み込みの既定（codex）。セッション作成時に固定されます',
  'agent.defaultModel': '新しいセッションのモデル。null は推奨モデル（Claude Code は Sonnet、Codex は -sol 系）、__agent-default__ はモデルを指定せず Agent 自身の CLI 設定に従う',
  'agent.defaultEffort': '新しいセッションの推論の強さ。null は Agent 自身の既定値',
  'agent.defaultAccessMode':
    'アクセスモードを一度も切り替えていないセッションで使用：ask、autoAcceptEdits、auto、fullAccess、plan のいずれか（旧値の controlled と authorized はそれぞれ ask と fullAccess として扱います）',
  'ui.language': `インターフェイスの言語：system はシステムの言語に従います（対応する言語がない場合は英語）。または言語コード（${LOCALES.join('、')}）。Runtime が表示するテキストにも使われます`,
  'captions.maxLineLength': '自動改行の目標行長（文字数）：cjk は中国語・日本語・韓国語の文字、other はそれ以外の文字',
  'transcribe.afterComplete': '文字起こしの完了後：open-video は動画を開く、notify は通知のみ、nothing は何もしない',
  'downloads.directory':
    '既定の保存先：動画のないツールの結果、リンクからダウンロードしたメディア、downloads_save で渡されたファイルをここに置きます（絶対パス）。null は、プロジェクトに関係なくこのホストの ~/Downloads を使います',
  'models.downloadEndpoint':
    'ローカルモデルのダウンロード元（ミラーのベース URL、http(s)://）。null は公開モデルハブ。環境変数 BAOCUT_MODELS_ENDPOINT が優先されます',
  'models.dir':
    'ローカルモデルを置くフォルダ（絶対パス）。null はデータフォルダ内の models。環境変数 BAOCUT_MODELS_DIR が優先されます。変更には settings set ではなく models.setDir を使います',
  'tools.downloadEndpoint':
    '管理対象の外部ツール（yt-dlp）のダウンロード元（ミラーのベース URL、http(s)://、ファイルは <ベース>/<ツール>/<バージョン>/<ファイル名>）。null は公式のリリース URL。環境変数 BAOCUT_TOOLS_ENDPOINT が優先されます',
  'fonts.autoDownload':
    '組版に必要で、このコンピュータになく、フォントカタログにあるフォントを自動でダウンロードします（プレビューと書き出し）。オフの場合は代替フォントで描画し、通知を表示します',
  'fonts.cssEndpoint': 'フォント CSS API のベース URL（ミラー、https://）。null は https://fonts.googleapis.com',
  'fonts.fileEndpoint': 'フォントファイルのベース URL（ミラー、https://。ファイルはこの配下からのみ取得）。null は https://fonts.gstatic.com',
  'space.trashRetentionDays':
    'Space のゴミ箱に項目を保持する日数（1〜3650）：これより古い、参照されていない項目と削除された動画は定期的に完全に削除されます',
  'cache.maxSizeMiB': 'データフォルダのキャッシュの上限サイズ（MiB、256–1048576）：超えると古いキャッシュファイル（素材の解析、再生用の変換）から削除し、上限の 90% まで下げます。動画をまたぐ検索インデックスは削除しません',
  'resources.capacity':
    '詳細：リソースのスケジューリングに使うマシンの容量 { memoryMiB, gpuMemoryMiB, cpuThreads }。null にした項目は自動で検出します。null はすべて自動検出（メモリと CPU はシステムから取得し、Apple シリコンの GPU メモリはユニファイドメモリから推定）',
  'runtime.idleExitMinutes':
    'CLI が起動した Runtime が、アイドル状態が何分続いたら自動で終了するか（1〜1440）：接続なし、タスクなし、開いている外部サービスなしの状態。デスクトップアプリと手動で起動した Runtime には影響しません',
  'updates.autoCheck': 'アプリの更新を自動で確認',
  'updates.autoDownload': '新しいバージョンをバックグラウンドでダウンロード（自動ではインストールしません）',
  'diagnostics.enabled': '匿名の使用統計とパフォーマンスの概要を送信（メディア、テキスト、パスは含みません）',
  'offline.strict': '厳格なオフライン：オンラインサービスに何も送信しません',
};
