import type { RcServicesMessages } from './rc-services.ts';

export const zhHans: RcServicesMessages = {
  mcpServiceLabel: 'MCP 服务',
  nodeServiceLabel: '局域网节点',
  serviceNotAvailable: (p: { serviceId: string }) => `这个版本还没有提供「${p.serviceId}」服务`,
  serviceNotFound: (p: { serviceId: string }) => `没有「${p.serviceId}」服务`,
  runtimeStopping: 'Runtime 正在停止',
  clientNotFound: '没有这个客户端',
  portInUse: (p: { port: number }) => `端口 ${p.port} 已被占用`,
  cannotListen: (p: { port: number; reason: string }) => `不能在端口 ${p.port} 上监听：${p.reason}`,
  configFileInvalid: (p: { file: string }) => `对外服务的配置文件格式不对：${p.file}`,
  routingOnlyForModelApi: 'routing 与 maxConcurrentPerClient 只适用于模型接口服务（model-api）',
  tokenPlaceholder: (p: { client: string }) => `<${p.client} 的令牌>`,
  tokenPlaceholderGeneric: '<令牌>',
  mcpNotRunning: 'MCP 服务现在没有开着：先开启（baocut services start mcp），否则连不上。',
  nodeServiceConfigure: '节点服务的配置用 nodes.share.*（baocut share …）',
  nodeServiceNotListening: '节点服务没有在监听',
};
