import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const ja: ServicesMessages = {

  accessLinkVideo: (video) => `サインイン後、動画 ${video} のエディタが直接開きます`,
  help: `使い方：
  baocut services [status]         外部サービス：MCP サービス、モデル API サービス、Web サービス、LAN ノードの
                                   状態、アドレス、レベル、範囲
  baocut services start <service>  サービスを起動（mcp、model-api、web、node）
  baocut services stop <service>   サービスを停止（外部の接続を切断し、確認待ちのリクエストをキャンセル。
                                   送信済みのタスクは最後まで実行します）
  baocut services configure <service> [options]
    --port <port>                  待ち受けるポート（ループバックアドレスのみ。MCP の既定は ${MCP_DEFAULT_PORT}、モデル API は
                                   ${MODEL_API_DEFAULT_PORT}）。使用中の場合はポートを変えずにサービスがエラーを報告します
    --level read|ask|auto          read は読み取り専用。ask は書き込み、タスク、生成を毎回 BaoCut で確認（既定）。
                                   auto はそのまま実行
    --videos all|<id,…>            すべての動画を公開するか、これらの videoId（カンマ区切り）だけを公開。範囲外の動画は
                                   外部から見えません（モデル API サービスには範囲がありません）
    --autostart on|off             Runtime と一緒に起動
    --route-online on|off          モデル API サービス：有効なオンラインサービスにリクエストを転送（既定は off、ローカルのモデルのみ）
    --route-nodes on|off           モデル API サービス：ペアリング済みの LAN ノードに転送（既定は off）
    --route-agent on|off           モデル API サービス：Agent のプロバイダに転送（既定は off）
    --max-concurrent <n>           モデル API サービス：クライアントごとの同時処理リクエスト数（既定は 4）。上限を超えると 429
    --read-only on|off             web のみ：ブラウザは表示だけで、編集、メッセージ送信、タスクの送信はできません
    --methods default|<method,…>   web のみ：許可するメソッドのリスト（メソッド名または <namespace>.*）。既定のセットより
                                   狭めることだけができます
  baocut services mcp add-client <name>
                                   外部アプリ用のトークンを作成（表示は今回限り）。アプリごとに 1 つ作成し、
                                   それぞれ個別に撤回できます
  baocut services mcp clients      作成済みのクライアントを一覧表示（トークンは含みません）
  baocut services mcp revoke <clientId>
                                   クライアントを撤回する。そのトークンはすぐに使えなくなります
  baocut services mcp connection [clientId]
                                   アドレスと、MCP クライアントの設定に貼り付けるスニペットを表示
                                   （トークンはプレースホルダ）
  baocut services model-api add-client|clients|revoke|connection …
                                   モデル API サービス（ローカルの OpenAI 形式のエンドポイント）のクライアント。
                                   使い方は上と同じ。そのトークンと MCP のトークンは互いに使えません。
                                   connection は OPENAI_BASE_URL と OPENAI_API_KEY の設定方法を表示
  baocut services model-api aliases
                                   モデル名のエイリアスを一覧表示（既定は whisper-1 → ローカルの既定の文字起こしモデル）
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   エイリアスを追加または変更。モデルを省略するとプロバイダの既定のモデルを使います
  baocut services model-api unalias <name>
                                   エイリアスを削除
  baocut services web sessions     ブラウザセッションを一覧表示（セッショントークンは含みません）
  baocut services web revoke <sessionId>
                                   ブラウザセッションを撤回する：その接続はすぐに切断されます`,
  webHelp: `使い方：
  baocut web open [--video <videoId>] [--launch]       Web サービスを起動し（既定のポートは ${WEB_DEFAULT_PORT}）、1 回限りのアクセスリンクを表示。
                                   リンクは 1 回だけ、2 分間有効です。--launch は既定のブラウザでコードなしのサインイン
                                   ページを開きます。アクセスコードはターミナルにだけ表示されるので、サインインページに
                                   貼り付けてください（コードはブラウザを開くコマンドの引数には渡しません）
                                   --video は対象の動画をエディタで直接開きます（videoId は baocut videos list で確認できます）。`,
  usage:
    '使い方：baocut services [status | start <service> | stop <service>\n' +
    '        | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                     [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                     [--read-only on|off] [--methods default|<method,…>]\n' +
    '        | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '        | mcp|model-api connection [clientId]\n' +
    '        | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' +
    '        | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `不明なサービス：${id}。使えるのは ${available.join('、')} です`,
  addClientUsage: (service) =>
    `使い方：baocut services ${service} add-client <name>（見分けのつく名前を付けてください。例：${service === 'mcp' ? 'Claude Desktop' : '字幕ツール'}）`,
  aliasUsage: (capabilities) =>
    `使い方：baocut services model-api alias <name> <capability> <providerId>[/<modelId>]（機能：${capabilities.join('、')}）`,
  unknownCapability: (capability, available) => `不明な機能：${capability}。使えるのは ${available.join('、')} です`,
  onOff: (flag) => `${flag} には on または off を指定してください`,
  portRange: '--port には 1 から 65535 までの整数を指定してください',
  levelChoice: (levels) => `--level には ${levels.join('、')} のいずれかを指定してください`,
  videosFormat: '--videos には all またはカンマ区切りの動画 ID を指定してください',
  maxConcurrentRange: '--max-concurrent には 1 から 64 までの整数を指定してください',
  routingOnlyModelApi: '--route-online、--route-nodes、--route-agent、--max-concurrent は model-api にのみ適用されます',
  methodsFormat: '--methods には default、またはカンマ区切りのメソッド名と <namespace>.* を指定してください',
  webOnlyFlags: '--read-only と --methods は Web サービスにのみ適用されます',
  nothingToConfigure:
    '変更する内容がありません：--port、--level、--videos、--autostart、model-api の転送先と同時実行数、または web の --read-only と --methods を指定してください',
  states: {
    off: 'オフ',
    starting: '起動中',
    on: 'オン',
    stopping: '停止中',
    error: 'エラー',
  },
  levels: {
    read: 'read（読み取り専用）',
    ask: 'ask（書き込みを毎回確認）',
    auto: 'auto（そのまま実行）',
  },
  levelAskModelApi: 'ask（生成リクエストを毎回確認）',
  notProvided: (serviceId, label) => `${serviceId}  ${label}  このバージョンでは利用できません`,
  port: (port) => `ポート ${port}`,
  reason: (error) => `  理由：${error}`,
  nodeHint: '  ポート、機能、ペアリングには baocut share を使ってください',
  autostart: (on) => `  Runtime と一緒に起動：${on ? 'はい' : 'いいえ'}`,
  level: (level) => `  レベル：${level}`,
  levelScope: (level, scope) => `  レベル：${level}  範囲：${scope}`,
  allVideos: 'すべての動画',
  someVideos: (ids) => `${ids.length} 本の動画（${ids.join('、')}）`,
  routeLocal: 'このコンピュータ',
  routeOnline: 'オンラインサービス',
  routeNodes: 'LAN ノード',
  routeAgent: 'Agent',
  routing: (routes, maxConcurrent) => `  転送先：${routes.join('、')}  クライアントごとの同時リクエスト ${maxConcurrent} 件`,
  aliases: (aliases) => `  エイリアス：${aliases.length > 0 ? aliases.join('、') : 'なし'}`,
  clientCount: (count) => `  クライアント：${count} 件`,
  web: (readOnly, methods) =>
    `  読み取り専用：${readOnly ? 'はい' : 'いいえ'}  許可するメソッド：${methods === null ? '既定のセット' : methods.join('、')}`,
  browserSessions: (count) => `  ブラウザセッション：${count} 件（アクセスリンク：baocut web open）`,
  aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? '既定のモデル'}（${capability}）`,
  noAliases: 'エイリアスはありません。baocut services model-api alias <name> <capability> <providerId>[/<modelId>] で追加してください',
  noClients: (service) => `クライアントはありません。baocut services ${service} add-client <name> で作成してください`,
  client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  作成 ${createdAt}  最終使用 ${lastUsedAt ?? 'なし'}`,
  clientCreated: (name, clientId) => `クライアント ${name}（${clientId}）を作成しました`,
  tokenOnce: (token) =>
    `トークン（表示は今回限りです。今すぐコピーして保存してください。なくした場合はクライアントを撤回して新しく作成してください）：${token}`,
  address: (url) => `URL：${url}`,
  bearerHeader: 'ヘッダ：Authorization: Bearer <token>',
  header: (value) => `ヘッダ：Authorization: ${value}`,
  interfaceVersion: (version) => `インターフェースのバージョン：${version}`,
  snippetIntro: '設定スニペット（トークンのプレースホルダを、クライアント作成時に受け取ったトークンに置き換えてください）：',
  noWebSessions: 'ブラウザセッションはありません。baocut web open でアクセスリンクを取得してください',
  webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) =>
    `${sessionId}  サインイン ${createdAt}  最終使用 ${lastUsedAt}  期限 ${expiresAt}  接続 ${connections} 件`,
  accessLinkNote: (expiresAt) =>
    `このリンクは 1 回だけ使え、${expiresAt} まで有効です。ほかの人には共有しないでください。使用済みまたは期限切れになったら、もう一度 baocut web open を実行してください`,
  badAccessLink: 'アクセスリンクの形式が想定と異なります：BaoCut を更新するか、--launch を付けずにもう一度実行してください',
  accessCode: (code) => `アクセスコード：${code}`,
  launchNote: (loginUrl, expiresAt) =>
    `ブラウザで開いたサインインページ（${loginUrl}）にこのコードを貼り付けてください。コードは 1 回だけ使え、${expiresAt} まで有効です。ほかの人には共有しないでください。使用済みまたは期限切れになったら、もう一度 baocut web open を実行してください`,
  webNotStarted: (reason) => `Web サービスが起動しませんでした：${reason}`,
  serviceError: (serviceId, reason) => `${serviceId} でエラーが発生しました：${reason}`,
  clientRevoked: (clientId) => `${clientId} を撤回しました。そのトークンはすぐに使えなくなります`,
  webSessionRevoked: (sessionId) => `${sessionId} を撤回しました。その接続は切断されました`,
  browserFailed: (message) => `ブラウザを開けませんでした：${message}。上のサインインページを手動で開いてください`,
};
