import type { McpMessages } from './mcp-copy.ts';

export const ja: McpMessages = {

  previousClientUnknown: '置き換えたエントリが使っていたクライアントを特定できなかったため、クライアントは撤回していません。baocut mcp status で既存のクライアントを確認し、使わないものは baocut services mcp revoke <clientId> で撤回してください。',
  defaultProjectRegistered: (name, path) => `BaoCut にプロジェクトがなかったため、外部 Agent が動画を作成する既定のプロジェクト「${name}」（${path}）を登録しました`,
  help: `使い方：
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <client name>] [--yes]
                                   外部の Agent を BaoCut の MCP サービスに接続：サービスを起動し（Runtime と一緒に起動する
                                   ように設定）、その Agent 用に新しいクライアントとトークンを作成して、アドレスとトークンを
                                   Agent の MCP 設定（エントリ名 baocut）に書き込みます。その後 Agent を再起動してください
                                   BaoCut にプロジェクトがない場合、外部 Agent 用の CLI プロジェクトを既定のプロジェクトフォルダに登録します
    --level ask|auto               アクセスレベル：ask は書き込みとタスクを毎回 BaoCut で確認（サービスの既定）、auto は
                                   そのまま実行。省略すると現在のレベルを維持
    --name <client name>           BaoCut に表示するクライアント名（既定は Agent の名前）。個別に撤回できます
    --yes                          Agent の設定にすでに baocut エントリがある場合は置き換え、古いエントリが使っていた
                                   クライアントを撤回します（古いトークンから識別。識別できない場合は同じ名前のクライアントを
                                   一覧表示するので、どれを撤回するか判断してください）。指定しないと何も上書きせず、
                                   クライアントも作成しません
  トークンの保存先：Claude Code では ~/.claude/settings.json の env（BAOCUT_MCP_TOKEN）に保存し、設定からは参照するだけです。
  Codex（~/.codex/config.toml）、Cursor（~/.cursor/mcp.json）、Gemini CLI（~/.gemini/settings.json）には環境変数を置く場所が
  ないため、トークンは設定ファイルに平文で書き込まれます：これらのファイルはコミットや共有をせず、レベルは ask を推奨します。
  トークンが漏れた場合は baocut services mcp revoke <clientId> で撤回してください。
  サービスは BaoCut の Runtime の実行中だけ利用できます（BaoCut を開くか、baocut runtime ensure を実行）。
  baocut mcp status                MCP サービスの状態、アドレス、レベル、クライアント、各 Agent の設定に baocut エントリが
                                   あるかどうか（トークンは含みません）`,
  entryExists: (file, entry) => `${file} にはすでに ${entry} エントリがあります。何も変更していません。置き換えるには --yes を付けてください`,
  serviceNotAvailable: 'このバージョンの BaoCut は MCP サービスを提供していません',
  serviceStartFailed: (reason) => `MCP サービスが起動しませんでした：${reason ?? '理由不明'}`,
  connected: (host, url) => `${host} を BaoCut の MCP サービスに接続しました：${url}`,
  configEnv: (configFile, envFile, envVar) =>
    `設定：${configFile}（トークンは ${envFile} の env.${envVar} にあり、設定からは参照するだけです）`,
  configPlaintext: (configFile, clientId) =>
    `設定：${configFile}（トークンはこのファイルに平文で書き込まれています：コミットや共有はしないでください。漏れた場合は baocut services mcp revoke ${clientId} で撤回してください）`,
  clientLine: (name, clientId, level) => `クライアント：${name}（${clientId}）  レベル：${level ?? '—'}`,
  restartHint: (host) =>
    `${host} を再起動すると有効になります。サービスは BaoCut の Runtime と一緒に動きます：Runtime が実行中でなければ、先に BaoCut を開くか baocut runtime ensure を実行してください`,
  replacedRevoked: (name, clientId) => `古いエントリを置き換え、それが使っていたクライアントを撤回しました：${name}（${clientId}）`,
  replacedRevokeFailed: (reason) => `古いエントリを置き換えましたが、それが使っていたクライアントを失効させられませんでした：${reason}`,
  oldClientRemains: (ids) =>
    `古いクライアントがまだ残っています：${ids.join('、')}。使わない場合：baocut services mcp revoke <clientId>`,
  sameNameClientsRemain: (ids, unrecognized) =>
    `${unrecognized ? '古いエントリがどのクライアントを使っていたか判別できませんでした。' : ''}同じ名前のクライアントがまだ残っています：${ids.join('、')}。使わない場合：baocut services mcp revoke <clientId>`,
  hostsHeading: (entry) => `各 Agent の設定に ${entry} エントリがあるかどうか：`,
  hostUnreadable: (problem) => `読み取れません（${problem}）`,
  hostConfigured: 'あり',
  hostNotConfigured: 'なし',
  noServiceStatus: 'Runtime から MCP サービスの状態が報告されませんでした',
  levelChoice: (value) => `--level には ask または auto を指定してください：${value}`,
};
