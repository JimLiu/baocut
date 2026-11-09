import type { DoctorMessages } from './doctor-copy.ts';

export const ja: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'BaoCut が起動しない・何かを読めない理由を調べます：ターミナルが見つける baocut、CLI が起動する Runtime と',
    'そのホーム、資格情報ストアが応答するか、macOS のフルディスクアクセス。各チェックは ok、warn、fail、skip の',
    'いずれかで、対処コマンドがあれば添えます。next は最初の問題への対処です。',
    '読み取り専用：Runtime を起動せず、キーも読みません（キーチェーンのチェックは架空のキーがあるかを尋ねるだけ）。',
    '対処コマンドを実行する前にユーザーの同意を得てください。',
    'リポジトリから実行しているときは Runtime のセルフチェックも行い、各ネイティブプログラムを一度起動してビルドをソースと比較します。',
    '',
    'フラグ：--json',
  ].join('\n'),
  checkName: {
    entry: 'コマンドライン',
    runtime: 'Runtime',
    credentials: '資格情報',
    fullDiskAccess: 'フルディスクアクセス',
    build: 'ビルド',
  },
  remedyLabel: '対処',

  entryApp: (found, version) => `ターミナルは ${found} を使っています。BaoCut アプリ${version ? ` ${version}` : ''} のコマンドラインです`,
  entryOtherApp: (found, target, app) =>
    `ターミナルは ${found}（${target}）を使っています。${app} の BaoCut アプリのコマンドラインではありません`,
  entryNoApp: (found, target) => `ターミナルは ${found}（${target}）を使っています。BaoCut アプリは見つかりませんでした`,
  entryMissing: 'ターミナルから baocut が見つかりません。BaoCut アプリからインストールしてください（管理者権限は不要）。',
  entryMissingNoApp: 'ターミナルから baocut が見つからず、通常の場所に BaoCut アプリもありません',

  runtimeRunning: (version, pid, by) =>
    `実行中：バージョン ${version}、プロセス ${pid}、${by === 'cli' ? 'コマンドライン' : 'BaoCut アプリ'}から起動`,
  runtimeStopped: (entry) => `実行されていません。次のコマンドで ${entry} を使ってバックグラウンドで起動します`,
  runtimeUnreachable: (pid, reason) => `Runtime は実行中（プロセス ${pid}）ですが応答しません：${reason}`,
  runtimeNoLaunch:
    '実行されておらず、起動できる Runtime もありません：BaoCut アプリをインストールするか、リポジトリから実行するか、BAOCUT_RUNTIME_ENTRY に Runtime のエントリを設定してください。',

  credentialsFile: (file) => `このビルドはキーをファイルに保存します：${file}`,
  credentialsKeychain: (platform) => (platform === 'win32' ? 'Windows 資格情報マネージャーが応答します' : 'macOS キーチェーンが応答します'),
  credentialsDenied:
    'キーチェーンへのアクセスが拒否されました。SSH 経由やデスクトップにログインしていない状態では、macOS がキーチェーンをロックしたままにすることがあります：デスクトップのターミナルで baocut を実行するか、ログインキーチェーンのロックを解除してください。',
  credentialsNoHelper: (file) =>
    `資格情報ヘルパーが見つからない${file ? `（${file}）` : ''}ため、キーを読めません。BaoCut アプリを再インストールしてください。`,
  credentialsUnavailable: (reason) => `資格情報ストアに接続できませんでした：${reason}`,
  credentialsUnknown: 'キーの保存先は BAOCUT_RUNTIME_ENTRY のエントリによって決まります。確認していません',
  credentialsTimedOut: (seconds) => `ヘルパーが ${seconds} 秒以内に応答しませんでした`,

  fdaGranted: 'フルディスクアクセスはオンです',
  fdaMissingApp:
    'BaoCut.app のフルディスクアクセスがオフのため、保護された場所（デスクトップ、書類、ダウンロード、ほかのドライブ）にあるファイルを読めないことがあります。「システム設定 › プライバシーとセキュリティ › フルディスクアクセス」で BaoCut をオンにしてから、baocut doctor をもう一度実行してください。',
  fdaMissingCli: (app) =>
    `コマンドラインが起動した Runtime のフルディスクアクセスがオフです。macOS はこれを${app ?? 'コマンドを実行したアプリ（ターミナル、または Agent を動かしているアプリ）'}の権限として扱います。「システム設定 › プライバシーとセキュリティ › フルディスクアクセス」でそのアプリをオンにして開き直すか、この Runtime を停止（baocut runtime stop）して BaoCut アプリを開いてください。そのあと baocut doctor をもう一度実行してください。`,
  fdaNotRunning: 'Runtime の実行中にのみ確認します',
  buildOk: (count) => `ネイティブプログラムはすべて起動し、${count} 件のビルドがソースと一致しています`,
  buildNotSource: 'Runtime をリポジトリから実行しているときにチェックします',
  buildFailed: (reason) => `Runtime のセルフチェックが完了しませんでした：${reason}`,
  buildTimedOut: (seconds) => `${seconds} 秒以内に応答がありませんでした`,
  buildProblems: (count, first) =>
    count === 1 ? `Runtime のセルフチェックで問題が見つかりました：${first}` : `Runtime のセルフチェックで ${count} 件の問題が見つかりました。最初の問題：${first}`,
  buildMore: (first, more) => `${first}（ほか ${more} 件）`,
};
