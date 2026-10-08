import type { DriversAcpMessages } from './drivers-acp.ts';

export const ja: DriversAcpMessages = {
  copilotPlan: 'GitHub Copilot サブスクリプション',
  copilotLoginHint: 'ターミナルで copilot login を実行してサインイン（または copilot の対話モードで /login を入力）',
  copilotInstallHint: 'GitHub Copilot CLI をインストールしてください（npm install -g @github/copilot）',
  geminiPlan: 'Google アカウント',
  geminiLoginHint: 'ターミナルで gemini を実行して Google アカウントでのサインインを選ぶか、~/.gemini/.env に GEMINI_API_KEY=… を記述',
  geminiInstallHint: 'Gemini CLI をインストールしてください（brew install gemini-cli）',
  cursorPlan: 'Cursor サブスクリプション',
  cursorInstallHint: '公式スクリプトで Cursor Agent をインストールしてください',
  grokPlan: 'xAI アカウント',
  grokInstallHint: '公式スクリプトで Grok CLI をインストールしてください',
  kimiPlan: 'Kimi アカウント',
  kimiInstallHint: '公式の手順に従って Kimi Code をインストールしてください（https://github.com/MoonshotAI/kimi-code）',
  customNoCommand: (p) => `Agent ${p.id} にはコマンドが指定されていません`,
  customInstallHint: (p) => `${p.command} がインストールされ PATH 上にあるか確認するか、絶対パスで追加し直してください`,
  loginViaTerminal: (p) => `ターミナルで ${p.command} を実行してサインイン`,
  loginPerInstructions: '表示される手順に従ってサインイン',
  signedOut: (p) => `${p.name} はサインインしていません：${p.login}。${p.detail ? `（${p.detail}）` : ''}`,
  probeTimeout: (p) => `${p.name} が ${p.seconds} 秒以内に応答しませんでした`,
  acpModeFailed: (p) => `${p.name} を ACP モードで起動できませんでした：${p.error}`,
  exitCode: (p) => `終了コード ${p.code}`,
  exited: (p) => `${p.name} が終了しました（${p.status}）${p.tail ? `：${p.tail}` : ''}`,
  exitedBeforeInit: (p) => `${p.name} が初期化の前に終了しました`,
  initTimeout: (p) => `${p.name} の ACP 初期化が時間内に完了しませんでした`,
  mcpHttpUnsupported: (p) =>
    `${p.name} は HTTP 経由で MCP サーバに接続できないため、このセッションでは BaoCut のツール（プロジェクトや字幕の読み取りと編集など）を使用できません。`,
  resumeUnsupported: (p) => `${p.name} はセッションの再開に対応していません`,
  onlyAlwaysAllow: (p) =>
    `${p.name} は今回「常に許可」しか提示しませんでした。BaoCut が代わりにその設定へ書き込むことはないため、このリクエストは拒否しました。`,
  modeSwitchFailed: (p) => `${p.name} のセッションモードを切り替えられませんでした（${p.mode}）：${p.error}`,
  noAllowAllSwitch: (p) =>
    `この ${p.name} セッションには「すべて許可」のスイッチ（${p.configId}）がないため、フルアクセスでも操作ごとに確認します。`,
  setOptionFailed: (p) => `${p.name} で ${p.configId}=${p.value} を設定できませんでした：${p.error}`,
  stillAskThisTurn: (p) => `${p.failure}。このターンは引き続き操作ごとに確認します。`,
  noMatchingMode: (p) =>
    `${p.name} にはこのアクセスモードに対応するセッションモードがないため、${p.name} 自身の既定の設定で実行します。承認が必要な操作は、引き続き BaoCut がアクセスモードに従って確認します。`,
  modelSwitchUnsupported: (p) => `${p.name} はセッション内でモデルを切り替えられないため、現在のモデルを使い続けます。`,
};
