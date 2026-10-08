import path from 'node:path';
import { SERVICE_APPROVAL_TIMEOUT_MS } from '@baocut/protocol';
import type { Harness, Logger } from '@baocut/harness';
import type { NodeService } from '@baocut/nodes';
import type { RuntimeHome } from '@baocut/runtime-storage';
import type { ToolScope } from '../agent-tools/tool-scope.ts';
import type { ToolSet } from '../agent-tools/tool-catalog.ts';
import type { ModelJobs } from '../models/model-jobs.ts';
import type { VideoService } from '../videos/video-service.ts';
import { McpService } from './mcp-service.ts';
import { ModelApiService } from './model-api-service.ts';
import { NodeServiceAdapter } from './node-service-adapter.ts';
import { ServiceApprovals } from './service-approvals.ts';
import { ServiceConfigStore } from './service-config-store.ts';
import { ServiceManager } from './service-manager.ts';
import { WebService } from './web-service.ts';
import type { WebSessionsOptions } from './web-sessions.ts';

export interface RuntimeServices {
  manager: ServiceManager;
  mcp: McpService;
  modelApi: ModelApiService;
  web: WebService;
}

export interface ServicesOptions {
  /** 服务审批的时限（默认 `SERVICE_APPROVAL_TIMEOUT_MS`）。测试用短的。 */
  approvalTimeoutMs?: number;
  /** 模型接口服务的上传与请求体上限（默认见 `MODEL_API_MAX_UPLOAD_BYTES`、`MODEL_API_MAX_JSON_BYTES`）。测试用小的。 */
  modelApi?: { maxUploadBytes?: number; maxJsonBytes?: number };
  /** Web 服务：构建产物目录（null 表示没有；不给时按 `BAOCUT_WEB_DIST`、打包资源、仓库里的构建输出找），以及代码与会话的期限。 */
  web?: { dist?: string | null } & WebSessionsOptions;
}

/**
 * 读入对外服务的配置并登记全部服务（架构设计 §4.8）。不开启任何服务：随 Runtime 启动的由 `manager.restore` 开启。
 * 配置文件不是合法的配置时抛出（不覆盖它，免得丢掉已发放的客户端）。
 */
export async function openServices(deps: {
  home: RuntimeHome;
  harness: Harness;
  videos: VideoService;
  models: ModelJobs;
  nodes: NodeService;
  log: Logger;
  /** 整份工具目录的工具组（按服务的范围构造）：MCP 服务按 `surfaces` 露出其中的一部分。 */
  toolSets: (scope: ToolScope) => ToolSet[];
  options?: ServicesOptions;
}): Promise<RuntimeServices> {
  const store = new ServiceConfigStore(deps.home.servicesFile);
  await store.load();
  const manager = new ServiceManager({
    log: deps.log,
    approvals: (m) =>
      new ServiceApprovals({
        timeoutMs: deps.options?.approvalTimeoutMs ?? SERVICE_APPROVAL_TIMEOUT_MS,
        onRequested: (approval) => m.topic.publish({ type: 'approval.requested', approval }),
        onResolved: (approvalId, outcome) => m.topic.publish({ type: 'approval.resolved', approvalId, outcome }),
        // 与会话审批共用 Harness 的 ApprovalService：待处理的服务审批也列在 `tasks` 主题里（§3.12）。
        approvals: deps.harness.approvals,
      }),
  });
  const mcp = new McpService({
    store,
    harness: deps.harness,
    videos: deps.videos,
    models: deps.models,
    approvals: manager.approvals,
    log: deps.log,
    onChange: () => manager.refresh('mcp'),
    toolSets: deps.toolSets,
  });
  manager.register(mcp);
  const modelApi = new ModelApiService({
    store,
    models: deps.models,
    approvals: manager.approvals,
    stagingDir: path.join(deps.home.stagingDir, 'model-api'),
    log: deps.log,
    onChange: () => manager.refresh('model-api'),
    ...(deps.options?.modelApi ? { limits: deps.options.modelApi } : {}),
  });
  manager.register(modelApi);
  const { dist, ...sessions } = deps.options?.web ?? {};
  const web = new WebService({
    store,
    harness: deps.harness,
    videos: deps.videos,
    log: deps.log,
    onChange: () => manager.refresh('web'),
    ...(dist !== undefined ? { dist } : {}),
    sessions,
  });
  manager.register(web);
  manager.register(new NodeServiceAdapter(deps.nodes));
  return { manager, mcp, modelApi, web };
}
