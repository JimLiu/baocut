import type { RcServicesMessages } from './rc-services.ts';

export const pl: RcServicesMessages = {
  mcpServiceLabel: "Usługa MCP",
  nodeServiceLabel: "Węzeł sieci lokalnej",
  serviceNotAvailable: (p: { serviceId: string }) => `Ta wersja nie udostępnia jeszcze usługi „${p.serviceId}”`,
  serviceNotFound: (p: { serviceId: string }) => `Brak usługi „${p.serviceId}”`,
  runtimeStopping: "Runtime zatrzymuje się",
  clientNotFound: "Brak takiego klienta",
  portInUse: (p: { port: number }) => `Port ${p.port} jest już zajęty`,
  cannotListen: (p: { port: number; reason: string }) => `Nie można nasłuchiwać na porcie ${p.port}: ${p.reason}`,
  configFileInvalid: (p: { file: string }) => `Nieprawidłowy plik konfiguracji usług: ${p.file}`,
  routingOnlyForModelApi: "routing i maxConcurrentPerClient dotyczą tylko usługi API modeli (model-api)",
  tokenPlaceholder: (p: { client: string }) => `<token dla ${p.client}>`,
  tokenPlaceholderGeneric: "<token>",
  mcpNotRunning: "Usługa MCP jest wyłączona: najpierw ją uruchom (baocut services start mcp), inaczej klienci nie mogą się połączyć.",
  nodeServiceConfigure: "Skonfiguruj usługę węzła przez nodes.share.* (baocut share …)",
  nodeServiceNotListening: "Usługa węzła nie nasłuchuje",
};
