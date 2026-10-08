import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const ptBR: RuntimeStorageCredentialsMessages = {
  denied: "Acesso negado",
  unavailable: "O armazenamento de credenciais está indisponível",
  unsupported: "Esta plataforma não oferece suporte ao armazenamento seguro do sistema",
  internal: "Erro ao ler ou gravar a credencial",
  problem: (p) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p) => `Não foi possível gravar o arquivo de credenciais (${p.code})`,
  helperBadResponse: "O auxiliar de credenciais retornou uma resposta inválida",
  helperNotFound: "O programa auxiliar de credenciais não foi encontrado",
  helperTimedOut: (p) => `O auxiliar de credenciais não respondeu em ${p.seconds} segundos`,
  helperMissing: "O programa auxiliar de credenciais está ausente",
  helperStartFailed: (p) => `Não foi possível iniciar o auxiliar de credenciais (${p.code})`,
  helperResponseTooLong: "A resposta do auxiliar de credenciais é longa demais",
  helperExitedSilently: "O auxiliar de credenciais saiu sem responder",
  helperReportedError: "O auxiliar de credenciais relatou um erro",
  redacted: "[ocultado]",
};
