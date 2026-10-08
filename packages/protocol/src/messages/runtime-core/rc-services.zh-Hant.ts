import type { RcServicesMessages } from './rc-services.ts';

export const zhHant: RcServicesMessages = {
  mcpServiceLabel: 'MCP 服務',
  nodeServiceLabel: '區域網路節點',
  serviceNotAvailable: (p: { serviceId: string }) => `這個版本尚未提供「${p.serviceId}」服務`,
  serviceNotFound: (p: { serviceId: string }) => `沒有「${p.serviceId}」服務`,
  runtimeStopping: 'Runtime 正在停止',
  clientNotFound: '沒有這個用戶端',
  portInUse: (p: { port: number }) => `連接埠 ${p.port} 已被佔用`,
  cannotListen: (p: { port: number; reason: string }) => `無法在連接埠 ${p.port} 上監聽：${p.reason}`,
  configFileInvalid: (p: { file: string }) => `服務設定檔的格式錯誤：${p.file}`,
  routingOnlyForModelApi: 'routing 與 maxConcurrentPerClient 只適用於模型 API 服務（model-api）',
  tokenPlaceholder: (p: { client: string }) => `<${p.client} 的權杖>`,
  tokenPlaceholderGeneric: '<權杖>',
  mcpNotRunning: 'MCP 服務目前未開啟：請先啟動（baocut services start mcp），否則用戶端無法連線。',
  nodeServiceConfigure: '請使用 nodes.share.*（baocut share …）設定節點服務',
  nodeServiceNotListening: '節點服務未在監聽',
};
