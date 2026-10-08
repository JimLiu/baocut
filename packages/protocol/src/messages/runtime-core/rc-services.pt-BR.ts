import type { RcServicesMessages } from './rc-services.ts';

export const ptBR: RcServicesMessages = {
  mcpServiceLabel: "Serviço MCP",
  nodeServiceLabel: "Nó da LAN",
  serviceNotAvailable: (p: { serviceId: string }) => `Esta versão ainda não oferece o serviço “${p.serviceId}”`,
  serviceNotFound: (p: { serviceId: string }) => `Não há serviço “${p.serviceId}”`,
  runtimeStopping: "O Runtime está parando",
  clientNotFound: "Não existe este cliente",
  portInUse: (p: { port: number }) => `A porta ${p.port} já está em uso`,
  cannotListen: (p: { port: number; reason: string }) => `Não é possível escutar na porta ${p.port}: ${p.reason}`,
  configFileInvalid: (p: { file: string }) => `O arquivo de configuração dos serviços é inválido: ${p.file}`,
  routingOnlyForModelApi: "routing e maxConcurrentPerClient só se aplicam ao serviço de API de modelos (model-api)",
  tokenPlaceholder: (p: { client: string }) => `<token de ${p.client}>`,
  tokenPlaceholderGeneric: "<token>",
  mcpNotRunning: "O serviço MCP está desativado: inicie primeiro (baocut services start mcp), ou os clientes não poderão conectar.",
  nodeServiceConfigure: "Configure o serviço do nó com nodes.share.* (baocut share …)",
  nodeServiceNotListening: "O serviço do nó não está escutando",
};
