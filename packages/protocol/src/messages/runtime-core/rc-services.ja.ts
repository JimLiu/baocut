import type { RcServicesMessages } from './rc-services.ts';

export const ja: RcServicesMessages = {
  mcpServiceLabel: 'MCP サービス',
  nodeServiceLabel: 'LAN ノード',
  serviceNotAvailable: (p: { serviceId: string }) => `このバージョンではまだ「${p.serviceId}」サービスを提供していません`,
  serviceNotFound: (p: { serviceId: string }) => `「${p.serviceId}」サービスはありません`,
  runtimeStopping: 'Runtime は停止中です',
  clientNotFound: 'このクライアントはありません',
  portInUse: (p: { port: number }) => `ポート ${p.port} はすでに使用中です`,
  cannotListen: (p: { port: number; reason: string }) => `ポート ${p.port} で待ち受けできません：${p.reason}`,
  configFileInvalid: (p: { file: string }) => `サービスの設定ファイルの形式が正しくありません：${p.file}`,
  routingOnlyForModelApi: 'routing と maxConcurrentPerClient はモデル API サービス（model-api）にのみ適用されます',
  tokenPlaceholder: (p: { client: string }) => `<${p.client} のトークン>`,
  tokenPlaceholderGeneric: '<トークン>',
  mcpNotRunning:
    'MCP サービスはオフです。先に開始してください（baocut services start mcp）。開始しないとクライアントは接続できません。',
  nodeServiceConfigure: 'ノードサービスは nodes.share.*（baocut share …）で設定してください',
  nodeServiceNotListening: 'ノードサービスは待ち受けしていません',
};
