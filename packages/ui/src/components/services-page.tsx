import { McpServicePage } from './services/mcp-service.tsx';
import { ModelApiServicePage } from './services/model-api-service.tsx';
import { RemotePage } from './services/remote-page.tsx';
import { ServicesOverview } from './services/services-overview.tsx';
import { useSharePolling } from './services/use-share-status.ts';
import { WebServicePage } from './services/web-service.tsx';

/**
 * 服务（产品设计 §2.1；架构设计 §4.8；原型 designs/baocut/app/page-services.jsx `ServicesPage`）：这台 Mac 上由 BaoCut 提供、
 * 等别的应用或设备连进来的四项服务——MCP 服务、远端算力、Web 服务、模型接口。不带 `service` 是总览，带了进那一项的详情。
 * 认不得的 `service`（包括旧的 `runtime` 与智能体引擎）落回总览；Runtime 卡搬到 `services/runtime-card.tsx`，给设置 › 诊断挂。
 * MCP、Web、模型接口的状态来自 `services` 主题（rail 常驻订阅）；远端算力另在页面开着、窗口在前台时轮询共享状态
 * （节点协议没有订阅主题，见 use-share-status.ts）。
 */
export function ServicesPage({ service }: { service?: string }) {
  useSharePolling();
  if (service === 'remote') return <RemotePage />;
  if (service === 'mcp') return <McpServicePage />;
  if (service === 'web') return <WebServicePage />;
  if (service === 'model-api') return <ModelApiServicePage />;
  return <ServicesOverview />;
}
