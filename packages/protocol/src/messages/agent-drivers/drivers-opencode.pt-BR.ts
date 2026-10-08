import type { DriversOpencodeMessages } from './drivers-opencode.ts';

export const ptBR: DriversOpencodeMessages = {
  plan: 'Contas de modelos no OpenCode', installHint: 'Instalar 2.x com npm install -g @opencode/cli',
  unsupportedMajor: (p) => `OpenCode ${p.version} é uma versão principal que o BaoCut ainda não oferece suporte. Somente 2.x é suportada.`,
  tooOld: (p) => `OpenCode ${p.version} é antigo demais. Atualize: o BaoCut precisa de ${p.min} ou uma 2.x posterior (${p.command}).`,
  unsupportedVersion: (p) => `OpenCode ${p.version} não é suportado. Precisa de ${p.min} ou uma 2.x posterior`, versionUnknown: 'versão desconhecida',
  noModelAccount: (p) => `Ainda não há conta de modelo conectada no OpenCode, então só os modelos gratuitos do OpenCode Zen estão disponíveis. Execute ${p.command} em um terminal para conectar uma.`,
  probeFailed: (p) => `OpenCode serve não pôde iniciar ou ler a lista de modelos: ${p.error}`, externalDirectory: 'Acessar um local fora da pasta de trabalho',
  directoryNotReady: (p) => `OpenCode não preparou a pasta ${p.directory} em ${p.seconds} s`,
  httpFailed: (p) => `A operação ${p.operation} do OpenCode falhou (HTTP ${p.status}${p.tag ? ` ${p.tag}` : ''})${p.detail ? `: ${p.detail}` : ''}`,
  htmlResponse: 'Recebida uma página web em vez da API v2 (versão incompatível?)', processExited: 'O processo do OpenCode saiu', killedBySignal: (p) => `Encerrado pelo sinal ${p.signal}`, exitCode: (p) => `Código de saída ${p.code}`,
  serveNotReady: (p) => `opencode serve não ficou pronto em ${p.seconds} s`, serveExitedAtStart: (p) => `opencode serve saiu durante a inicialização (${p.reason})`, serveExited: 'opencode serve saiu',
  streamConnectFailed: (p) => `Não foi possível conectar ao fluxo de eventos (HTTP ${p.status})`, streamEnded: 'O fluxo de eventos terminou', streamNotConnected: (p) => `O fluxo de eventos não conectou (${p.seconds} s)`, streamLost: (p) => `Fluxo de eventos desconectado: ${p.error}`,
  mcpFailed: (p) => `${p.name} não pôde conectar ao servidor MCP ${p.server} (${p.error}). As ferramentas do BaoCut não estão disponíveis nesta sessão.`,
  mcpTimeout: (p) => `${p.name} não conectou aos servidores MCP (${p.servers}) a tempo. As ferramentas do BaoCut podem não estar disponíveis nesta sessão.`,
  promptRejected: (p) => `${p.name} não aceitou esta mensagem: ${p.error}`, setModeFailed: (p) => `${p.name} não pôde definir o modo de acesso: ${p.error}`, retryFallback: 'A solicitação ao modelo falhou. Uma nova tentativa será feita em breve.',
  runFailed: (p) => `A execução de ${p.name} falhou`,
  endedAfterRejection: (p) => `${p.name} terminou este turno após uma ferramenta ser recusada. Envie outra mensagem se quiser tentar outra abordagem.`,
  interruptedTurn: (p) => `${p.name} interrompeu este turno (${p.reason}).`, modelFormat: (p) => `Modelos de ${p.name} devem ser escritos como provider/model (recebido ${p.id})`,
};
