import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const zhHant: ServicesMessages = {

  accessLinkVideo: (video) => `登入後會直接開啟影片 ${video} 的編輯器`,
  help: `用法：
  baocut services [status]         對外服務：MCP 服務、模型 API 服務、Web 服務與區域網路節點的
                                   狀態、位址、等級與範圍
  baocut services start <service>  啟動一項服務（mcp、model-api、web、node）
  baocut services stop <service>   停止一項服務（中斷外部連線並取消待確認的請求；
                                   已提交的任務會照常執行完畢）
  baocut services configure <service> [options]
    --port <port>                  監聽的連接埠（僅限本機回送位址；MCP 預設為 ${MCP_DEFAULT_PORT}，模型 API 預設為
                                   ${MODEL_API_DEFAULT_PORT}）；連接埠被佔用時服務會回報錯誤，不會改用其他連接埠
    --level read|ask|auto          read 為唯讀；ask 由你在 BaoCut 中逐一確認每次寫入、任務與生成（預設）；
                                   auto 直接執行
    --videos all|<id,…>            開放所有影片，或只開放這些 videoId（以逗號分隔）；範圍外的影片對外不可見
                                   （模型 API 服務沒有範圍）
    --autostart on|off             隨 Runtime 啟動
    --route-online on|off          模型 API 服務：將請求轉送給已啟用的線上服務（預設 off，只使用本機模型）
    --route-nodes on|off           模型 API 服務：轉送給已配對的區域網路節點（預設 off）
    --route-agent on|off           模型 API 服務：轉送給 Agent 供應商（預設 off）
    --max-concurrent <n>           模型 API 服務：每個用戶端同時處理中的請求數（預設 4）；超出上限的請求會收到 429
    --read-only on|off             僅限 web：瀏覽器只能檢視，不能編輯、傳送訊息或提交任務
    --methods default|<method,…>   僅限 web：方法允許清單（方法名稱或 <namespace>.*），只能在預設集合內縮小
  baocut services mcp add-client <name>
                                   為外部應用程式建立權杖（只會顯示這一次）；
                                   每個應用程式一個，可分別撤銷
  baocut services mcp clients      列出已建立的用戶端（不含權杖）
  baocut services mcp revoke <clientId>
                                   撤銷一個用戶端，它的權杖會立即失效
  baocut services mcp connection [clientId]
                                   印出位址，以及可貼到 MCP 用戶端設定中的片段
                                   （權杖以預留位置表示）
  baocut services model-api add-client|clients|revoke|connection …
                                   模型 API 服務（本機的 OpenAI 風格端點）的用戶端，用法同上；
                                   它的權杖與 MCP 的權杖不能互換；
                                   connection 會印出 OPENAI_BASE_URL 與 OPENAI_API_KEY 的設定方式
  baocut services model-api aliases
                                   列出模型名稱的別名（預設 whisper-1 → 本機的預設轉錄模型）
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   新增或變更別名；未指定模型時使用該供應商的預設模型
  baocut services model-api unalias <name>
                                   刪除別名
  baocut services web sessions     列出瀏覽器工作階段（不含工作階段權杖）
  baocut services web revoke <sessionId>
                                   撤銷一個瀏覽器工作階段：它的連線會立即中斷`,
  webHelp: `用法：
  baocut web open [--video <videoId>] [--launch]       啟動 Web 服務（預設連接埠 ${WEB_DEFAULT_PORT}）並印出一次性存取連結；連結只能使用
                                   一次，兩分鐘內有效。--launch 會在預設瀏覽器中開啟不含代碼的登入頁面；存取代碼
                                   只會印在終端機中，供你貼到登入頁面（代碼不會經由開啟瀏覽器的指令引數傳遞）
                                   --video 會直接在編輯器中開啟該影片（videoId 來自 baocut videos list）。`,
  usage:
    '用法：baocut services [status | start <service> | stop <service>\n' +
    '       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                    [--read-only on|off] [--methods default|<method,…>]\n' +
    '       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '       | mcp|model-api connection [clientId]\n' +
    '       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' +
    '       | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `未知的服務：${id}。可用的有：${available.join('、')}`,
  addClientUsage: (service) =>
    `用法：baocut services ${service} add-client <name>（取一個你認得出的名稱，例如 ${service === 'mcp' ? 'Claude Desktop' : '字幕工具'}）`,
  aliasUsage: (capabilities) =>
    `用法：baocut services model-api alias <name> <capability> <providerId>[/<modelId>]（能力：${capabilities.join('、')}）`,
  unknownCapability: (capability, available) => `未知的能力：${capability}。可用的有：${available.join('、')}`,
  onOff: (flag) => `${flag} 必須是 on 或 off`,
  portRange: '--port 必須是 1 至 65535 的整數',
  levelChoice: (levels) => `--level 必須是 ${levels.join('、')} 其中之一`,
  videosFormat: '--videos 必須是 all，或以逗號分隔的影片 ID',
  maxConcurrentRange: '--max-concurrent 必須是 1 至 64 的整數',
  routingOnlyModelApi: '--route-online、--route-nodes、--route-agent 與 --max-concurrent 只適用於 model-api',
  methodsFormat: '--methods 必須是 default，或以逗號分隔的方法名稱與 <namespace>.*',
  webOnlyFlags: '--read-only 與 --methods 只適用於 web 服務',
  nothingToConfigure:
    '沒有要變更的設定：請指定 --port、--level、--videos、--autostart、model-api 的轉送與並行設定，或 web 的 --read-only 與 --methods',
  states: {
    off: '已關閉',
    starting: '啟動中',
    on: '已開啟',
    stopping: '停止中',
    error: '錯誤',
  },
  levels: {
    read: 'read（唯讀）',
    ask: 'ask（逐一確認每次寫入）',
    auto: 'auto（直接執行）',
  },
  levelAskModelApi: 'ask（逐一確認每個生成請求）',
  notProvided: (serviceId, label) => `${serviceId}  ${label}  這個版本未提供`,
  port: (port) => `連接埠 ${port}`,
  reason: (error) => `  原因：${error}`,
  nodeHint: '  連接埠、能力與配對請使用 baocut share',
  autostart: (on) => `  隨 Runtime 啟動：${on ? '是' : '否'}`,
  level: (level) => `  等級：${level}`,
  levelScope: (level, scope) => `  等級：${level}  範圍：${scope}`,
  allVideos: '所有影片',
  someVideos: (ids) => `${ids.length} 部影片（${ids.join('、')}）`,
  routeLocal: '這台電腦',
  routeOnline: '線上服務',
  routeNodes: '區域網路節點',
  routeAgent: 'Agent',
  routing: (routes, maxConcurrent) => `  轉送到：${routes.join('、')}  每個用戶端同時 ${maxConcurrent} 個請求`,
  aliases: (aliases) => `  別名：${aliases.length > 0 ? aliases.join('、') : '無'}`,
  clientCount: (count) => `  用戶端：${count} 個`,
  web: (readOnly, methods) => `  唯讀：${readOnly ? '是' : '否'}  允許的方法：${methods === null ? '預設集合' : methods.join('、')}`,
  browserSessions: (count) => `  瀏覽器工作階段：${count} 個（存取連結：baocut web open）`,
  aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? '預設模型'}（${capability}）`,
  noAliases: '沒有別名。請用 baocut services model-api alias <name> <capability> <providerId>[/<modelId>] 新增',
  noClients: (service) => `沒有用戶端。請用 baocut services ${service} add-client <name> 建立`,
  client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  建立於 ${createdAt}  上次使用 ${lastUsedAt ?? '從未使用'}`,
  clientCreated: (name, clientId) => `已建立用戶端 ${name}（${clientId}）`,
  tokenOnce: (token) => `權杖（只會顯示這一次，請立即複製並保存；遺失時請撤銷這個用戶端並建立新的）：${token}`,
  address: (url) => `URL：${url}`,
  bearerHeader: '標頭：Authorization: Bearer <token>',
  header: (value) => `標頭：Authorization: ${value}`,
  interfaceVersion: (version) => `介面版本：${version}`,
  snippetIntro: '設定片段（請將權杖預留位置換成建立用戶端時取得的權杖）：',
  noWebSessions: '沒有瀏覽器工作階段。請用 baocut web open 取得存取連結',
  webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) =>
    `${sessionId}  登入於 ${createdAt}  上次使用 ${lastUsedAt}  到期 ${expiresAt}  ${connections} 個連線`,
  accessLinkNote: (expiresAt) =>
    `這個連結只能使用一次，有效期限至 ${expiresAt}；請勿分享。使用過或過期後，請再執行一次 baocut web open`,
  badAccessLink: '存取連結的格式不符預期：請更新 BaoCut，或不加 --launch 重新執行',
  accessCode: (code) => `存取代碼：${code}`,
  launchNote: (loginUrl, expiresAt) =>
    `請將這個代碼貼到瀏覽器中開啟的登入頁面（${loginUrl}）。代碼只能使用一次，有效期限至 ${expiresAt}；請勿分享。使用過或過期後，請再執行一次 baocut web open`,
  webNotStarted: (reason) => `Web 服務未能啟動：${reason}`,
  serviceError: (serviceId, reason) => `${serviceId} 發生錯誤：${reason}`,
  clientRevoked: (clientId) => `已撤銷 ${clientId}，它的權杖會立即失效`,
  webSessionRevoked: (sessionId) => `已撤銷 ${sessionId}，它的連線已關閉`,
  browserFailed: (message) => `無法開啟瀏覽器：${message}。請自行開啟上方的登入頁面`,
};
