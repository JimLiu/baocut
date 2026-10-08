import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const ja: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `実行可能な yt-dlp が見つかりません（${p.code}）`,
  remedyUnsupported:
    'ダウンロードツールはこのリンクに対応していません：動画ページそのもののリンクを使用してください（再生リスト、ライブ配信、検索ページは不可）',
  remedyLoginRequired:
    'ブラウザでサイトにサインインしてから、「Web サイトへのサインイン」でそのブラウザにチェックを入れて、もう一度ダウンロードしてください',
  remedyCookiesUnavailable:
    'ブラウザの Cookie を読み取れません：ブラウザでサインインしていることを確認してください。データベースが使用中の場合は、ブラウザを完全に終了してください（バックグラウンドのプロセスも含む）。キーチェーンへのアクセスが拒否された場合は許可してください。Safari にはフルディスクアクセスが必要です。Windows では、Chrome、Edge、Brave がアプリバインド暗号化で保護している Cookie を yt-dlp が読み取れないため、Firefox を使用してください。または、別のブラウザを試してください',
  remedyToolUpdateRequired: 'サイトの解析に失敗したか、ツールが古くなっています：yt-dlp を更新し、再検出してから再試行してください',
  remedyUnavailable: '動画を利用できません（削除済み、地域制限、またはダウンロード可能な形式がありません）',
  remedyNetworkError: '接続できないか、ダウンロードが中断されました：ネットワークを確認して再試行してください（ダウンロード済みの部分から再開します）',
  remedyDiskFull:
    'ダウンロードフォルダまたは Runtime Home のあるディスクの空き容量が不足しています：空き容量を確保してから再試行してください',
  remedyDownloadFailed:
    'ダウンロードツールがエラーを報告しました：details.stderr を確認してください。yt-dlp の更新が必要な場合があります（baocut external-tools detect）',
  exited: (p: { code: number | null }) => `yt-dlp がコード ${p.code} で終了しました`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}：サイトでまだサインインが必要です`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}：Cookie を読み取れません`,
  reasonSeparator: '、',
  cookieAttemptsFailed: (p: { count: number; reasons: string }) =>
    `${p.count} 個のブラウザの Cookie を試しましたが、いずれもうまくいきませんでした（${p.reasons}）`,
  metadataUnreadable: 'ダウンロードツールのメタデータを読み取れません',
  metadataNotObject: 'ダウンロードツールのメタデータがオブジェクトではありません',
  playlist: 'リンクは再生リストです。動画は 1 本ずつ読み込んでください',
  live: 'ライブ配信は読み込めません',
};
