import type { ClientConnectionMessages } from './client-connection.ts';

export const ptBR: ClientConnectionMessages = {
  closed: "O cliente está fechado",
  disconnected: "A conexão com o Runtime foi perdida",
  connectionLost: "Conexão perdida",
  cannotConnect: "Não é possível conectar ao Runtime",
  requestTimedOut: (p) => `A solicitação expirou: ${p.method}`,
  unknownError: "Erro desconhecido",
};
