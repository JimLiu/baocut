import type { McpMessages } from './mcp-copy.ts';

export const zhHans: McpMessages = {
  previousClientUnknown: "替换了原来的条目，但认不出它用的是哪个客户端，没有吊销：baocut mcp status 列出现有的客户端，不再用的 baocut services mcp revoke <clientId>",
  defaultProjectRegistered: (name, path) => `BaoCut 里还没有项目：登记了默认项目「${name}」（${path}），外部 Agent 新建视频时用它`,

  help: `用法：
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <客户端名>] [--yes]
                                   把一个外部 Agent 接到 BaoCut 的 MCP 服务：开启服务（并设为随 Runtime 启动），
                                   为它新建一个客户端与令牌，把地址与令牌写进宿主的 MCP 配置（条目名 baocut），之后重启宿主；
                                   BaoCut 里还没有任何项目时，登记默认项目目录下的 CLI 项目，外部 Agent 新建视频用它
    --level ask|auto               访问等级：ask 写入与任务逐次由你在 BaoCut 里确认（服务的默认），auto 直接执行；
                                   不给时不改现有等级
    --name <客户端名>              在 BaoCut 里显示的客户端名（默认是宿主名），可以单独吊销
    --yes                          宿主配置里已有 baocut 条目时替换它，并吊销旧条目用的客户端（从旧令牌认出；认不出时列出
                                   同名的客户端，由你决定吊销哪个）；不给时不覆盖，也不新建客户端
  令牌放在哪里：Claude Code 放进 ~/.claude/settings.json 的 env（BAOCUT_MCP_TOKEN），配置里只写引用；
  Codex（~/.codex/config.toml）、Cursor（~/.cursor/mcp.json）、Gemini CLI（~/.gemini/settings.json）没有放环境变量的地方，
  令牌明文写在配置文件里：别把这些文件提交或分享，等级建议用 ask；泄露了用 baocut services mcp revoke <clientId> 吊销。
  服务只在 BaoCut 的 Runtime 开着时可用（打开 BaoCut，或 baocut runtime ensure）。
  baocut mcp status                MCP 服务的状态、地址、等级与客户端，以及各宿主的配置里有没有 baocut 条目（不含令牌）`,
  entryExists: (file, entry) => `${file} 里已经有 ${entry} 条目，没有改动；要替换就加 --yes`,
  serviceNotAvailable: '这个版本的 BaoCut 不提供 MCP 服务',
  serviceStartFailed: (reason) => `MCP 服务没能开启：${reason ?? '未知原因'}`,
  connected: (host, url) => `已把 ${host} 接到 BaoCut 的 MCP 服务：${url}`,
  configEnv: (configFile, envFile, envVar) => `配置：${configFile}（令牌在 ${envFile} 的 env.${envVar}，配置里只是引用）`,
  configPlaintext: (configFile, clientId) =>
    `配置：${configFile}（令牌明文写在这个文件里：别提交或分享它；泄露了用 baocut services mcp revoke ${clientId} 吊销）`,
  clientLine: (name, clientId, level) => `客户端：${name}（${clientId}）  等级：${level ?? '—'}`,
  restartHint: (host) => `重启 ${host} 后生效。服务随 BaoCut 的 Runtime 开着：Runtime 没在跑时先打开 BaoCut 或 baocut runtime ensure`,
  replacedRevoked: (name, clientId) => `替换了原来的条目，已吊销它用的客户端：${name}（${clientId}）`,
  replacedRevokeFailed: (reason) => `替换了原来的条目，但没能吊销它用的客户端：${reason}`,
  oldClientRemains: (ids) => `原来的客户端还在：${ids.join('、')}；不再用就 baocut services mcp revoke <clientId>`,
  sameNameClientsRemain: (ids, unrecognized) =>
    `${unrecognized ? '认不出原来的条目用的是哪个客户端；' : ''}同名的客户端还在：${ids.join('、')}；不再用就 baocut services mcp revoke <clientId>`,
  hostsHeading: (entry) => `宿主的配置里有没有 ${entry} 条目：`,
  hostUnreadable: (problem) => `读不了（${problem}）`,
  hostConfigured: '有',
  hostNotConfigured: '没有',
  noServiceStatus: 'Runtime 没有报告 MCP 服务的状态',
  levelChoice: (value) => `--level 只能是 ask 或 auto：${value}`,
};
