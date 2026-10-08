import type { RcGatewayMessages } from './rc-gateway.ts';

export const nl: RcGatewayMessages = {
  helloTimeout: "Handshake verlopen",
  textFramesOnly: "Alleen tekstframes worden geaccepteerd",
  frameNotJson: "Het frame is geen geldige JSON",
  frameUnrecognized: "Niet-herkend frame",
  unknownMethod: (p: { method: string }) => `Onbekende methode: ${p.method}`,
  invalidParams: "Ongeldige parameters",
  helloRequired: "Het eerste frame moet hello zijn",
  invalidToken: "Ongeldig token",
  protocolMismatch: (p: { client: string; runtime: string }) =>
    `Incompatibele protocolversies: client ${p.client}, Runtime ${p.runtime}`,
  internalError: "Interne fout",
  catalogLocalOnly: "De toolcatalogus is alleen beschikbaar voor de lokale CLI en de desktop-app",
};
