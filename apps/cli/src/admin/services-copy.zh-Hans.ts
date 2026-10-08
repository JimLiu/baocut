import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const zhHans: ServicesMessages = {
  accessLinkVideo: (video) => `登录后直接打开视频 ${video} 的编辑器`,

  help: `用法：
  baocut services [status]         对外服务：MCP 服务、模型接口服务、Web 服务与局域网节点的状态、地址、等级与范围
  baocut services start <服务>     开启一个服务（mcp、model-api、web、node）
  baocut services stop <服务>      停止一个服务（断开外部连接，取消待确认的请求；已提交的任务照常跑完）
  baocut services configure <服务> [选项]
    --port <端口>                  监听的端口（只在本机回环地址上；MCP 默认 ${MCP_DEFAULT_PORT}，模型接口 ${MODEL_API_DEFAULT_PORT}）；
                                   被占用时服务出错，不换端口
    --level read|ask|auto          read 只读；ask 写入、任务与生成逐次由你在 BaoCut 里确认（默认）；auto 直接执行
    --videos all|<id,…>            开放全部视频，或只开放这些 videoId（逗号分隔）；范围之外的视频对外不可见（模型接口服务没有范围）
    --autostart on|off             随 Runtime 启动
    --route-online on|off          模型接口服务：把请求转给已启用的在线服务（默认 off，只用本机模型）
    --route-nodes on|off           模型接口服务：转给已配对的局域网节点（默认 off）
    --route-agent on|off           模型接口服务：转给智能体 Provider（默认 off）
    --max-concurrent <n>           模型接口服务：每个客户端同时在途的请求数（默认 4），超出的回答 429
    --read-only on|off             只用于 web：浏览器只能查看，不能编辑、发消息或提交任务
    --methods default|<方法,…>     只用于 web：方法白名单（方法名或 <命名空间>.*），只能在默认集合之内收紧
  baocut services mcp add-client <名字>
                                   为一个外部应用创建令牌（只显示这一次）；每个应用一个，可以单独吊销
  baocut services mcp clients      列出已创建的客户端（不含令牌）
  baocut services mcp revoke <clientId>
                                   吊销一个客户端，它的令牌立即失效
  baocut services mcp connection [clientId]
                                   打印地址与可以粘进 MCP 客户端配置的片段（令牌用占位符）
  baocut services model-api add-client|clients|revoke|connection …
                                   模型接口服务（OpenAI 形状的本机端点）的客户端，用法同上；令牌与 MCP 的互不通用；
                                   connection 打印 OPENAI_BASE_URL 与 OPENAI_API_KEY 的写法
  baocut services model-api aliases
                                   列出模型名的别名（默认 whisper-1 → 本机的默认转写模型）
  baocut services model-api alias <名字> <能力> <providerId>[/<modelId>]
                                   添加或改一个别名；不给模型时用那个 Provider 的默认模型
  baocut services model-api unalias <名字>
                                   删除一个别名
  baocut services web sessions     列出浏览器会话（不含会话令牌）
  baocut services web revoke <sessionId>
                                   吊销一个浏览器会话：它的连接立即断开`,
  webHelp: `用法：
  baocut web open [--video <videoId>] [--launch]       开启 Web 服务（默认端口 ${WEB_DEFAULT_PORT}），打印一个一次性的访问链接；
                                   链接只能用一次、两分钟内有效。--video 让链接直达这个视频的编辑器（videoId 取自
                                   baocut videos list）。--launch 用默认浏览器打开不带代码的登录页，
                                   访问代码只打在终端里，粘进登录页（代码不经过打开浏览器的命令的参数）`,
  usage:
    '用法：baocut services [status | start <服务> | stop <服务>\n' +
    '       | configure <服务> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                    [--read-only on|off] [--methods default|<方法,…>]\n' +
    '       | mcp|model-api add-client <名字> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '       | mcp|model-api connection [clientId]\n' +
    '       | model-api aliases | model-api alias <名字> <能力> <providerId>[/<modelId>] | model-api unalias <名字>\n' +
    '       | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `不认识的服务：${id}。可用的有：${available.join('、')}`,
  addClientUsage: (service) =>
    `用法：baocut services ${service} add-client <名字>（起个认得出的名字，例如 ${service === 'mcp' ? 'Claude Desktop' : '字幕工具'}）`,
  aliasUsage: (capabilities) =>
    `用法：baocut services model-api alias <名字> <能力> <providerId>[/<modelId>]（能力：${capabilities.join('、')}）`,
  unknownCapability: (capability, available) => `不认识的能力：${capability}。可用的有：${available.join('、')}`,
  onOff: (flag) => `${flag} 要是 on 或 off`,
  portRange: '--port 要是 1 到 65535 之间的整数',
  levelChoice: (levels) => `--level 要是 ${levels.join('、')} 之一`,
  videosFormat: '--videos 要是 all，或逗号分隔的视频 ID',
  maxConcurrentRange: '--max-concurrent 要是 1 到 64 之间的整数',
  routingOnlyModelApi: '--route-online、--route-nodes、--route-agent 与 --max-concurrent 只适用于 model-api',
  methodsFormat: '--methods 要是 default，或逗号分隔的方法名与 <命名空间>.*',
  webOnlyFlags: '--read-only 与 --methods 只用于 web 服务',
  nothingToConfigure: '没有要改的配置：给 --port、--level、--videos、--autostart，model-api 的路由与并发，或 web 的 --read-only 与 --methods',
  states: {
    off: '关闭',
    starting: '正在开启',
    on: '开着',
    stopping: '正在停止',
    error: '出错',
  },
  levels: {
    read: 'read（只读）',
    ask: 'ask（写入逐次确认）',
    auto: 'auto（直接执行）',
  },
  levelAskModelApi: 'ask（生成请求逐次确认）',
  notProvided: (serviceId, label) => `${serviceId}  ${label}  这个版本不提供`,
  port: (port) => `端口 ${port}`,
  reason: (error) => `  原因：${error}`,
  nodeHint: '  端口、能力与配对用 baocut share',
  autostart: (on) => `  随 Runtime 启动：${on ? '是' : '否'}`,
  level: (level) => `  等级：${level}`,
  levelScope: (level, scope) => `  等级：${level}  范围：${scope}`,
  allVideos: '全部视频',
  someVideos: (ids) => `${ids.length} 个视频（${ids.join('、')}）`,
  routeLocal: '本机',
  routeOnline: '在线服务',
  routeNodes: '局域网节点',
  routeAgent: '智能体',
  routing: (routes, maxConcurrent) => `  路由到：${routes.join('、')}  每个客户端同时 ${maxConcurrent} 个请求`,
  aliases: (aliases) => `  别名：${aliases.length > 0 ? aliases.join('、') : '无'}`,
  clientCount: (count) => `  客户端：${count} 个`,
  web: (readOnly, methods) => `  只读：${readOnly ? '是' : '否'}  方法白名单：${methods === null ? '默认集合' : methods.join('、')}`,
  browserSessions: (count) => `  浏览器会话：${count} 个（访问链接：baocut web open）`,
  aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? '默认模型'}（${capability}）`,
  noAliases: '没有别名。用 baocut services model-api alias <名字> <能力> <providerId>[/<modelId>] 添加',
  noClients: (service) => `没有客户端。用 baocut services ${service} add-client <名字> 创建`,
  client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  创建于 ${createdAt}  最近使用 ${lastUsedAt ?? '从未'}`,
  clientCreated: (name, clientId) => `已创建客户端 ${name}（${clientId}）`,
  tokenOnce: (token) => `令牌（只显示这一次，现在复制保存；丢了就吊销再建一个）：${token}`,
  address: (url) => `地址：${url}`,
  bearerHeader: '请求头：Authorization: Bearer <令牌>',
  header: (value) => `请求头：Authorization: ${value}`,
  interfaceVersion: (version) => `接口版本：${version}`,
  snippetIntro: '配置片段（把令牌占位换成创建客户端时拿到的令牌）：',
  noWebSessions: '没有浏览器会话。用 baocut web open 取得访问链接',
  webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) =>
    `${sessionId}  登录于 ${createdAt}  最近使用 ${lastUsedAt}  到期 ${expiresAt}  连接 ${connections} 个`,
  accessLinkNote: (expiresAt) =>
    `这个链接只能用一次，${expiresAt} 之前有效；不要发给别人。用过或过期了就再运行一次 baocut web open`,
  badAccessLink: '访问链接的格式不对：请升级 BaoCut 或不带 --launch 重新运行',
  accessCode: (code) => `访问代码：${code}`,
  launchNote: (loginUrl, expiresAt) =>
    `在浏览器打开的登录页（${loginUrl}）里粘贴这个代码。代码只能用一次，${expiresAt} 之前有效；不要发给别人。用过或过期了就再运行一次 baocut web open`,
  webNotStarted: (reason) => `Web 服务没有开起来：${reason}`,
  serviceError: (serviceId, reason) => `${serviceId} 出错：${reason}`,
  clientRevoked: (clientId) => `已吊销 ${clientId}，它的令牌立即失效`,
  webSessionRevoked: (sessionId) => `已吊销 ${sessionId}，它的连接已断开`,
  browserFailed: (message) => `打不开浏览器：${message}；请手动打开上面的登录页`,
};
