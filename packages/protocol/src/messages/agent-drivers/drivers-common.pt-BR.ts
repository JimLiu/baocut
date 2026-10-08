import type { DriversCommonMessages } from './drivers-common.ts';

export const ptBR: DriversCommonMessages = {
  executableMissing: (p) => `O comando especificado ${p.command} (${p.path}) não existe ou não pode ser executado.`,
  commandMissing: (p) => `Não foi possível encontrar o comando ${p.command}. ${p.hint}, ou defina seu local nas Configurações.`,
  commandNotFound: (p) => `Não foi possível encontrar o comando ${p.command}`,
  installItFirst: "Instale primeiro",
  versionFailed: (p) => `${p.command} --version não terminou normalmente.`,
  outdated: (p) => `${p.name} ${p.version} é antigo demais. O BaoCut precisa de ${p.min} ou posterior.`,
  startFailed: (p) => `${p.name} não iniciou: ${p.error}`,
  openSessionFailed: (p) => `${p.name} não pôde abrir uma sessão: ${p.error}`,
  confinedUnsupported: (p) => `${p.name} não oferece suporte a chamadas temporárias restritas`,
  resumeFailed: (p) => `Não foi possível retomar a sessão nativa de ${p.name}${p.error ? ` (${p.error})` : ""}. Uma nova sessão foi iniciada; o agente não pode ver a conversa anterior.`,
  sessionClosed: (p) => `${p.name} tem a sessão fechada`,
  sessionNotReady: (p) => `${p.name} ainda não tem sessão pronta`,
  turnInProgress: "O turno anterior ainda não terminou",
  modelSwitchFailed: (p) => `${p.name} não pôde mudar para o modelo ${p.model}: ${p.error}`,
  timedOut: (p) => `${p.label} expirou (${p.seconds} s)`,
  unknownError: "Erro desconhecido",
  unknownReason: "motivo desconhecido",
  imagePlaceholder: "[Imagem]",
  officialScript: "Script oficial",
};
