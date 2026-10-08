import type { RcExternalToolsMessages } from './rc-external-tools.ts';

const WIN_ADMIN = '管理者としてターミナルを開き、このコマンドを実行してください。';

export const ja: RcExternalToolsMessages = {
  manageOnlyInAppOrCli: '外部ツールはデスクトップアプリまたは CLI でのみ管理できます',
  videoNotOpen: '動画が開いていません',

  toolUpdating: (p) => `${p.label} を更新中です`,
  waitForUpdate: (p) => `更新タスク ${p.jobId} が終わってから再試行してください`,
  toolNotInstalled: (p) => `${p.label} がインストールされていません`,
  toolCannotRun: (p) => `${p.label} を実行できません：${p.reason}`,
  toolOutdated: (p) => `${p.label} のバージョンが古すぎます：${p.reason}`,
  consentRevoked: (p) => `${p.label} の使用への同意は取り消されました`,
  consentRequired: (p) => `${p.label} を使用するには、先にユーザの同意が必要です`,
  consentRemedy: (p) =>
    `ユーザが同意してから再試行してください：externalTools.consent（baocut external-tools consent ${p.name}）、またはインストール時に同意（externalTools.install で consent: true を指定）`,

  notExecutable: (p) => `${p.path} は実行可能ファイルではありません`,
  notWindowsProgram: (p) =>
    `${p.path} は Windows プログラム（.exe）ではありません：BaoCut はコマンドインタプリタを介して外部ツールを実行しません`,
  cannotRunAs: (p) => `${p.path} を ${p.label} として実行できません：${p.reason}`,
  noVersion: 'バージョンを読み取れませんでした',
  toolInUse: (p) => `${p.label} はインストール中か、タスクで使用中です`,
  notDownloadedByBaocut: (p) => `${p.label} は BaoCut ではダウンロードしません：${p.remedy}`,
  downloadNeedsConsent: (p) =>
    `${p.label} をダウンロードするにはユーザの同意が必要です：先にダウンロード元、バージョン、サイズ、ライセンスを確認してください`,
  offlineStrictNoDownload: '厳格オフラインモードでは外部ツールをダウンロードしません',
  cannotDownload: (p) => `${p.label} をダウンロードできません：${p.reason}`,
  manifestIncompleteRemedy: (p) =>
    `BaoCut がマニフェストを更新するのを待つか、${p.label} をご自身でインストールして externalTools.setPath でパスを指定してください`,
  updateManagedCopy: (p) =>
    `使用中の ${p.label} は BaoCut がダウンロードしたコピーのため、インストール方法に沿った更新は行いません`,
  updateUnknownInstall: (p) => `${p.path} のインストール方法を判別できません`,
  updateNoRunnable: (p) => `実行可能な ${p.label} が見つかりませんでした`,
  updateManagedRemedy: 'externalTools.install でマニフェストのバージョンに切り替えてください',
  updateManualRemedy:
    'インストールしたときと同じ方法でターミナルから更新し、完了したら再検出してください（externalTools.detect）',
  cannotUpdateFor: (p) => `BaoCut は ${p.label} を代わりに更新できません`,
  runInTerminalRemedy: (p) => `ターミナルで ${p.command} を実行し、完了したら再検出してください（externalTools.detect）`,
  confirmUpdateCommand: (p) => `${p.label} を更新するには、先にユーザがこのコマンドを確認する必要があります：${p.command}`,
  updateCommandChanged: (p) => `${p.label} を更新するコマンドが変わりました。もう一度確認してください：${p.command}`,
  offlineStrictNoUpdate: '厳格オフラインモードでは外部ツールを更新しません',
  unknownTool: (p) => `外部ツール「${p.name}」はありません`,
  notManaged: (p) => `${p.label} は BaoCut では管理しません：${p.remedy}`,
  endpointInvalid: '外部ツールのダウンロード元が有効なアドレスではありません',
  endpointBadForm:
    '外部ツールのダウンロード元は http(s):// で始まるベースアドレスにし、認証情報、クエリパラメータ、フラグメントを含めないでください',

  sourceEnvVar: (p) => `環境変数 ${p.name} が指す場所`,
  sourceUserPath: '指定したパス',
  sourceManaged: 'BaoCut がダウンロードしたコピー',
  commandNotFound: (p) => `${p.command} が見つかりません`,
  commandNotFoundIn: (p) => `${p.where}に ${p.command} が見つかりません`,
  sourceNotExecutable: (p) => `${p.where}は実行可能ファイルではありません`,
  sourceIsScript: (p) =>
    `${p.where}にあるのは${p.batch ? 'バッチスクリプト' : 'スクリプト'}で、Windows プログラム（.exe）ではありません。BaoCut はコマンドインタプリタを介して外部ツールを実行しません`,
  setExePathRemedy: (p) =>
    `externalTools.setPath で ${p.command}.exe のパスを指定してください${p.canInstall ? '（または externalTools.install でダウンロード）' : ''}`,
  belowMinVersion: (p) => `${p.version} は最低バージョン ${p.min} を下回っています`,
  installOrUpdateRemedy: (p) =>
    `externalTools.install で ${p.version} をダウンロードするか、システムの ${p.label} を更新してください`,
  updateTool: (p) => `${p.label} を更新`,

  diskFull: 'ツールファイルの書き込み中にディスクがいっぱいになりました',
  downloadedCannotRun: (p) => `ダウンロードした ${p.label} を実行できません：${p.reason}`,
  updateStopped: '更新を停止しました',
  updateExited: (p) => `更新コマンドが ${p.code} で終了しました`,
  updateTimedOut: (p) => `更新コマンドが ${p.minutes} 分以内に終わらなかったため、停止しました`,
  updateSignalled: (p) => `更新コマンドがシグナル ${p.signal} で終了しました`,
  updateCannotStart: (p) => `更新コマンドを開始できませんでした（${p.reason}）`,
  updateFailedRemedy: (p) =>
    `タスクの出力を確認するか、ターミナルで ${p.command} を実行してから再検出してください`,

  remedyNoSpace: 'Runtime Home があるディスクの空き容量が不足しています。空き容量を確保してから再インストールしてください',
  remedyNetwork:
    'ネットワークに接続できないか、ダウンロードが中断されました。ネットワークを確認して再インストールするか（ダウンロード済みの部分から再開します）、設定 › 一般の「ツールのダウンロード元」でミラーを切り替えてください',
  remedyIntegrity:
    'ダウンロードしたファイルのサイズまたは sha256 がマニフェストと一致しません（ダウンロード元またはミラーの内容が正しくありません）。不正なファイルは削除しました。別のダウンロード元に切り替えて再インストールしてください',
  remedySource:
    'ダウンロード元にこのファイルがないか、アクセスが拒否されました。設定 › 一般の「ツールのダウンロード元」（または環境変数 BAOCUT_TOOLS_ENDPOINT）で指定したミラーを確認してください',
  downloadFailed: (p) => `${p.file} のダウンロードに失敗しました：${p.reason}`,
  integrityMismatch: (p) => `${p.file} のサイズまたは sha256 がマニフェストと一致しません`,
  sourceHttpStatus: (p) => `ダウンロード元が ${p.file} に対して HTTP ${p.status} を返しました`,
  largerThanManifest: (p) => `${p.file} がマニフェストの記載より大きくなっています`,

  ytDlpLicense: 'Unlicense（ソースコード）。単体の実行ファイルは GPLv3+ のコンポーネントを含み、全体として GPLv3+',
  ytDlpPurpose: 'リンクから読み込み：動画ページを解析し、メディアと字幕をダウンロード',
  ytDlpMissingRemedy:
    'externalTools.install（baocut external-tools install yt-dlp）でダウンロードするか、ご自身でインストールして externalTools.setPath でパスを指定してください',
  ffmpegPurpose: 'メディアの解析、ファイルの変換、書き出し、ダウンロード後の音声と映像の結合',
  noReleaseForPlatform: (p) => `このマシン（${p.platform}）向けのリリースファイルがありません`,
  noTrustedSha: '組み込みのマニフェストにこのファイルの信頼できる sha256 がまだないため、ダウンロードできません',

  probeCannotStart: (p) => `起動できません：${p.error}`,
  probeTimeout: (p) => `${p.command} が ${p.seconds} 秒以内に終わりませんでした`,
  probeCannotStartCode: (p) => `起動できません（${p.code}）`,
  probeExited: (p) => `${p.code} で終了しました${p.detail ? `：${p.detail}` : ''}`,

  pipxMissing: (p) => `この ${p.label} は pipx でインストールされていますが、PATH に pipx がありません。`,
  brewMissing: (p) => `この ${p.label} は Homebrew でインストールされていますが、その Homebrew の ${p.brew} が見つかりません。`,
  wingetMachineWide: (p) =>
    `この ${p.label} は winget で全ユーザ向け（${p.dir}）にインストールされており、更新には管理者権限が必要です。BaoCut は権限を昇格しません。${WIN_ADMIN}`,
  wingetMissing: (p) => `この ${p.label} は winget でインストールされていますが、PATH に winget がありません。`,
  scoopGlobal: (p) =>
    `この ${p.label} は Scoop のグローバルインストール（${p.dir}）で、更新には管理者権限が必要です。BaoCut は権限を昇格しません。${WIN_ADMIN}`,
  scoopMissing: (p) => `この ${p.label} は Scoop でインストールされていますが、Scoop 本体が見つかりません（${p.script}）。`,
  chocolateyAdmin: `Chocolatey でインストールしたプログラムの更新には管理者権限が必要です。BaoCut は権限を昇格しません。${WIN_ADMIN}`,
  pythonScriptMissing: 'このエントリスクリプトが指す Python インタプリタはもう存在しません。',
  pipAdmin: (p) =>
    `この ${p.label} は ${p.dir} にインストールされており、変更には管理者権限が必要です。BaoCut は権限を昇格しません。インストールしたときと同じ方法で更新してください。`,
  pythonLauncherMissing: 'このエントリプログラムが指す Python インタプリタはもう存在しません。',
  pipAdminWin: (p) =>
    `この ${p.label} は ${p.dir} にインストールされており、変更には管理者権限が必要です。BaoCut は権限を昇格しません。${WIN_ADMIN}`,
  standaloneAdmin: (p) =>
    `この ${p.label} がある ${p.dir} の変更には管理者権限が必要です。BaoCut は権限を昇格しません。`,
  standaloneAdminWin: (p) =>
    `この ${p.label} がある ${p.dir} の変更には管理者権限が必要です。BaoCut は権限を昇格しません。${WIN_ADMIN}`,
};
