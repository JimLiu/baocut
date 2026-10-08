import { createServer, type IncomingMessage, type Server } from 'node:http';
import {
  MCP_INTERFACE_VERSION,
  RUNTIME_VERSION,
  RpcError,
  newId,
  nowIso,
  type Id,
  type McpConnectionInfo,
  type ServiceClient,
  type ServiceConfigureParams,
  type ServiceRequestRecord,
} from '@baocut/protocol';
import { RcServices } from '@baocut/protocol/messages/runtime-core';
import type { Harness, Logger } from '@baocut/harness';
import type { ModelJobs } from '../models/model-jobs.ts';
import type { VideoService } from '../videos/video-service.ts';
import { McpEndpoint } from '../agent-tools/mcp-endpoint.ts';
import { ToolCatalog, type ToolResult, type ToolSet } from '../agent-tools/tool-catalog.ts';
import type { ServicePrincipal, ToolPrincipal, ToolScope } from '../agent-tools/tool-scope.ts';
import type { ServiceApprovals } from './service-approvals.ts';
import type { ServiceConfigStore } from './service-config-store.ts';
import type { ManagedService, ServiceReport } from './service-manager.ts';
import { ServiceScope } from './service-scope.ts';
import { LOOPBACK_HOST as HOST, RecentRequests, ServiceClients, closeLoopback, listenLoopback } from './service-clients.ts';
import { describeServiceTool, serviceToolExposed } from './mcp-tools.ts';

/**
 * MCP 服务（架构设计 §4.8、§12.8）：给其他应用里的智能体用的无状态 MCP Streamable HTTP 端点，
 * 与工具桥共用 MCP 端点代码与工具实现，区别只在主体（服务主体与访问策略）。
 *
 * - 只监听回环地址，端口可配置（默认 `MCP_DEFAULT_PORT`），被占用时进入 `error`，不换端口；
 * - 认证：每个客户端一枚令牌（`Authorization: Bearer <令牌>`），只存哈希；缺失、错误或已吊销时 401；
 * - 带 `Origin` 的请求拒绝（网页不能调用），`Host` 不是回环地址的拒绝（DNS 重绑定）；
 * - 每个请求一个主体（新的 `connectionId`）：请求结束时放下它打开的视频，断开时取消等待中的审批；
 * - 每个工具调用记审计：调用方、工具、目标视频与结果，不记参数正文与媒体内容，不记令牌。
 */

export interface McpServiceDeps {
  store: ServiceConfigStore;
  harness: Harness;
  videos: VideoService;
  models: ModelJobs;
  approvals: ServiceApprovals;
  log: Logger;
  /** 客户端或最近的请求变了：送一条 `service.updated`。 */
  onChange: () => void;
  /**
   * 整份工具目录的工具组，按服务的范围构造（与会话的目录同一个工厂）。对外露出哪些由目录项的 `surfaces` 与访问等级决定
   * （`serviceToolExposed`），这里不挑。
   */
  toolSets: (scope: ToolScope) => ToolSet[];
}

export class McpService implements ManagedService {
  readonly id = 'mcp' as const;
  get label(): string {
    return RcServices.mcpServiceLabel().text;
  }
  readonly available = true;
  readonly #deps: McpServiceDeps;
  readonly #log: Logger;
  readonly #endpoint: McpEndpoint;
  readonly #controllers = new WeakMap<ToolPrincipal, AbortController>();
  readonly #clients: ServiceClients;
  readonly #recent = new RecentRequests();
  #server: Server | null = null;
  #port: number | null = null;

  constructor(deps: McpServiceDeps) {
    this.#deps = deps;
    this.#log = deps.log.child('mcp-service');
    this.#clients = new ServiceClients({ store: deps.store, serviceId: 'mcp', label: 'MCP', log: this.#log, onChange: deps.onChange });
    const scope = new ServiceScope({
      harness: deps.harness,
      videos: deps.videos,
      jobs: deps.models.jobs,
      approvals: deps.approvals,
      policy: () => deps.store.get('mcp').policy,
      allowVideo: (_serviceId, videoId) => this.#allowVideo(videoId),
    });
    const tools = new ToolCatalog(deps.toolSets(scope), deps.log, {
      surface: 'mcp',
      expose: (_name, info) => serviceToolExposed(info, deps.store.get('mcp').policy.level),
      describe: describeServiceTool,
    });
    this.#endpoint = new McpEndpoint({
      authenticate: (request) => this.#authenticate(request),
      tools,
      log: deps.log,
      loopbackHostOnly: true,
      serverInfo: {
        version: MCP_INTERFACE_VERSION,
        meta: { 'baocut.interfaceVersion': MCP_INTERFACE_VERSION, 'baocut.runtimeVersion': RUNTIME_VERSION },
      },
      onToolCall: (name, principal, result) => this.#audit(name, principal, result),
    });
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const port = this.#deps.store.get('mcp').port;
    const server = createServer((request, response) => {
      const principal = this.#endpoint.accept(request, response);
      if (principal === false) {
        response.writeHead(404).end();
        return;
      }
      if (principal === null) {
        this.#log.info('External request refused',{ status: response.statusCode });
        return;
      }
      // 请求结束（或连接断开）：取消等待中的审批，放下这个请求打开的视频（宽限期后关闭，没有别人用的话）。
      response.once('close', () => {
        this.#controllers.get(principal)?.abort();
        this.#deps.videos.connectionClosed(principal.connectionId);
      });
    });
    const actual = await listenLoopback(server, port);
    server.on('error', (error) => this.#log.warn('MCP service error',{ error: String(error) }));
    this.#server = server;
    this.#port = actual;
    this.#log.info('MCP service listening',{ port: this.#port });
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    // 立即断开已有连接（§12.8）；它提交的任务保留，由用户决定。
    if (server) await closeLoopback(server);
    await this.#deps.store.flush('mcp').catch(() => {});
  }

  status(): ServiceReport {
    const config = this.#deps.store.get('mcp');
    const port = this.#port ?? config.port;
    return {
      autostart: config.autostart,
      port,
      endpoint: this.#server ? `http://${HOST}:${port}/mcp` : null,
      policy: config.policy,
      clients: this.#clients.list(),
      recentRequests: this.#recent.list(),
    };
  }

  async applyConfig(params: ServiceConfigureParams): Promise<boolean> {
    if (params.routing !== undefined || params.maxConcurrentPerClient !== undefined) {
      throw new RpcError('invalid-request', RcServices.routingOnlyForModelApi());
    }
    const before = this.#deps.store.get('mcp');
    const policy = {
      level: params.level ?? before.policy.level,
      videos:
        params.videos === undefined
          ? before.policy.videos
          : params.videos === 'all'
            ? ('all' as const)
            : { ids: [...new Set(params.videos.ids)] },
    };
    await this.#deps.store.update('mcp', {
      ...(params.autostart !== undefined ? { autostart: params.autostart } : {}),
      ...(params.port !== undefined ? { port: params.port } : {}),
      policy,
    });
    return params.port !== undefined && params.port !== before.port;
  }

  // ---- 客户端 ----

  createClient(name: string): Promise<{ client: ServiceClient; token: string }> {
    return this.#clients.create(name);
  }

  listClients(): ServiceClient[] {
    return this.#clients.list();
  }

  revokeClient(clientId: string): Promise<ServiceClient[]> {
    return this.#clients.revoke(clientId);
  }

  /** 可以直接粘进别的应用的配置：地址与请求头形状，令牌用占位符（明文只在创建客户端时给出一次）。 */
  connectionInfo(clientId?: string): McpConnectionInfo {
    const client = this.#clients.find(clientId);
    const { port, endpoint } = this.status();
    const url = endpoint ?? `http://${HOST}:${port}/mcp`;
    const placeholder = (client ? RcServices.tokenPlaceholder({ client: client.name }) : RcServices.tokenPlaceholderGeneric()).text;
    const headers = { Authorization: `Bearer ${placeholder}` };
    return {
      url,
      headers,
      snippet: JSON.stringify({ mcpServers: { baocut: { type: 'http', url, headers } } }, null, 2),
      interfaceVersion: MCP_INTERFACE_VERSION,
      notice: this.#server ? null : RcServices.mcpNotRunning().text,
    };
  }

  /** 服务新建的视频（`videos_create`）加进它的视频名单：访问策略是名单时，之后才看得见它；是全部视频时不用改。 */
  async #allowVideo(videoId: Id): Promise<void> {
    if (await this.#deps.store.allowVideo('mcp', videoId)) this.#deps.onChange();
  }

  // ---- 请求 ----

  #authenticate(request: IncomingMessage): ServicePrincipal | null {
    const client = this.#clients.authenticate(request);
    if (!client) return null;
    const controller = new AbortController();
    const principal: ServicePrincipal = {
      connectionId: newId('svc'),
      kind: 'service',
      name: 'mcp',
      serviceId: 'mcp',
      clientId: client.clientId,
      clientName: client.name,
      signal: controller.signal,
      audit: { videoId: null },
    };
    this.#controllers.set(principal, controller);
    return principal;
  }

  #audit(tool: string, principal: ToolPrincipal, result: ToolResult): void {
    if (principal.kind !== 'service') return;
    const outcome = result.isError ? errorCodeOf(result) : 'ok';
    const record: ServiceRequestRecord = {
      at: nowIso(),
      clientId: principal.clientId,
      clientName: principal.clientName,
      tool,
      videoId: principal.audit.videoId,
      outcome,
    };
    this.#recent.add(record);
    this.#log.info('External request',{ serviceId: 'mcp', clientId: principal.clientId, tool, videoId: record.videoId, outcome });
    this.#deps.onChange();
  }
}

function errorCodeOf(result: ToolResult): string {
  try {
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { error?: { code?: unknown } };
    return typeof parsed.error?.code === 'string' ? parsed.error.code : 'ERROR';
  } catch {
    return 'ERROR';
  }
}
