import type { RcGatewayMessages } from './rc-gateway.ts';

export const it: RcGatewayMessages = {
  helloTimeout: "Handshake scaduto",
  textFramesOnly: "Sono accettati solo frame di testo",
  frameNotJson: "Il frame non è JSON valido",
  frameUnrecognized: "Frame non riconosciuto",
  unknownMethod: (p: { method: string }) => `Metodo sconosciuto: ${p.method}`,
  invalidParams: "Parametri non validi",
  helloRequired: "Il primo frame deve essere hello",
  invalidToken: "Token non valido",
  protocolMismatch: (p: { client: string; runtime: string }) => `Versioni del protocollo incompatibili: client ${p.client}, Runtime ${p.runtime}`,
  internalError: "Errore interno",
  catalogLocalOnly: "Il catalogo degli strumenti è disponibile solo per la CLI locale e l’app desktop",
};
