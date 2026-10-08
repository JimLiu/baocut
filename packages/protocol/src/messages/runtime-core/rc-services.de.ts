import type { RcServicesMessages } from './rc-services.ts';

export const de: RcServicesMessages = {
  mcpServiceLabel: "MCP-Dienst",
  nodeServiceLabel: "LAN-Knoten",
  serviceNotAvailable: (p: { serviceId: string }) => `Diese Version bietet noch nicht den Dienst „${p.serviceId}“`,
  serviceNotFound: (p: { serviceId: string }) => `Kein Dienst „${p.serviceId}“`,
  runtimeStopping: "Runtime wird gestoppt",
  clientNotFound: "Kein solcher Client",
  portInUse: (p: { port: number }) => `Port ${p.port} wird bereits verwendet`,
  cannotListen: (p: { port: number; reason: string }) => `Lauschen an diesem Port nicht möglich: ${p.port}: ${p.reason}`,
  configFileInvalid: (p: { file: string }) => `Die Dienstkonfigurationsdatei ist fehlerhaft: ${p.file}`,
  routingOnlyForModelApi: "routing und maxConcurrentPerClient gelten nur für den Modell-API-Dienst (model-api)",
  tokenPlaceholder: (p: { client: string }) => `<Token für ${p.client}>`,
  tokenPlaceholderGeneric: "<token>",
  mcpNotRunning: "Der MCP-Dienst ist ausgeschaltet: zuerst starten (baocut services start mcp), damit Clients sich verbinden können.",
  nodeServiceConfigure: "Knotendienst mit nodes.share.* konfigurieren (baocut share …)",
  nodeServiceNotListening: "Der Knotendienst lauscht nicht",
};
