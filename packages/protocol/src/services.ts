import type { Id } from './domain.ts';
import type { MessageRef } from './message-ref.ts';
import type { OnlineCapability } from './models.ts';
import type { WebServiceAccess } from './web.ts';

/**
 * 对外服务（架构设计 §4.8、§12.8）：Runtime 向其他程序与设备开放的入口，由 ServiceManager 统一管理。
 *
 * - 每个服务有同一组状态，默认 `off`，由用户显式开启；配置持久化在 `store/services.json`，启动时恢复。
 * - 状态与待处理的服务审批经 `services` 主题送达（命令与协议规范 §10.4）。
 * - 节点服务（`node`）的状态是 `nodes.share.*` 的投影：开关、端口与配对仍用那组专用方法。
 */

export const SERVICE_IDS = ['mcp', 'model-api', 'web', 'node'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export type ServiceState = 'off' | 'starting' | 'on' | 'stopping' | 'error';

/** 操作等级：`read` 只有查询；`ask` 写入、任务与生成逐次由用户确认；`auto` 直接执行。等级不够的工具不出现在目录里。 */
export const SERVICE_LEVELS = ['read', 'ask', 'auto'] as const;
export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

/** 访问策略（§4.8）：范围（全部视频或一份 videoId 名单）与操作等级。 */
export interface ServicePolicy {
  videos: 'all' | { ids: Id[] };
  level: ServiceLevel;
}

/** 新服务的默认策略：全部视频、逐次确认。 */
export const DEFAULT_SERVICE_POLICY: ServicePolicy = { videos: 'all', level: 'ask' };

/** MCP 服务的默认端口（回环）。端口被占用时服务进入 `error`，不换端口。 */
export const MCP_DEFAULT_PORT = 47620;
/**
 * MCP 服务的接口版本：工具名与参数是对外合同，破坏性变更升这个版本（`serverInfo.version` 与 `baocut.interfaceVersion`）。
 * `2`：开放清单改为按工具目录的 `surfaces` 推出，`exports_create` → `export`、`link_import_start` → `download`、
 * `models_synthesize_speech` → `speak`、`models_generate_image` → `image`、`skill_read` → `skills_read`，`videos_create` 加 `project`。
 */
export const MCP_INTERFACE_VERSION = '2';

/**
 * 工具目录项的效果（架构设计 §3.5）：`query` 只读；`mutation` 改状态（进撤销栈或写文件）；`job` 立即返回 `jobId`，
 * 结果要等；`destructive` 不可撤销或移出编辑器（要用户明确同意）。
 */
export const TOOL_EFFECTS = ['query', 'mutation', 'job', 'destructive'] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

/** 工具目录项出现在哪些面：`agent`（会话里的智能体的工具桥）、`mcp`（对外的 MCP 服务）、`cli`（baocut CLI）。 */
export const TOOL_SURFACES = ['agent', 'mcp', 'cli'] as const;
export type ToolSurface = (typeof TOOL_SURFACES)[number];

/** MCP 服务开放的一个工具：名字、标题与效果（`query` 的在任何等级下都开放，其余只在 `ask` 与 `auto` 下）。 */
export interface McpServiceTool {
  name: string;
  title: string;
  effect: ToolEffect;
}

/**
 * MCP 服务开放的工具（§4.8）：由 Runtime 的工具目录按 `surfaces` 含 `mcp` 推出，这里是同一份清单的协议常量，
 * 给界面列出工具用；runtime-core 的测试断言两者一致。改名或改参数要升 `MCP_INTERFACE_VERSION`。
 */
// i18n-ignore-start: 与 Runtime 工具目录里给模型的工具标题逐字一致（测试断言）；界面按 services-mcp-copy 显示
export const MCP_SERVICE_TOOL_NAMES: readonly McpServiceTool[] = [
  { name: 'videos_list', title: '列出视频', effect: 'query' },
  { name: 'videos_create', title: '新建视频', effect: 'mutation' },
  { name: 'videos_inspect', title: '读取视频', effect: 'query' },
  { name: 'documents_read', title: '读取文档', effect: 'query' },
  { name: 'edits_apply', title: '修改视频', effect: 'mutation' },
  { name: 'edits_undo', title: '撤销修改', effect: 'mutation' },
  { name: 'captions_create', title: '建立字幕层', effect: 'mutation' },
  { name: 'videos_frames', title: '取视频帧', effect: 'mutation' },
  { name: 'videos_history', title: '查看修改历史', effect: 'query' },
  { name: 'documents_put', title: '写入文档', effect: 'mutation' },
  { name: 'assets_import', title: '导入素材', effect: 'mutation' },
  { name: 'compositions_import', title: '导入代码画面', effect: 'mutation' },
  { name: 'compositions_preview', title: '预览代码画面', effect: 'mutation' },
  { name: 'assets_prune', title: '清理没用的素材', effect: 'mutation' },
  { name: 'chapters_adopt', title: '采用来源章节', effect: 'mutation' },
  { name: 'edits_ops', title: '查看修改操作', effect: 'query' },
  { name: 'models_capabilities', title: '查看模型能力', effect: 'query' },
  { name: 'models_list', title: '列出本地模型包', effect: 'query' },
  { name: 'transcribe', title: '转录', effect: 'job' },
  { name: 'translate', title: '翻译', effect: 'job' },
  { name: 'dub', title: '翻译配音', effect: 'job' },
  { name: 'speak', title: '合成语音', effect: 'job' },
  { name: 'image', title: '生成图片', effect: 'job' },
  { name: 'jobs_inspect', title: '查看任务', effect: 'query' },
  { name: 'jobs_wait', title: '等待任务', effect: 'query' },
  { name: 'jobs_list', title: '列出任务', effect: 'query' },
  { name: 'jobs_cancel', title: '取消任务', effect: 'mutation' },
  { name: 'jobs_retry', title: '重跑失败的流程', effect: 'job' },
  { name: 'export', title: '导出', effect: 'job' },
  { name: 'space_list', title: '列出 Space 里的条目', effect: 'query' },
  { name: 'space_search', title: '跨视频检索文稿', effect: 'query' },
  { name: 'projects_list', title: '列出项目', effect: 'query' },
  { name: 'skills_list', title: '列出 skill', effect: 'query' },
  { name: 'skills_read', title: '读取 skill', effect: 'query' },
  { name: 'library_list', title: '列出用户库', effect: 'query' },
  { name: 'library_show', title: '查看用户库条目', effect: 'query' },
  { name: 'download', title: '从链接下载', effect: 'job' },
];
// i18n-ignore-end
/** 模型接口服务的默认端口（回环），与 MCP 服务相邻。 */
export const MODEL_API_DEFAULT_PORT = 47621;
/**
 * 模型接口服务的接口版本：路径、请求与响应的字段是对外合同，破坏性变更升这个版本（每个响应的
 * `X-BaoCut-Interface-Version` 头与 `GET /v1/baocut/info`）。
 */
export const MODEL_API_INTERFACE_VERSION = '1';
/** 模型接口服务每个客户端同时在途的生成请求的默认上限：超出时 429。 */
export const MODEL_API_DEFAULT_MAX_CONCURRENT = 4;
export const MODEL_API_MAX_CONCURRENT_LIMIT = 64;
/** 模型接口服务接受的上传（转写的 multipart 请求体）上限：超过时 413。 */
export const MODEL_API_MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
/** 模型接口服务接受的 JSON 请求体上限：超过时 413。 */
export const MODEL_API_MAX_JSON_BYTES = 8 * 1024 * 1024;

/**
 * 模型接口服务的路由开关（架构设计 §4.8）：默认只路由到本机（`local`）；把外部请求转给在线 Provider、
 * 局域网节点或智能体 Provider 要分别显式开启。没开启的那一类模型不出现在 `/v1/models`，按名访问是 404。
 */
export interface ModelApiRouting {
  online: boolean;
  nodes: boolean;
  agent: boolean;
}

/**
 * 别名表的一条：外部程序用的模型名 → 一种能力下的 Provider 与模型。`modelId` 为 null 时用这个 Provider 的默认模型
 * （用户默认值指向它时取用户默认值）。别名全局唯一，不含 `/`（`<providerId>/<modelId>` 是规范写法）。
 */
export interface ModelApiAlias {
  alias: string;
  capability: OnlineCapability;
  providerId: string;
  modelId: string | null;
}

/** 模型接口服务自己的配置与限制（`ServiceStatus.modelApi`）。 */
export interface ModelApiStatus {
  routing: ModelApiRouting;
  aliases: ModelApiAlias[];
  /** 每个客户端同时在途的生成请求上限。 */
  maxConcurrentPerClient: number;
  maxUploadBytes: number;
  maxJsonBytes: number;
  interfaceVersion: string;
}

/** 服务审批的时限：超时按拒绝处理。比常见 MCP 客户端的请求超时（60 秒）短，调用方能收到明确的拒绝。 */
export const SERVICE_APPROVAL_TIMEOUT_MS = 50_000;

/** 一个已发放的客户端：只有元数据，令牌明文只在创建时返回一次，Runtime 只存哈希。 */
export interface ServiceClient {
  clientId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** 一次外部请求的审计记录（§12.8）：调用方、工具、目标与结果，不含参数正文与媒体内容。 */
export interface ServiceRequestRecord {
  at: string;
  clientId: string;
  clientName: string;
  tool: string;
  /** 目标视频（videoId），没有时为 null。 */
  videoId: Id | null;
  /** `ok`，或拒绝、失败时的错误码。 */
  outcome: string;
}

export interface ServiceStatus {
  serviceId: ServiceId;
  label: string;
  /** 这个版本是否提供该服务。为 false 时状态总是 `off`，`services.start` 以 `SERVICE_NOT_AVAILABLE` 拒绝。 */
  available: boolean;
  state: ServiceState;
  /** `error` 时的原因（例如端口被占用）。 */
  error: string | null;
  errorRef?: MessageRef;
  /** 随 Runtime 启动。节点服务为共享是否开着。 */
  autostart: boolean;
  /** 配置的端口；开着时是实际监听的端口。 */
  port: number | null;
  /** 开着时的地址（MCP 服务是 `http://127.0.0.1:<port>/mcp`），否则为 null。 */
  endpoint: string | null;
  /** 访问策略；节点服务没有（为 null）。 */
  policy: ServicePolicy | null;
  /** 已发放的客户端；节点服务的已配对客户端在 `nodes.share.status` 里。 */
  clients: ServiceClient[];
  /** 最近的外部请求，新的在前，至多 20 条。 */
  recentRequests: ServiceRequestRecord[];
  /** 模型接口服务的路由、别名与限制；其他服务没有。 */
  modelApi?: ModelApiStatus;
  /** 只有 Web 服务有：只读与方法白名单（它没有访问策略，`policy` 为 null；浏览器会话列在 `clients` 里）。 */
  web?: WebServiceAccess;
}

/** 一条待处理的服务审批（`ask` 等级下的写入、任务与生成）。 */
export interface ServiceApproval {
  approvalId: Id;
  serviceId: ServiceId;
  clientId: string;
  clientName: string;
  tool: string;
  /** 目标视频，没有时为 null。 */
  video: { videoId: Id; name: string } | null;
  /** 参数摘要：给人看的一行，不含长文本与媒体内容。 */
  summary: string;
  createdAt: string;
  expiresAt: string;
}

export type ServiceApprovalDecision = 'allow' | 'deny';
/** `timeout`：到时限无人处理，按拒绝；`cancelled`：服务停止或调用方断开。 */
export type ServiceApprovalOutcome = 'allowed' | 'denied' | 'timeout' | 'cancelled';

export interface ServicesSnapshot {
  services: ServiceStatus[];
  /** 待处理的服务审批，旧的在前。 */
  approvals: ServiceApproval[];
}

export type ServicesEvent =
  | { type: 'service.updated'; service: ServiceStatus }
  | { type: 'approval.requested'; approval: ServiceApproval }
  | { type: 'approval.resolved'; approvalId: Id; outcome: ServiceApprovalOutcome };

/** `services.configure` 的可改项；不给的保持原样。 */
export interface ServiceConfigureParams {
  serviceId: ServiceId;
  autostart?: boolean;
  /** 0 表示由系统挑一个空闲端口（测试与诊断用）。 */
  port?: number;
  level?: ServiceLevel;
  videos?: 'all' | { ids: Id[] };
  /** 只用于模型接口服务：给出的开关替换，不给的不变。其他服务以 `invalid-request` 拒绝。 */
  routing?: Partial<ModelApiRouting>;
  /** 只用于模型接口服务：每个客户端同时在途的生成请求上限。 */
  maxConcurrentPerClient?: number;
  /** 只有 Web 服务接受：只读。 */
  readOnly?: boolean;
  /** 只有 Web 服务接受：方法白名单（方法名或 `<命名空间>.*`），只能在默认集合之内收紧；null 恢复默认集合。 */
  methods?: string[] | null;
}

/** `services.mcp.connectionInfo` 的结果：可以直接粘进别的应用的 MCP 配置，不含令牌明文。 */
export interface McpConnectionInfo {
  url: string;
  /** 请求头的形状；`<token>` 换成创建客户端时拿到的令牌。 */
  headers: { Authorization: string };
  /** 常见 MCP 客户端的配置片段（JSON 文本）。 */
  snippet: string;
  interfaceVersion: string;
  /** 服务没有开着时的提示，开着时为 null。 */
  notice: string | null;
}

/**
 * `services.modelApi.connectionInfo` 的结果：OpenAI 形状的客户端怎么连（基址与请求头），不含令牌明文。
 */
export interface ModelApiConnectionInfo {
  /** `http://127.0.0.1:<port>/v1`：OpenAI SDK 的 `baseURL`。 */
  baseUrl: string;
  headers: { Authorization: string };
  /** 常见写法的片段（环境变量）：令牌用占位符。 */
  snippet: string;
  interfaceVersion: string;
  /** 服务没有开着时的提示，开着时为 null。 */
  notice: string | null;
}
