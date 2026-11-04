import type { DriversCodexMessages } from './drivers-codex.ts';

export const ptBR: DriversCodexMessages = {
  plan: "Assinatura ChatGPT Plus ou Pro",
  installHint: "Instalar Codex CLI",
  signedOut: (p) => `Codex não está conectado. Execute codex login em um terminal.${p.detail ? ` (${p.detail})` : ""}`,
  loginCheckFailed: (p) => `Não foi possível verificar o login do Codex: ${p.command} login status falhou. O BaoCut executa este programa com subcomandos como login status e app-server, então um script wrapper precisa repassar os argumentos sem alterações.${p.detail ? ` (${p.detail})` : ''}`,
  customProvider: 'Provedor de modelos personalizado',
  chatgptAccount: "Conta ChatGPT",
  apiKey: "Chave de API OpenAI",
  accessToken: "Token de acesso",
  workloadIdentity: "Identidade de carga de trabalho",
  codexAccount: "Conta Codex",
  steerMismatch: (p) => `Codex deu uma resposta inesperada a turn/steer: turno esperado ${p.expected}, recebido ${p.received}`,
  appServerExited: (p) => `codex app-server saiu (code ${p.code}, signal ${p.signal})${p.stderr ? `
${p.stderr}` : ""}`,
  connectionClosed: "A conexão com codex app-server está fechada",
  requestTimeout: (p) => `A solicitação de codex app-server expirou: ${p.method}`,
  appServerGone: "codex app-server saiu",
};
