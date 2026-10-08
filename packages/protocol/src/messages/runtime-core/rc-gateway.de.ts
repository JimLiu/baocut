import type { RcGatewayMessages } from './rc-gateway.ts';

export const de: RcGatewayMessages = {
  helloTimeout: "Handshake-Zeitlimit überschritten",
  textFramesOnly: "Nur Textframes werden akzeptiert",
  frameNotJson: "Der Frame ist kein gültiges JSON",
  frameUnrecognized: "Nicht erkannter Frame",
  unknownMethod: (p: { method: string }) => `Unbekannte Methode: ${p.method}`,
  invalidParams: "Ungültige Parameter",
  helloRequired: "Der erste Frame muss hello sein",
  invalidToken: "Ungültiges Token",
  protocolMismatch: (p: { client: string; runtime: string }) =>
    `Inkompatible Protokollversionen: Client ${p.client}, Runtime ${p.runtime}`,
  internalError: "Interner Fehler",
  catalogLocalOnly: "Der Werkzeugkatalog ist nur für die lokale CLI und Desktop-App verfügbar",
};
