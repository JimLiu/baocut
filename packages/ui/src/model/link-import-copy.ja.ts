import type { LinkImportMessages } from './link-import-copy.ts';

const endSentence = (text: string): string => (/[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`);

const joinSentences = (parts: readonly (string | null | undefined)[]): string =>
  parts
    .filter((p): p is string => !!p?.trim())
    .map(endSentence)
    .join('');

export const ja: LinkImportMessages = {
  title: (name: string | null) => (name ? `リンクから読み込み · ${name}` : 'リンクから読み込み'),

  phase: {
    starting: '準備中',
    probing: 'リンクを読み取り中',
    downloading: '動画をダウンロード中',
    validating: 'ファイルが再生できるか確認中',
    publishing: 'ダウンロードフォルダに移動中',
    applying: '動画を読み込み中',
    transcribing: '文字起こしを開始中',
  },
  phaseFallback: '処理中',
  downloaded: (bytes: string) => `${bytes} ダウンロード済み`,

  stageDownload: '動画をダウンロード',
  stageVideo: 'メディアを確認して動画を作成',
  stageSubs: '字幕を生成',

  issue: {
    TOOL_NOT_INSTALLED: {
      title: '一度準備すれば、あとは貼り付けるだけ',
      body: 'BaoCut がこのサイトを読み取るには、動画ダウンロードツール yt-dlp が必要です。インストールしてから、この読み込みをもう一度始めてください。',
    },
    TOOL_CONSENT_REQUIRED: {
      title: 'ダウンロードツールの使用には同意が必要です',
      body: 'ダウンロードツールはすでにこのコンピュータにあります。BaoCut は同意を得てから、これを使って Web サイトから動画をダウンロードします。',
    },
    TOOL_UNAVAILABLE: {
      title: 'ダウンロードツールを実行できません',
      body: 'ダウンロードツールは見つかりましたが、実行できません。再インストールするか、動作するものを選んでください。',
    },
    TOOL_OUTDATED: {
      title: 'ダウンロードツールの更新が必要です',
      body: 'このバージョンは古すぎて、このサイトを読み取れない可能性があります。更新してから、もう一度試してください。',
    },
    OFFLINE_STRICT: {
      title: '厳格オフラインモードではリンクからダウンロードできません',
      body: '厳格オフラインモードの BaoCut はネットワークに接続しません。先にブラウザで動画をダウンロードしてから、ローカルファイルを選んでください。',
    },
    LINK_UNSUPPORTED: {
      title: 'このソースにはまだ対応していません',
      body: 'ダウンロードツールがこのサイトまたはページを認識できません。動画ページそのもののリンク（プレイリスト、ライブ配信、検索ページは不可）を使うか、ローカルファイルを使ってください。',
    },
    LINK_LOGIN_REQUIRED: {
      title: 'この動画はサインインが必要です',
      body: '先にブラウザでサイトにサインインしてから「動画をダウンロード」に戻り、「Web サイトへのサインイン」でそのブラウザにチェックを入れて、もう一度ダウンロードしてください。',
    },
    LINK_COOKIES_UNAVAILABLE: {
      title: 'ブラウザの Cookie を読み取れませんでした',
      body: 'ブラウザでサインインしていることを確認してください。データベースがロックされている場合は、ブラウザを完全に終了し（バックグラウンドで動いているものも含む）、キーチェーンの権限を確認してください（Safari の場合は「フルディスクアクセス」で BaoCut を許可）。Windows では App-Bound Encryption で保護された Chrome、Edge、Brave の Cookie は読み取れないため、代わりに Firefox にチェックを入れてください。または、別のブラウザにチェックを入れて、もう一度ダウンロードしてください。',
    },
    LINK_TOOL_UPDATE_REQUIRED: {
      title: 'yt-dlp の更新が必要です',
      body: 'サイトの動画の配信方法が変わりました。インストールしたときと同じ方法で yt-dlp を更新し、再確認してから、もう一度試してください。',
    },
    LINK_UNAVAILABLE: {
      title: 'この動画は利用できません',
      body: '動画が削除された、地域制限がある、またはダウンロードできる形式がない可能性があります。別のリンクかローカルファイルを試してください。',
    },
    LINK_NETWORK_ERROR: {
      title: '接続が切れました',
      body: 'ネットワークを確認して、もう一度試してください。ダウンロード済みの部分から再開します。',
    },
    LINK_DISK_FULL: {
      title: 'ディスクの空き容量が足りません',
      body: 'ダウンロードフォルダのあるディスクがいっぱいです。空き容量を確保してから、もう一度試してください。',
    },
    LINK_DOWNLOAD_FAILED: {
      title: 'ダウンロードツールがエラーを報告しました',
      body: 'サイトが変更されたか、一時的にダウンロードを制限している可能性があります。まず再試行し、それでも失敗する場合はダウンロードツールの更新が必要か確認するか、ローカルファイルを使ってください。',
    },
    LINK_DOWNLOAD_UNREADABLE: {
      title: 'ダウンロードしたファイルは使用できません',
      body: 'ファイルが不完全か、音声トラックがないか、デコードできません。サイトが代わりのコンテンツを返した可能性があります。もう一度ダウンロードするか、別のリンクかローカルファイルを試してください。',
    },
    LINK_DESTINATION_UNAVAILABLE: {
      title: 'ダウンロードフォルダに書き込めません',
      body: 'ダウンロードフォルダが存在し、書き込み可能かを確認してください。別のフォルダを選んでから、読み込みをもう一度始めてください。',
    },
    MEDIA_TOOL_UNAVAILABLE: {
      title: 'ダウンロードしたファイルを確認できません',
      body: 'メディアの確認には ffprobe（ffmpeg に付属）が必要ですが、このコンピュータにありません。ffmpeg をインストールしてから、もう一度試してください。',
    },
    LINK_SOURCE_EXPIRED: {
      title: '元のリンクが残っていません',
      body: '再起動後の Runtime は、一部を伏せたリンクだけを保持し、完全なリンクは保持しません。リンクを貼り付けて、読み込みをもう一度始めてください。',
    },
    INTERRUPTED: {
      title: '読み込みが中断されました',
      body: '完了する前に Runtime が停止または再起動しました。再試行すると、止まったステップから再開します。',
    },
  },
  issueUnknownTitle: '読み込みが完了しませんでした',
  issueUnknownBody: (message: string | null, remedy: string | null) => joinSentences([message, remedy]) || '問題が発生しました。',

  headingStopped: '読み込みを停止しました',
  headingFailed: '読み込みが完了しませんでした',
  headingRunning: 'このリンクを編集できる動画にしています',
  headingDownloaded: '動画をダウンロードしました',
  headingVideoFailed: 'ファイルはダウンロードしましたが、動画を作成できませんでした',
  headingCreatingVideo: 'ファイルをダウンロードしました。動画を作成中',
  headingTranscribing: '動画の準備ができました。字幕を生成中',
  headingTranscribeFailed: '動画の準備はできましたが、文字起こしに対応が必要です',
  headingReady: '動画の準備ができました',
  headingSubsReady: '字幕の準備ができました',

  toolSource: {
    system: 'システムにインストール済み',
    user: '指定したもの',
    managed: 'BaoCut がダウンロード',
    env: '環境変数で指定',
  },
  factVersion: (version: string, size: string | null) => (size ? `バージョン ${version} · 約 ${size}` : `バージョン ${version}`),
  factFrom: (host: string) => `${host} からダウンロード`,
  factLicense: (license: string) => `${license} ライセンス`,
  factIsolated: 'BaoCut 専用のフォルダに置き、チェックサムを検証してから実行します。システムは変更しません',
  factInstalledWith: (method: string) => `${method} でインストール`,

  cardChecking: 'ダウンロードツールを確認中…',
  cardCheckingBody: 'このコンピュータ上のバージョンを見るだけで、ネットワークには接続しません。',
  cardUnknown: 'ダウンロードツールが登録されていません',
  cardUnknownBody: 'この Runtime は yt-dlp を認識していないため、現在はリンクから読み込めません。',
  cardInstalling: 'ダウンロードツールを準備中…',
  cardInstallingBody: 'ダウンロード → 検証 → テスト実行。完了すると「準備完了」と表示されます。',
  cardUpdating: 'ダウンロードツールを更新中…',
  cardUpdatingBody: '出力はコマンドの下に表示されます。完了後にバージョンをもう一度確認します。',
  cardBlockedWhy: 'このコンピュータでは BaoCut がダウンロードを代行できません。',
  cardMissing: 'ダウンロードツールがインストールされていません',
  cardMissingBody: (why: string) => `${endSentence(why)}yt-dlp をご自身でインストールしてから「再確認」をクリックするか、その場所を選んでください。`,
  cardInstall: '一度準備すれば、あとは貼り付けるだけ',
  cardInstallBody:
    'BaoCut が動画サイトを読み取るには、動画ダウンロードツール yt-dlp が必要です。同意するとツールをダウンロードして同意を記憶するため、以降リンクから読み込むときに再度確認することはありません。',
  cardInstallAction: '同意してインストール',
  cardOutdatedReason: (reason: string | null, version: string | null, minVersion: string | null) =>
    endSentence(reason ?? `バージョン ${version ?? '不明'} は必要な ${minVersion ?? ''} より古いです`),
  cardOutdated: 'ダウンロードツールの更新が必要です',
  cardOutdatedBlocked: (reason: string, why: string) => `${reason}${why}`,
  cardOutdatedRunnable: 'BaoCut がダウンロードしたものではありません。下のコマンドで、インストールしたときと同じ方法で更新できます。',
  cardOutdatedManual: 'BaoCut がダウンロードしたものではありません。下の手順に従ってターミナルで更新してから、「再確認」をクリックしてください。',
  cardOutdatedUpdate: (reason: string) => `${reason}始める前に更新してください。`,
  cardUpdateAction: '同意して更新',
  cardBroken: 'ダウンロードツールを実行できません',
  cardBrokenBody: (reason: string | null, remedy: string | null) => joinSentences([reason, remedy]) || '見つかりましたが、実行できません。',
  cardReinstallAction: '同意して再インストール',
  cardConsentRevoked: 'ダウンロードツールへの同意は撤回されています',
  cardConsent: 'ダウンロードツールの使用には同意が必要です',
  cardConsentBody: 'BaoCut は同意を得てから、これを使って Web サイトから動画をダウンロードします。同意は Runtime に保存されるため、以降リンクから読み込むときに再度確認することはありません。',
  cardConsentAction: '同意して使用',
  cardReady: 'ダウンロードツールの準備ができました',
  cardReadyBody: '開始すると、BaoCut はまずリンクを確認して動画の情報を取得し、それからダウンロードします。',
};
