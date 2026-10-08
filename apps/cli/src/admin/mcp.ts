import fs from 'node:fs';
import path from 'node:path';
import type { Project, ServiceClient, ServiceLevel, ServiceStatus } from '@baocut/protocol';
import { CliError } from '../envelope.ts';
import {
  AGENT_HOSTS,
  HOST_LABELS,
  MCP_ENTRY_NAME,
  clientIdOfToken,
  hasMcpEntry,
  mcpHostConfig,
  parseAgentHost,
  readMcpEntryToken,
  writeMcpEntry,
  type AgentHost,
  type McpHostConfig,
} from './agent-hosts.ts';
import { defineNoun, type AdminRun } from './context.ts';
import { M } from './mcp-copy.ts';
import { formatClients, formatService } from './services-output.ts';

/**
 * 管理桶 `baocut mcp install|status`（Agent 面设计 §6.2；架构设计 §4.8）：一条命令把外部 Agent 接到 BaoCut 的 MCP 服务——开服务、
 * 为这个宿主建客户端拿令牌、写进宿主的 MCP 配置。令牌能放进宿主的环境变量段时放那里、配置里引用它（Claude Code）；宿主没有这样的
 * 地方时明文写进它的配置文件（Codex、Cursor、Gemini CLI），结果与帮助里都说明。`status` 不打印令牌。
 */
export const mcp = defineNoun({
  name: 'mcp',
  verbs: ['install', 'status'],
  get usage() {
    return M.help;
  },
  options: {
    agent: { type: 'string' },
    level: { type: 'string' },
    name: { type: 'string' },
    yes: { type: 'boolean' },
  },
  async run(ctx) {
    const [sub, ...extra] = ctx.args;
    if (extra.length > 0) throw ctx.usageError();
    if (sub === 'status') {
      if (ctx.values.agent || ctx.values.level || ctx.values.name || ctx.values.yes) throw ctx.usageError();
      return status(ctx);
    }
    if (sub !== 'install') throw ctx.usageError();
    return install(ctx);
  },
});

type McpRun = AdminRun<{ agent?: string; level?: string; name?: string; yes?: boolean }>;

async function install(ctx: McpRun) {
  const host = ctx.parse(() => parseAgentHost(ctx.values.agent));
  const level = ctx.parse(() => parseLevel(ctx.values.level));
  const clientName = ctx.values.name?.trim() || HOST_LABELS[host];
  const config = mcpHostConfig(host, ctx.env);
  // 先看宿主的配置：要拒绝就在发令牌之前拒绝，不留下没人用的客户端。
  const existed = hasMcpEntry(host, ctx.env);
  if (existed && !ctx.values.yes) {
    throw new CliError('CONFIRMATION_REQUIRED', M.entryExists(config.file, MCP_ENTRY_NAME), {
      file: config.file,
    });
  }
  // 替换前认出旧条目用的客户端（令牌是 `<clientId>.<密钥>`）：新条目写好之后吊销它，不留下没人用的令牌。
  const oldToken = existed ? readMcpEntryToken(host, ctx.env) : null;
  const oldClientId = oldToken ? clientIdOfToken(oldToken) : null;

  let service = await mcpService(ctx);
  if (!service.available) return ctx.fail({ code: 'SERVICE_NOT_AVAILABLE', message: M.serviceNotAvailable });
  if (level || !service.autostart) {
    service = (await ctx.client.request('services.configure', { serviceId: 'mcp', autostart: true, ...(level ? { level } : {}) })).service;
  }
  if (service.state !== 'on') service = (await ctx.client.request('services.start', { serviceId: 'mcp' })).service;
  if (service.state === 'error') {
    return ctx.fail({ code: 'SERVICE_START_FAILED', message: M.serviceStartFailed(service.error ?? null), next: 'baocut services' });
  }

  const defaultProject = await ensureSomeProject(ctx);

  const created = await ctx.client.request('services.mcp.createClient', { name: clientName });
  let written: McpHostConfig;
  let url: string;
  try {
    url = (await ctx.client.request('services.mcp.connectionInfo', { clientId: created.client.clientId })).url;
    written = writeMcpEntry(host, ctx.env, { name: MCP_ENTRY_NAME, url, token: created.token });
  } catch (error) {
    // 没写进去的令牌没人能用：吊销刚建的客户端。
    await ctx.client.request('services.mcp.revokeClient', { clientId: created.client.clientId }).catch(() => undefined);
    throw error;
  }

  // 旧条目的客户端：认出来且还在就吊销；认不出（手写的条目、令牌不是 BaoCut 发的形状）时列出同名的客户端，由用户处理。
  const clients = service.clients ?? [];
  const oldClient = oldClientId ? (clients.find((client) => client.clientId === oldClientId) ?? null) : null;
  let revokedClient: ServiceClient | null = null;
  let revokeFailed: string | null = null;
  if (oldClient && oldClient.clientId !== created.client.clientId) {
    try {
      await ctx.client.request('services.mcp.revokeClient', { clientId: oldClient.clientId });
      revokedClient = oldClient;
    } catch (error) {
      revokeFailed = error instanceof Error ? error.message : String(error);
    }
  }
  const others = revokeFailed
    ? [oldClient!]
    : oldClientId
      ? []
      : clients.filter((client) => client.name === clientName && client.clientId !== created.client.clientId);
  const result = {
    agent: host,
    entry: MCP_ENTRY_NAME,
    configFile: written.file,
    tokenStorage: written.tokenStorage,
    ...(written.envFile ? { envFile: written.envFile, envVar: written.envVar } : {}),
    replaced: existed,
    revokedClient,
    // 认不出旧条目用的是哪个客户端（手写的条目、令牌不是 BaoCut 发的形状）：没有吊销任何客户端。
    ...(existed && !oldClientId ? { previousClientUnknown: true } : {}),
    ...(others.length ? { staleClients: others } : {}),
    client: created.client,
    url,
    level: service.policy?.level ?? null,
    defaultProject: defaultProject ? { projectId: defaultProject.id, name: defaultProject.name, path: defaultProject.path } : null,
  };
  return ctx.done(result, formatInstall(host, result, { others, revokeFailed }), 'baocut mcp status');
}

function formatInstall(
  host: AgentHost,
  result: {
    configFile: string;
    tokenStorage: string;
    envFile?: string;
    envVar?: string;
    client: ServiceClient;
    url: string;
    level: string | null;
    replaced: boolean;
    revokedClient: ServiceClient | null;
    previousClientUnknown?: boolean;
    defaultProject: { projectId: string; name: string; path: string } | null;
  },
  { others, revokeFailed }: { others: ServiceClient[]; revokeFailed: string | null },
): string[] {
  const lines = [
    M.connected(HOST_LABELS[host], result.url),
    result.tokenStorage === 'env'
      ? M.configEnv(result.configFile, result.envFile ?? '', result.envVar ?? '')
      : M.configPlaintext(result.configFile, result.client.clientId),
    M.clientLine(result.client.name, result.client.clientId, result.level),
    M.restartHint(HOST_LABELS[host]),
  ];
  if (result.defaultProject) {
    lines.push(
      M.defaultProjectRegistered(result.defaultProject.name, result.defaultProject.path),
    );
  }
  if (result.revokedClient) {
    lines.push(M.replacedRevoked(result.revokedClient.name, result.revokedClient.clientId));
  } else if (revokeFailed) {
    lines.push(M.replacedRevokeFailed(revokeFailed));
  }
  if (others.length > 0) {
    const ids = others.map((client) => client.clientId);
    lines.push(revokeFailed ? M.oldClientRemains(ids) : M.sameNameClientsRemain(ids, result.replaced));
  } else if (result.previousClientUnknown) {
    lines.push(M.previousClientUnknown);
  }
  return lines;
}

async function status(ctx: McpRun) {
  const service = await mcpService(ctx);
  const hosts = AGENT_HOSTS.map((agent) => {
    const { file } = mcpHostConfig(agent, ctx.env);
    try {
      return { agent, configFile: file, configured: hasMcpEntry(agent, ctx.env) };
    } catch (error) {
      return { agent, configFile: file, configured: null, problem: error instanceof Error ? error.message : String(error) };
    }
  });
  const lines = [...formatService(service)];
  if (service.available) lines.push(...formatClients(service.clients).map((line) => `  ${line}`));
  lines.push('', M.hostsHeading(MCP_ENTRY_NAME));
  const width = Math.max(...AGENT_HOSTS.map((agent) => HOST_LABELS[agent].length));
  for (const host of hosts) {
    const state = host.configured === null ? M.hostUnreadable(host.problem ?? '') : host.configured ? M.hostConfigured : M.hostNotConfigured;
    lines.push(`  ${HOST_LABELS[host.agent].padEnd(width)}  ${state}  ${host.configFile}`);
  }
  return ctx.done({ service, hosts }, lines);
}

/** 当前目录不在项目里时 CLI 新建视频用的默认项目（与 `@baocut/runtime-core` 的 `LOCAL_DEFAULT_PROJECT_DIR` 相同）。 */
const DEFAULT_PROJECT_DIR = 'CLI';

/**
 * 对外服务新建视频必须给已登记的项目，又不能自己建项目（Agent 面设计 §6.2）：BaoCut 里一个项目都没有时（新装、没开过 App），
 * 登记默认项目目录下的 `CLI` 项目——与终端没有项目时用的是同一个——外部 Agent 的 `projects_list` 才有项目可用。已有项目时不动。
 */
async function ensureSomeProject(ctx: McpRun): Promise<Project | null> {
  const { projects } = await ctx.client.request('projects.list', {});
  if (projects.length > 0) return null;
  const { projectsDir } = await ctx.client.request('runtime.info', {});
  const dir = path.join(projectsDir, DEFAULT_PROJECT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return (await ctx.client.request('projects.open', { path: dir })).project;
}

async function mcpService(ctx: McpRun): Promise<ServiceStatus> {
  const { services } = await ctx.client.request('services.list', {});
  const service = services.find((candidate) => candidate.serviceId === 'mcp');
  if (!service) throw new Error(M.noServiceStatus);
  return service;
}

function parseLevel(value: string | undefined): Extract<ServiceLevel, 'ask' | 'auto'> | undefined {
  if (value === undefined) return undefined;
  if (value !== 'ask' && value !== 'auto') throw new Error(M.levelChoice(value));
  return value;
}
