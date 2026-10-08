import { pluralForm } from '../../i18n.ts';
import type { JobsLocalProviderMessages } from './local-provider.ts';

export const ptBR: JobsLocalProviderMessages = {
  assetUnreadable: "Não foi possível ler a mídia",
  notHandled: (p: { capability: string }) => `O provedor local não executa ${p.capability}`,
  referenceChanged: "A gravação de referência mudou após o envio",
  referenceUnreadable: "Não foi possível ler a gravação de referência",
  speechOutputWrong: (p: { file: string }) => `O resultado sintetizado não é ${p.file} na área temporária`,
  stemOutputWrong: (p: { file: string }) => `O resultado separado não é ${p.file} na área temporária`,
  speakersOutputWrong: (p: { file: string }) => `O resultado de identificação dos falantes não é ${p.file} na área temporária`,
  imageNoInput: "A geração local de imagens não tem arquivo de entrada",
  imageOutputWrong: (p: { file: string }) => `O resultado de imagem não é ${p.file} na área temporária`,
  runtimeStopping: "O Runtime está parando",
  bundleRequired: "A inferência local exige um pacote de modelo",
  bundleDisabled: "O pacote de modelo está desativado",
  workerBusy: "O Worker deste pacote está executando outra tarefa",
  workerVersionChanged: "A versão do Worker difere da primeira tentativa; não haverá repetição automática",
  noOutput: "job.run retornou completed sem resultado",
  workerExitedDuringJob: "Model Worker encerrou durante a tarefa",
  inferenceFailed: (p: { code: string }) => `A inferência falhou: ${p.code}`,
  stagingUnwritable: "Não foi possível gravar o resultado na área temporária; verifique o espaço em disco",
  workerUnsupported: (p: { message: string }) => `Model Worker não aceita esta tarefa: ${p.message}`,
  jobRunReturned: (p: { code: string }) => `job.run retornou ${p.code}`,
  workerNotFound: "Model Worker (model-worker) não foi encontrado",
  workerCannotStart: "Não foi possível iniciar Model Worker",
  workerExitedOnStart: "Model Worker encerrou logo após iniciar",
  handshakeFailed: "A negociação com Model Worker falhou",
  contractMismatch: "A versão do contrato de Model Worker não corresponde",
  backendUnavailable: (p: { backend: string }) => `Este Model Worker não pode usar o backend ${p.backend}`,
  cannotSeparate: "Este Model Worker ainda não separa voz e fundo localmente com este modelo",
  cannotGenerateImage: "Este Model Worker ainda não gera imagens localmente com este modelo",
  cannotDiarize: "Este Model Worker ainda não identifica falantes localmente",
  cannotTranscribe: "Este Model Worker ainda não transcreve localmente com este modelo",
  cannotSynthesize: "Este Model Worker ainda não sintetiza fala localmente com este modelo",
  loadFailed: (p: { reason: string }) => `O carregamento do pacote de modelo falhou: ${p.reason}`,
  workerExitedOnLoad: "Model Worker encerrou durante o carregamento",
  crashedRepeatedly: (p: { minutes: number; count: number }) =>
    `Falhou ${p.count} ${pluralForm('pt-BR', p.count, { one: "vez", other: "vezes" })} em ${p.minutes} ${pluralForm('pt-BR', p.minutes, { one: "minuto", other: "minutos" })}`,

  readingDroppedOne: (p: { at: number; reading: string; origin: string }) =>
    `Caractere ${p.at} não foi sintetizado com a leitura “${p.reading}" (${p.origin})`,
  readingDroppedRange: (p: { from: number; to: number; reading: string; origin: string }) =>
    `Caracteres ${p.from}–${p.to} não foram sintetizados com a leitura “${p.reading}" (${p.origin})`,
};
