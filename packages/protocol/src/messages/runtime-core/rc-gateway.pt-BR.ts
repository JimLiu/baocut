import type { RcGatewayMessages } from './rc-gateway.ts';

export const ptBR: RcGatewayMessages = {
  helloTimeout: "O handshake expirou",
  textFramesOnly: "Só são aceitos quadros de texto",
  frameNotJson: "O quadro não é JSON válido",
  frameUnrecognized: "Quadro não reconhecido",
  unknownMethod: (p: { method: string }) => `Método desconhecido: ${p.method}`,
  invalidParams: "Parâmetros inválidos",
  helloRequired: "O primeiro quadro deve ser hello",
  invalidToken: "Token inválido",
  protocolMismatch: (p: { client: string; runtime: string }) => `Versões de protocolo incompatíveis: cliente ${p.client}, Runtime ${p.runtime}`,
  internalError: "Erro interno",
  catalogLocalOnly: "O catálogo de ferramentas só está disponível para a CLI local e o aplicativo de desktop",
};
