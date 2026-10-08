import { MODEL_SERVICE_CAPABILITIES, USAGE_PERIODS } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';

export const ja: ModelsMessages = {
  help: `使い方：
  baocut models cancel <bundleId> [--discard]
                                   インストールを停止（ダウンロード済みの部分は残すので、再度 install すると再開します）。
                                   --discard はそれも削除
  baocut models repair <bundleId> [--yes]
                                   各ファイルの sha256 を検証し、欠けているか破損したファイルだけを再ダウンロード
                                   （確認のルールは install と同じ）
  baocut models dir                ローカルのモデルフォルダを表示：場所、設定元、使用容量と空き容量、認識したモデルの数
  baocut models dir --set <path> [--move|--switch]
                                   モデルフォルダを変更：--move は既存のモデルを移動（バックグラウンドタスク。失敗時は
                                   ロールバック）、--switch は場所だけを変更（古いファイルは残り、新しい場所にあるモデル
                                   だけが使えます）。現在のフォルダにモデルがある場合はどちらかが必須です。
                                   ローカルモデルを使用中のタスクがあると拒否します。環境変数 BAOCUT_MODELS_DIR で
                                   指定されている場合は読み取り専用
  baocut models dir --reset [--move|--switch]
                                   既定の場所（<BAOCUT_HOME>/models）に戻す。ルールは --set と同じ
  baocut models configure <providerId> [options]
                                   オンラインのプロバイダを設定：カタログのプロバイダ（openai、google、elevenlabs、anthropic、
                                   deepseek、qwen など。baocut models capabilities を参照）、または OpenAI 互換の
                                   カスタムエンドポイント custom:<name>。Agent のプロバイダ agent:codex にはオン／オフの
                                   切り替えしかありません（このコンピュータの Codex のサインインを使い、キーは不要）
    --enable | --disable           有効化（継続的な許可により、必要に応じて素材の音声、テキスト、プロンプトを送信）または無効化
    --key-stdin                    API キーを標準入力から読み込む（コマンドライン引数のキーは受け付けません）：最初の
                                   アカウントのキーを置き換え、アカウントがなければ作成します（複数のアカウントには
                                   baocut models accounts を使用）
    --endpoint <url>               カスタムエンドポイントのベース URL（初回は必須）。カタログのプロバイダでは
                                   プロキシやゲートウェイに向けられます
    --model <id> ...               カスタムエンドポイントが提供する文字起こしモデル（複数指定可。最初のものが既定）
    --speech-model <id> ...        カスタムエンドポイントが提供する音声合成モデル（/audio/speech。複数指定可）
    --image-model <id> ...         カスタムエンドポイントが提供する画像生成モデル（/images/generations。複数指定可）
    --text-model <id> ...          カスタムエンドポイントが提供するテキストモデル（/chat/completions。複数指定可）
                                   いずれかの種類のモデルを指定すると、宣言済みのモデルはすべて置き換わります
    --verify                       保存前に新しいキーとエンドポイントをプロバイダで一度検証
  baocut models accounts <providerId>
                                   プロバイダのアカウントを一覧表示：順序、名前、マスクしたキー、オン／オフ、状態
                                   （呼び出しにはキーのある最初の有効なアカウントを使い、エラー時も次のアカウントには切り替えません）
  baocut models accounts add <providerId> [--label <name>] [--region <region>] [--endpoint <url>] [--verify]
                                   アカウントを追加。キーは標準入力から読み込みます。--region にはカタログのリージョン
                                   （global、cn など）を指定。--verify は先にプロバイダで検証し、失敗したら保存しません。
                                   アカウントを追加してもプロバイダは有効になりません
  baocut models accounts remove <providerId> <accountId|name>
                                   アカウントとそのキーを削除（最後のアカウントを削除してもプロバイダは残り、
                                   使えるキーがない状態になります）
  baocut models accounts use <providerId> <accountId|name>
                                   優先に設定：このアカウントを先頭に移動
  baocut models usage [--period <${USAGE_PERIODS.join('|')}>] [--provider <id>]
                                   オンラインのプロバイダと Agent の呼び出し回数、使用量、支出（既定は過去 30 日間）：
                                   定価からの見積もり額、プロバイダが報告した額、費用不明を分けて表示し、通貨は換算しません。
                                   プロバイダ、機能、モデル、アカウント別に内訳を表示
  baocut models default <capability> <providerId|none> [modelId]
                                   機能（${MODEL_SERVICE_CAPABILITIES.join('、')}）の既定のプロバイダとモデルを設定または解除
  baocut models remove <bundleId|providerId>
                                   ローカルのモデルバンドルを削除（ほかのバンドルが使う共有コンポーネントは残します。
                                   使用中のタスクがあると拒否）。またはオンラインのプロバイダを削除：カスタムエンドポイント
                                   （custom:<name>）は丸ごと削除し、カタログのプロバイダは無効にしてすべてのアカウントと
                                   キーを削除します
  baocut models refresh <providerId>
                                   オンラインのプロバイダからモデル（と声）のリストを取得してキャッシュ：リストにない
                                   内蔵モデルは利用不可としてマークします。取得できない場合はこれまでどおり内蔵リストを使います
  baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]
                                   テキスト生成の既定の推論強度と、プロバイダごとの同時実行数の上限（既定は 4）を
                                   表示または設定。default で初期値に戻します`,
  byteProgressUnknown: (done) => `${done} 受信済み（合計サイズ不明）`,
  byteProgress: (done, total, percent) => `${done} / ${total}（${percent}%）`,
  bundleStates: {
    'not-installed': '未インストール',
    downloading: 'ダウンロード中',
    installed: 'インストール済み',
    loading: '読み込み中',
    ready: '準備完了',
    busy: '処理中',
    unloading: '解放中',
    error: '利用不可',
  },
  installStates: {
    queued: '待機中',
    downloading: 'ダウンロード中',
    verifying: '検証と配置中',
    paused: '一時停止中',
  },
  bundleState: (label, state, reason) => `${label}（${state}${reason ? ` / ${reason}` : ''}）`,
  componentInstalled: 'インストール済み',
  componentMissing: 'なし',
  sharedWith: (bundles) => `  ${bundles.join('、')} と共有`,
  installTask: (jobId) => `  タスク ${jobId}`,
  resumeHint: (bundleId) => `。baocut models install ${bundleId} で再開`,
  installLine: (state, progress, task, hint) => `  インストール：${state}  ${progress}${task}${hint}`,
  checkPassed: '合格',
  checkFailed: (code) => `不合格${code ? `（${code}）` : ''}`,
  checkLine: (result, at, detail) => `  チェック：${result}  ${at}${detail ? `  ${detail}` : ''}`,
  remedyAppFileMissing: '対処：BaoCut を再インストールしてください。モデルを修復しても解決しません',
  remedyRepair: (bundleId) =>
    `対処：baocut models repair ${bundleId} で壊れたファイルだけを再ダウンロードし、その後もう一度チェックしてください`,
  remedyMaybeRepair: (bundleId) =>
    `対処：まず baocut models repair ${bundleId} を試し（壊れたファイルだけを再ダウンロードします）、その後もう一度チェックしてください`,
  remedyOutOfMemory: '対処：メモリを多く使うほかのアプリを終了するか、より小さいモデルを選んで、もう一度チェックしてください',
  remedy: (text) => `対処：${text}`,
  upToDate: (repair, bundleId) =>
    repair ? `${bundleId} のファイルはすべて正常です。修復の必要はありません` : `${bundleId} はインストール済みです。ダウンロードの必要はありません`,
  planHeader: (repair, bundleId, source) => `${bundleId} を ${source} から${repair ? '修復' : 'インストール'}`,
  planKeep: (component, repo) => `  ${component}  ${repo}  インストール済み、そのまま使用`,
  planDownload: (component, repo, files, size) => `  ${component}  ${repo}  ${files} 個のファイルをダウンロード、${size}`,
  sizeUnknown: 'サイズ不明',
  toDownloadEstimate: (estimate) => `ダウンロード量：サイズ不明、約 ${estimate}`,
  toDownload: (size) => `ダウンロード量：${size}`,
  resumed: (size) => `再開：${size} はすでにステージング領域にあるため、再ダウンロードしません`,
  freeSpace: (size, short) => `空き容量：${size}${short ? '（不足）' : ''}`,
  sizeAbout: (size) => `約 ${size}`,
  installPrompt: (repair, size) => `${repair ? '修復' : 'インストール'}して ${size} をダウンロードしますか？[y/N] `,
  noSpace: (need, have) => `ディスク容量：${need} 必要ですが、残りは ${have} だけです`,
  removed: (files) => `削除しました：${files.join('、')}`,
  nothingRemoved: '削除したファイルはありません',
  keptInUse: (repo, users) => `${repo} を残しました：${users.join('、')} がまだ使用しています`,
  keptOtherVersion: (repo) => `${repo} を残しました：フォルダにあるのはこのモデルバンドルに含まれない別のバージョンです`,
  dirSources: {
    default: '既定の場所',
    setting: '設定で選んだフォルダ',
    env: '環境変数 BAOCUT_MODELS_DIR（読み取り専用：変更するには環境変数を変えて BaoCut を再起動してください）',
  },
  dirSource: (label) => `  設定元：${label}`,
  dirMissing: '  このフォルダは存在しません（外付けドライブが接続されていない場合にも起こります）',
  dirNotWritable: '  BaoCut はこのフォルダに書き込めません',
  dirUsage: (used, free, models) =>
    `  ${used} 使用${free ? ` · このディスクの空き ${free}` : ''} · ${models} 個のモデルを検出`,
  dirDefault: (path) => `  既定の場所：${path}`,
  dirMoving: (to, jobId) => `  移動中${to ? `（移動先 ${to}）` : ''}（タスク ${jobId}）`,
  dirEnvLocked: 'モデルフォルダは環境変数 BAOCUT_MODELS_DIR で指定されています：変更するには環境変数を変えて BaoCut を再起動してください',
  dirProblemMissing: 'このフォルダは存在しません：外付けドライブが接続されていない場合にも起こります。接続してからもう一度お試しください',
  dirProblemNotWritable: 'BaoCut はこのフォルダに書き込めません：書き込み可能な場所を選ぶか、先にアクセス権を変更してください',
  dirProblemNested:
    '新しい場所と現在のモデルフォルダが互いを含んでいます：その中にもなく、それを含みもしないフォルダを選んでください',
  dirProblemSame: 'すでに現在のモデルフォルダです',
  dirFound: (count, size) => `ダウンロード済みのモデルが ${count} 個見つかりました（${size}）。そのまま使えます`,
  dirEmpty: 'このフォルダにはまだモデルがありません。今後ダウンロードするモデルはここに保存されます',
  dirFree: (size) => `このディスクの空き ${size}`,
  moveSameVolume: '同じディスクなので、移動は名前の変更だけで追加の容量は使いません',
  moveSize: (size, fits) => `${size} を移動${fits ? '' : '（収まりません）'}`,
  dirCurrentHas: (size, move) => `現在のフォルダには ${size} のモデルがあります：${move}`,
  moveOrSwitch: '--move と --switch はどちらか一方だけを指定してください',
  accountStates: {
    unknown: '未検証',
    ok: '正常',
    'invalid-key': '無効なキー',
    'rate-limited': 'レート制限中',
    'quota-exhausted': 'クォータ使い切り',
  },
  rateLimitedUntil: (label, until) => `${label}（${until} まで）`,
  noAccounts: 'アカウントはまだありません：baocut models accounts add <providerId> でキーを標準入力から読み込みます',
  accountEnabled: '有効',
  accountDisabled: '無効',
  accountKeyUnreadable: 'キーを読み取れません',
  accountRegion: (region) => `リージョン ${region}`,
  accountEndpoint: (endpoint) => `エンドポイント ${endpoint}`,
  accountLastUsed: (at) => `最終使用 ${at}`,
  accountCurrent: '使用中',
  accountChoice: (accountId, label) => `${accountId}（${label}）`,
  noAccountChoices: 'アカウントなし',
  listSep: '、',
  accountAmbiguous: (count, ref, choices) => `「${ref}」という名前のアカウントが ${count} 個あります。accountId を使ってください：${choices}`,
  accountNotFound: (ref, choices) => `そのアカウントはありません：${ref}（選択肢：${choices}）`,
  usagePeriods: { today: '今日', '7d': '過去 7 日間', '30d': '過去 30 日間', all: '全期間' },
  unitTokens: (input, output) => `入力 ${input} / 出力 ${output} トークン`,
  unitCached: (cached) => `キャッシュ ${cached}`,
  unitAudio: (minutes) => `音声 ${minutes} 分`,
  unitChars: (chars) => `${chars} 文字`,
  unitImages: (images) => `画像 ${images} 枚`,
  clauseSep: '、',
  costKinds: {
    reported: 'プロバイダの報告',
    estimated: '定価から見積もり',
    mixed: '報告と見積もり',
    unknown: '費用不明',
  },
  rowCalls: (calls, failed) => `${calls} 回${failed > 0 ? `（${failed} 回失敗）` : ''}`,
  costApprox: (money, kind) => `≈ ${money}（${kind}）`,
  usageHeader: (scope, period, from, to) => `使用量（${scope ? `${scope}、` : ''}${period}：${from}〜${to}）`,
  noCalls: '  呼び出しはまだありません',
  totalCalls: (calls, failed) => `  呼び出し ${calls} 回${failed > 0 ? `（${failed} 回失敗）` : ''}`,
  usageUnits: (units) => `  使用量：${units}`,
  spentEstimated: (money) => `  支出 ≈ ${money}（定価から見積もり）`,
  spentReported: (money) => `  支出 ${money}（プロバイダの報告）`,
  unknownCostCalls: (calls) => `  ほかに ${calls} 回の呼び出しは費用不明`,
  noBilledCalls: '  課金された呼び出しはありません',
  byProvider: 'プロバイダ別',
  byCapability: '機能別',
  byModel: 'モデル別',
  byAccount: 'アカウント別',
  usageRepair: '使い方：baocut models repair <bundleId> [--yes]',
  usageCancel: '使い方：baocut models cancel <bundleId> [--discard]',
  usageConfigure: '使い方：baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …',
  usageDefault: '使い方：baocut models default <capability> <providerId|none> [modelId]',
  usageRemove: '使い方：baocut models remove <bundleId|providerId>',
  usageRefresh: '使い方：baocut models refresh <providerId>',
  usageParameters: '使い方：baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]',
  usageAccounts:
    '使い方：baocut models accounts <providerId> | add <providerId> [--label <name>] [--region <region>] [--verify] | remove <providerId> <account> | use <providerId> <account>',
  usageDir: '使い方：baocut models dir [--set <path> [--move|--switch] | --reset [--move|--switch]]',
  cancelledDiscarded: '停止して、ダウンロード済みの部分を削除しました',
  cancelledKept: '停止しました（ダウンロード済みの部分は残してあります。再度 install すると再開します）',
  unknownCapability: (capability, choices) => `不明な機能：${capability}（${choices.join('、')} のいずれか）`,
  clearDefaultNoModel: '既定を解除するときはモデルを指定しないでください',
  defaultSet: (label, provider, model) => `${label} の既定：${provider} / ${model}`,
  defaultCleared: (label) => `${label} の既定を解除しました`,
  customProviderDeleted: (id) => `${id} を削除しました（これを指す既定は残し、利用不可として表示します）`,
  providerRemoved: (id) =>
    `${id} を削除しました：無効にして、すべてのアカウントとキーを削除しました（これを指す既定は残し、利用不可として表示します）`,
  providerRefreshFailed: (id, error) => `${id} を更新できませんでした：${error ?? '理由不明'}。引き続き内蔵のモデルリストを使います`,
  providerRefreshed: (id, models, voices, at) =>
    `${id} を更新しました：モデル ${models} 個${voices !== undefined ? `、声 ${voices} 個` : ''}（${at}）`,
  periodChoices: (periods) => `--period には ${periods.join('、')} のいずれかを指定してください`,
  enableDisableConflict: '--enable と --disable はどちらか一方だけを指定してください',
  saved: (description) => `保存しました：${description}`,
  verifiedAndSaved: '検証して保存しました',
  savedPlain: '保存しました',
  providerNotEnabled: (id) => `${id} はまだ有効になっていません：baocut models configure ${id} --enable`,
  accountRemoved: (name) => `アカウント ${name} を削除しました`,
  accountPreferred: (name) => `優先に設定しました：${name}`,
  providerHasNoAccounts: (id) => `${id} にはアカウントがありません`,
  noSuchProvider: (id) => `そのプロバイダはありません：${id}`,
  alreadyRepairing: (jobId) => `すでに修復中です（タスク ${jobId}）。進行状況を表示します`,
  nothingToRepair: '修復するファイルはありません',
  notTtyConfirmDownload: 'ターミナルで実行されていません：ユーザがダウンロードを確認したら --yes を付けてください',
  notDownloaded: 'ダウンロードしていません',
  nothingToDownload: 'ダウンロードするものはありません',
  repairDone: '修復完了',
  repairPartialKept: (bundleId) => `ダウンロード済みの部分は残してあります：baocut models repair ${bundleId} で再開できます`,
  setResetConflict: (usage) => `--set と --reset はどちらか一方だけを指定してください。${usage}`,
  dirHasModels:
    '現在のフォルダにモデルがあります：移動するには --move を、場所だけを変えるには --switch を付けてください（古いファイルは残ります）',
  dirChanged: (dir, oldFilesKept) => `モデルフォルダを ${dir} に変更しました${oldFilesKept ? '（古い場所のファイルは残してあります）' : ''}`,
  modelsMoved: (dir) => `モデルを ${dir} に移動しました`,
  dirRolledBack: 'ロールバックしました：元のモデルフォルダは変わっていません',
  pasteKeyHint: 'API キーを貼り付けて Return キーを押し、Ctrl-D で入力を終了してください：',
  noKeyOnStdin: '標準入力に API キーがありません',
  keyHasWhitespace: 'API キーに空白や改行を含めないでください：標準入力にはキーだけを入れてください',
  positiveInteger: (option) => `${option} には正の整数を指定してください`,
  effortChoices: (efforts) => `--effort には ${efforts.join('、')} のいずれかを指定してください`,
  capabilityLabels: {
    transcribe: '文字起こし',
    synthesizeSpeech: '音声合成',
    generateImage: '画像生成',
    generateText: 'テキスト生成',
    separateAudio: '音声分離',
  },
  unavailableLabels: {
    'not-configured': '未有効化',
    'missing-credential': 'API キーなし',
    'not-installed': '未インストール',
    'signed-out': '未サインイン',
    outdated: 'バージョンが古すぎます',
    'not-paired': '未ペアリング',
    'not-connected': '接続できません',
    unsupported: '未対応',
    resource: 'エラーが続いたため無効化',
  },
  unavailable: '利用不可',
  capabilityState: (label, available, reason) => `${label} ${available ? '利用可能' : `利用不可（${reason}）`}`,
  capabilitySep: '、',
  configEnabled: '有効',
  configDisabled: '無効',
  keyState: (set) => `キー${set ? '設定済み' : '未設定'}`,
  configEndpoint: (url) => `エンドポイント ${url}`,
  modelListRefreshed: (at) => `モデルリスト更新 ${at}`,
  lastRefreshFailed: (at) => `前回の更新は失敗（${at}）。内蔵リストを使用`,
  textParameters: (effort, concurrency) =>
    `既定の推論強度：${effort ?? 'モデル自身の設定'} · プロバイダごとの同時実行数 ${concurrency}`,
  markDefault: '既定',
  markDeclared: 'ユーザ宣言',
  wordTimestampsNative: '単語のタイムスタンプ',
  wordTimestampsEstimated: '単語の時刻は長さから推定',
  maxInputMegabytes: (mb) => `1 回あたり ≤ ${mb} MB`,
  maxDurationMinutes: (minutes) => `1 回あたり ≤ ${minutes} 分`,
  voiceCount: (count, defaultVoice) => `声 ${count} 個（既定 ${defaultVoice ?? 'なし'}）`,
  noPresetVoices: 'プリセットの声はありません。声の指定が必要です',
  acceptsCustomVoices: 'カスタムの声に対応',
  maxInputChars: (count) => `1 回あたり ≤ ${count} 文字`,
  acceptsInstructions: 'スタイルの指示に対応',
  sizeCount: (count, defaultSize) => `サイズ ${count} 種類${defaultSize ? `（既定 ${defaultSize}）` : ''}`,
  aspectRatios: (ratios) => `アスペクト比 ${ratios}`,
  maxImageCount: (count) => `1 回あたり ≤ ${count} 枚`,
  sizeAndSeedFixed: 'サイズとシードは指定できません',
  contextTokens: (count) => `コンテキスト ${count} トークン`,
  maxOutputTokens: (count) => `出力 ≤ ${count} トークン`,
  efforts: (efforts, defaultEffort) => `推論強度 ${efforts}${defaultEffort ? `（既定 ${defaultEffort}）` : ''}`,
  structuredOutput: '構造化出力',
  subscription: 'サブスクリプションに含まれる、クォータ不明',
  modelName: (id, label) => `${id}（${label}）`,
};
