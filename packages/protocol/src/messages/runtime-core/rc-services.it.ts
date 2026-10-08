import type { RcServicesMessages } from './rc-services.ts';

export const it: RcServicesMessages = {
  mcpServiceLabel: "Servizio MCP",
  nodeServiceLabel: "Nodo LAN",
  serviceNotAvailable: (p: { serviceId: string }) => `Questa versione non offre ancora il servizio «${p.serviceId}»`,
  serviceNotFound: (p: { serviceId: string }) => `Nessun servizio «${p.serviceId}»`,
  runtimeStopping: "Il Runtime si sta interrompendo",
  clientNotFound: "Nessun client corrispondente",
  portInUse: (p: { port: number }) => `La porta ${p.port} è già in uso`,
  cannotListen: (p: { port: number; reason: string }) => `Impossibile restare in ascolto sulla porta ${p.port}: ${p.reason}`,
  configFileInvalid: (p: { file: string }) => `Il file di configurazione dei servizi non è valido: ${p.file}`,
  routingOnlyForModelApi: "routing e maxConcurrentPerClient si applicano solo al servizio API dei modelli (model-api)",
  tokenPlaceholder: (p: { client: string }) => `<token per ${p.client}>`,
  tokenPlaceholderGeneric: "<token>",
  mcpNotRunning: "Il servizio MCP è disattivato: avvialo prima (baocut services start mcp), altrimenti i client non possono connettersi.",
  nodeServiceConfigure: "Configura il servizio del nodo con nodes.share.* (baocut share …)",
  nodeServiceNotListening: "Il servizio del nodo non è in ascolto",
};
