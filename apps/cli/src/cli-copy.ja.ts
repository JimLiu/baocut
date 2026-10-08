import type { CliMessages } from './cli-copy.ts';

export const ja: CliMessages = {
  helpTagline:
    'baocut：BaoCut で動画の文字起こし、翻訳、編集、吹き替え、書き出しを行います。まず `baocut status` を実行して、このコンピュータでできることを確認してください。',
  helpFlows: 'フロー（ジョブを返し、既定では完了まで待機）',
  helpObjects: 'オブジェクト',
  helpAdmin: 'ローカル管理（人向け。Agent は先にユーザに確認）',
  helpMore: 'その他',
  helpMoreHelp: 'パラメータ、作用、例',
  helpMoreSpec: '機械可読のカタログ（JSON）',
  helpMoreStatus: 'このコンピュータで今できること',
  helpGlobalFlags: '--json --project <dir> --yes --max-bytes <n> --result-file <file> --no-start',
  helpJobFlags: 'ジョブ：--no-wait --timeout <s> --progress jsonl',
  helpAdminVerbs: 'ローカル管理',
  helpGroupMore: (noun) => `パラメータと例は baocut help ${noun} <command> で確認できます。`,
  helpFlagsPlaceholder: '[flags]',
  effectLabel: (effect) => `作用：${effect}`,
  effectQuery: 'query（読み取り専用）',
  effectMutation: 'mutation（状態を変更）',
  effectJob: 'job（ジョブを返し、既定では完了まで待機）',
  effectDestructive: 'destructive（元に戻せません。--yes が必要）',
  helpParameters: 'パラメータ',
  helpNoParameters: '（なし）',
  helpRequired: '必須',
  helpRepeatable: '複数指定可',
  helpPositionalNote: (positional, flag) => `${positional} は位置引数または ${flag} のどちらか一方で指定できます。`,
  helpExamples: '例',
  helpCommonFlags: '共通フラグ',

  nextLabel: '次',
  errorLabel: 'エラー',
  runtimeStartedNote: '（BaoCut Runtime をバックグラウンドで起動しました。アイドル状態になると自動で終了します）',
  spilledNote: (maxBytes) =>
    `結果が ${maxBytes} バイトを超えています：完全な結果は path のファイル（JSON）にあります。coverage にはその最上位のキーと配列の長さ、summary には短いフィールドが入っています。ファイルを読むか、continueWith.paging のフラグでリクエストを絞り込むか、--max-bytes continueWith.maxBytes を付けて再実行してください。`,
  resultFileWritten:
    '--result-file の指定どおり、完全な結果は path のファイル（JSON）にあります。coverage にはその最上位のキーと配列の長さ、summary には短いフィールドが入っています。',

  unknownCommand: (command) => `不明なコマンド：${command}。baocut --help でコマンドを確認してください。`,
  unknownFlag: (flag, command) => `baocut ${command} には ${flag} というフラグはありません。baocut help ${command} を参照してください。`,
  missingValue: (flag) => `${flag} には値が必要です。`,
  noValueExpected: (flag) => `${flag} はスイッチなので値を取りません。`,
  duplicateFlag: (flag) => `${flag} が複数回指定されています。`,
  badNumber: (flag, value) => `${flag} には数値が必要ですが、「${value}」が指定されました。`,
  badInteger: (flag, value) => `${flag} には整数が必要ですが、「${value}」が指定されました。`,
  badBoolean: (flag, value) => `${flag} には true または false が必要ですが、「${value}」が指定されました。`,
  badChoice: (flag, value, choices) =>
    `${flag} には ${choices.join('、')} のいずれかを指定してください。「${value}」が指定されました。`,
  badValue: (flag, value) => `「${value}」は ${flag} の有効な値ではありません。`,
  badJson: (flag, reason) => `${flag} には JSON（リテラル、@file、または標準入力を表す -）が必要です：${reason}`,
  expectedObject: (flag) => `${flag} には JSON オブジェクトが必要です。`,
  readFileFailed: (flag, file, reason) => `${flag} の ${file} を読み取れませんでした：${reason}`,
  stdinTwice: (flag) => `標準入力は 1 回しか読み込めません（${flag} が再度読み込もうとしました）。`,
  noPositional: (command, value) =>
    `baocut ${command} は位置引数を取りません（「${value}」が指定されました）。フラグを使ってください。`,
  tooManyPositionals: (command, extra) => `baocut ${command} が取る位置引数は 1 つだけです。余分な引数：${extra}`,
  positionalAndFlag: (field, flag) => `${field} が位置引数と ${flag} の両方で指定されています。どちらか一方だけにしてください。`,
  missingRequired: (names, command) => `${names} がありません。baocut help ${command} を参照してください。`,
  dryRunUnsupported: (command) => `baocut ${command} には --dry-run がありません。`,
  projectNotDirectory: (value) => `--project ${value} はフォルダではありません。`,
  confirmationRequired: (command, summary) =>
    `baocut ${command} は元に戻せないため、実行しませんでした。実行すると次の操作を行います：${summary} ユーザが同意したら --yes を付けて再実行してください。`,
  confirmationNext: (command) => `baocut ${command} … --yes（ユーザの同意後）`,
  unknownSpec: (name) => `${name} という名前のツールはありません。baocut spec でカタログ全体を確認できます。`,
  unknownEditOp: (op) => `edits apply には ${op} という操作はありません。baocut edits ops で一覧を確認できます。`,
  catalogUnavailable: (command) =>
    `オフラインのカタログスナップショットがなく、実行中の Runtime もありません。リポジトリで \`${command}\` を実行して生成するか、baocut runtime ensure で Runtime を起動してください。`,
  runtimeUsage: '使い方：baocut runtime ensure | status | stop',
  installConfirmationRequired: (bundleId, size, source) =>
    `ローカルモデル ${bundleId} をインストールするには ${source} から ${size} をダウンロードします。まだ何もダウンロードしていません。ユーザにサイズを伝え、同意を得たら --yes を付けて再実行してください。`,
  sizeEstimated: '（推定）',

  metaHelp: {
    help: 'baocut help [<command>]\n\nコマンドを省略すると 1 画面の概要を表示。コマンドを指定すると（`help videos`、`help videos inspect`、`help runtime`）、そのパラメータ、作用、例を表示します。実行中の Runtime があればそのカタログを、なければオフラインのスナップショットを使います。Runtime は起動しません。',
    spec: 'baocut spec [<name>]\n\n機械可読のカタログを、エンベロープなしの JSON でインターフェースのバージョン付きで出力します。<name> にはツール名（videos_inspect）、ドット区切りの名前（videos.inspect）、コマンド（videos inspect）、または edits apply の 1 つの操作を表す edits.<operation> を指定します。実行中の Runtime があればそのカタログを、なければオフラインのスナップショットを使います。Runtime は起動しません。',
    version:
      'baocut version\n\nこの CLI と、実行中であれば Runtime のバージョン、両者のツールインターフェースのバージョンと、それらが一致しているかどうか。エンベロープなしの JSON で出力します。Runtime は起動しません。',
    status:
      'baocut status [--full] [--no-start]\n\nこのコンピュータで今できること：Runtime、各機能の既定と利用可否、ローカルのモデルバンドルと外部ツール、足りないものには対処用のコマンド。Runtime が実行中でなければ起動します。--no-start を付けると、起動せずに running: false と答えます。 機能とモデルパッケージは概要を表示します。--full を付けると、各プロバイダのモデル、パラメータ、制限とモデルパッケージの詳細を追加します。',
    runtime: [
      'baocut runtime ensure | status | stop',
      '',
      'この CLI が通信する BaoCut Runtime（BAOCUT_HOME ごとに 1 つ）。',
      '  ensure   実行中の Runtime を見つけるか、バックグラウンドで起動。CLI が起動した Runtime は、アイドル状態',
      '           （接続、ジョブ、開いているサービスがない）が runtime.idleExitMinutes 続くと自動で終了します',
      '  status   実行中かどうか、誰が起動したか、接続、実行中のジョブ、開いているサービス、アイドル時の終了。起動はしません',
      '  stop     CLI が起動した Runtime を停止。デスクトップアプリやほかの誰かが起動した場合は RUNTIME_NOT_OWNED、',
      '           デスクトップアプリ、ほかの CLI、未完了のジョブが使用中の場合は RUNTIME_IN_USE（終了コード 1）',
      '',
      'フラグ：--json  --no-start（ensure：起動せず、終了コード 3 で失敗）',
    ].join('\n'),
  },

  runtimeNotRunning: (home) => `${home} の BaoCut Runtime は実行されておらず、--no-start が指定されています。`,
  runtimeNoEntry:
    '実行中の BaoCut Runtime がなく、起動もできませんでした：BaoCut アプリをインストールするか、リポジトリから実行するか、BAOCUT_RUNTIME_ENTRY に Runtime のエントリを設定してください。',
  runtimeStartFailed: (reason, log) => `BaoCut Runtime を起動できませんでした（${reason}）。${log} を参照してください。`,
  runtimeStartTimeout: (seconds, log) => `BaoCut Runtime が ${seconds} 秒以内に準備完了になりませんでした。${log} を参照してください。`,
  exitedWith: (code) => `終了コード ${code ?? '不明'} で終了しました`,
  runtimeConnectFailed: (reason) => `BaoCut Runtime に接続できませんでした：${reason}`,
  runtimeLost: (reason) => `BaoCut Runtime との接続が切れました：${reason}`,
  protocolMismatch: (reason) =>
    `この CLI と BaoCut Runtime のプロトコルのバージョンが異なります：${reason}。古いほうを更新してください。`,
  interfaceMismatch: (cli, runtime, update) =>
    `この CLI のツールインターフェースのバージョンは ${cli}、Runtime は ${runtime} です。${update === 'cli' ? 'CLI を更新してください。' : 'BaoCut アプリを更新してください（または CLI と同じチェックアウトから Runtime を再起動してください）。'}`,

  jobCancelling: (jobId) => `${jobId} をキャンセル中…（もう一度 Ctrl-C を押すと、すぐに待機をやめます）`,
  jobCancelFailed: (reason) => `ジョブをキャンセルできませんでした：${reason}`,
  jobEnded: (state) => `ジョブが終了しました：${state}。`,
  statusFullNext:
    'baocut status --full では各機能のすべてのプロバイダとモデルを表示します。機能を個別に確認するには baocut models capabilities --capability <capability>、モデルパッケージの詳細には baocut models list を実行してください。',
  waitTimeout: (seconds, jobId) => `${seconds} 秒で待機をやめました。ジョブ ${jobId} は実行を続けています。`,

  noRuntimeClient: 'このコマンドは Runtime に接続しません',
};
