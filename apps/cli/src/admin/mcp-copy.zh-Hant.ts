import type { McpMessages } from './mcp-copy.ts';

export const zhHant: McpMessages = {

  previousClientUnknown: '無法辨識被取代的項目使用哪個用戶端，因此沒有撤銷任何用戶端：baocut mcp status 會列出現有用戶端；請用 baocut services mcp revoke <clientId> 撤銷不再使用的用戶端。',
  defaultProjectRegistered: (name, path) => `BaoCut 尚無專案：已登記預設專案「${name}」（${path}），供外部 Agent 在其中建立影片`,
  help: `用法：
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <client name>] [--yes]
                                   將外部 Agent 連接到 BaoCut 的 MCP 服務：啟動服務（並設為隨 Runtime 啟動），
                                   為這個 Agent 建立新的用戶端與權杖，將位址與權杖寫入 Agent 的 MCP 設定（項目名稱 baocut），
                                   之後重新啟動 Agent
                                   BaoCut 尚無專案時，會在預設專案資料夾中登記 CLI 專案，供外部 Agent 使用
    --level ask|auto               存取等級：ask 由你在 BaoCut 中逐一確認每次寫入與任務（服務的預設）；auto 直接執行。
                                   省略時維持目前的等級
    --name <client name>           在 BaoCut 中顯示的用戶端名稱（預設為 Agent 的名稱），可單獨撤銷
    --yes                          Agent 的設定中已有 baocut 項目時，取代它並撤銷舊項目使用的用戶端（從舊權杖辨識；
                                   無法辨識時列出同名的用戶端，由你決定撤銷哪一個）。未加時不會覆寫，也不會建立用戶端
  權杖存放位置：Claude Code 會存放在 ~/.claude/settings.json 的 env（BAOCUT_MCP_TOKEN）中，設定裡只寫參照。
  Codex（~/.codex/config.toml）、Cursor（~/.cursor/mcp.json）與 Gemini CLI（~/.gemini/settings.json）沒有放環境變數的位置，
  因此權杖會以明文寫入它們的設定檔：請勿提交或分享這些檔案，建議使用 ask 等級；權杖外洩時請用
  baocut services mcp revoke <clientId> 撤銷。
  只有在 BaoCut 的 Runtime 執行時才能使用這項服務（開啟 BaoCut，或執行 baocut runtime ensure）。
  baocut mcp status                MCP 服務的狀態、位址、等級與用戶端，以及各 Agent 的設定中是否有 baocut 項目（不含權杖）`,
  entryExists: (file, entry) => `${file} 中已有 ${entry} 項目，未做任何變更。加上 --yes 即可取代`,
  serviceNotAvailable: '這個版本的 BaoCut 不提供 MCP 服務',
  serviceStartFailed: (reason) => `MCP 服務未能啟動：${reason ?? '原因不明'}`,
  connected: (host, url) => `已將 ${host} 連接到 BaoCut 的 MCP 服務：${url}`,
  configEnv: (configFile, envFile, envVar) => `設定：${configFile}（權杖在 ${envFile} 的 env.${envVar} 中，設定裡只是參照）`,
  configPlaintext: (configFile, clientId) =>
    `設定：${configFile}（權杖以明文寫在這個檔案中：請勿提交或分享；外洩時請用 baocut services mcp revoke ${clientId} 撤銷）`,
  clientLine: (name, clientId, level) => `用戶端：${name}（${clientId}）  等級：${level ?? '—'}`,
  restartHint: (host) =>
    `重新啟動 ${host} 後生效。服務隨 BaoCut 的 Runtime 執行：如果 Runtime 未在執行，請先開啟 BaoCut 或執行 baocut runtime ensure`,
  replacedRevoked: (name, clientId) => `已取代舊項目，並撤銷它使用的用戶端：${name}（${clientId}）`,
  replacedRevokeFailed: (reason) => `已取代舊項目，但無法撤銷它使用的用戶端：${reason}`,
  oldClientRemains: (ids) => `舊的用戶端仍然存在：${ids.join('、')}。不再使用時請執行 baocut services mcp revoke <clientId>`,
  sameNameClientsRemain: (ids, unrecognized) =>
    `${unrecognized ? '無法辨識舊項目使用的是哪個用戶端；' : ''}同名的用戶端仍然存在：${ids.join('、')}。不再使用時請執行 baocut services mcp revoke <clientId>`,
  hostsHeading: (entry) => `各 Agent 的設定中是否有 ${entry} 項目：`,
  hostUnreadable: (problem) => `無法讀取（${problem}）`,
  hostConfigured: '有',
  hostNotConfigured: '無',
  noServiceStatus: 'Runtime 未回報 MCP 服務的狀態',
  levelChoice: (value) => `--level 必須是 ask 或 auto：${value}`,
};
