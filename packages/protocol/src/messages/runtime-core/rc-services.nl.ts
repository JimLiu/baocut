import type { RcServicesMessages } from './rc-services.ts';

export const nl: RcServicesMessages = {
  mcpServiceLabel: "MCP-dienst",
  nodeServiceLabel: "LAN-knooppunt",
  serviceNotAvailable: (p: { serviceId: string }) => `Deze versie biedt nog niet de dienst ‘${p.serviceId}’`,
  serviceNotFound: (p: { serviceId: string }) => `Geen dienst ‘${p.serviceId}’`,
  runtimeStopping: "Runtime wordt gestopt",
  clientNotFound: "Deze client bestaat niet",
  portInUse: (p: { port: number }) => `Poort ${p.port} is al in gebruik`,
  cannotListen: (p: { port: number; reason: string }) => `Kan niet luisteren op poort ${p.port}: ${p.reason}`,
  configFileInvalid: (p: { file: string }) => `Het configuratiebestand voor diensten is ongeldig: ${p.file}`,
  routingOnlyForModelApi: "routing en maxConcurrentPerClient gelden alleen voor de model-API-dienst (model-api)",
  tokenPlaceholder: (p: { client: string }) => `<token voor ${p.client}>`,
  tokenPlaceholderGeneric: "<token>",
  mcpNotRunning: "De MCP-dienst staat uit: start die eerst (baocut services start mcp), anders kunnen clients niet verbinden.",
  nodeServiceConfigure: "Configureer de knooppuntdienst met nodes.share.* (baocut share …)",
  nodeServiceNotListening: "De knooppuntdienst luistert niet",
};
