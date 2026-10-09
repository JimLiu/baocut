import { pluralForm } from '../../i18n.ts';
import type { JobsManagerMessages } from './job-manager.ts';

export const ptBR: JobsManagerMessages = {

  runtimeStopping: "O Runtime está parando",
  jobNotFound: "A tarefa não existe",
  noBundle: "Não existe esse pacote de modelo",
  noBundleId: (p: { bundleId: string }) => `Pacote de modelo inexistente: ${p.bundleId}`,
  jobIdExists: "O ID da tarefa já existe",
  onlyHostedRerun: "Só tarefas hospedadas podem ser executadas novamente assim",
  notEnded: "A tarefa ainda não terminou",
  hintTooLong: "A dica de termos não pode ultrapassar 1200 caracteres",
  hintIgnored: (p: { model: string }) => `${p.model} não aceita dicas de reconhecimento; a dica não foi usada`,
  onlyAudioVideo: "Só mídias de áudio ou vídeo podem ser transcritas",
  pathNotAbsolute: "Os caminhos devem ser absolutos",
  trackInvalid: "track deve ser um inteiro não negativo",
  noGeneration: "Este Runtime não oferece geração",
  videoNotOpen: "O vídeo não está aberto",
  contentHashInvalid: "O hash do conteúdo deve ser sha256:<hex>",
  timescaleInvalid: "timescale deve ser um inteiro positivo",
  rangeInvalid: "range é inválido",
  bundleCannotTranscribe: "Este pacote de modelo não pode transcrever",
  bundleUnavailable: "O pacote de modelo não está disponível agora",
  localInferenceUnavailable: "Inferência local indisponível",
  invalidLanguageTag: (p: { tag: string }) => `Tag de idioma BCP 47 inválida: ${p.tag}`,
  cannotReadInput: "Não foi possível ler o arquivo de entrada",

  jobReconciling: "Esta tarefa está sendo recuperada ou reconciliada",
  openVideoToRetry: "O vídeo não está aberto; abra e tente novamente",
  openVideoToApply: "O vídeo não está aberto; abra e aplique",
  receiptUnknownLater: "Recibo da última confirmação não encontrado; tente mais tarde",
  receiptUnknown: "Recibo da última confirmação não encontrado",
  requeueCheckFailed: "A verificação antes de voltar à fila falhou",
  assetVersionGone: "A mídia ou sua versão não está mais no vídeo",
  assetChanged: "O conteúdo da mídia mudou",
  cannotRerun: "Esta tarefa não pode ser executada novamente",
  cannotOpenVideoAfterRestart: "Não foi possível abrir o vídeo após reiniciar",
  videoNotOpenNoPlace: "O vídeo não está aberto e seu local é desconhecido",
  videoFolderGone: "A pasta do vídeo não existe mais",
  videoReplaced: "Outro vídeo está no local original",
  recoverFailed: "A recuperação da tarefa falhou",
  interrupted: "A tarefa não terminou antes do Runtime parar; você pode enviá-la novamente",
  needsReconciliation:
    "Uma chamada externa não havia retornado quando o Runtime parou; execução e cobrança remotas são desconhecidas. Escolha tentar novamente ou descartar (não será reenviada automaticamente)",

  executeFailed: "A execução da tarefa falhou",
  providerUnavailable: "Provedor indisponível",
  executorGone: "O executor da tarefa não está mais disponível",
  localCrashedAfterRetry: "O processo de inferência local falhou novamente após uma tentativa",
  transcribeFailedAfterRetry: "A transcrição falhou novamente após uma tentativa",

  outputCountMismatch: (p: { actual: number; expected: number }) =>
    `${pluralForm('pt-BR', p.actual, { one: `há ${p.actual} resultado`, other: `há ${p.actual} resultados` })}, mas ${p.expected} ${pluralForm('pt-BR', p.expected, { one: "foi", other: "foram" })} solicitados`,
  outputNotInStaging: (p: { n: number }) => `Resultado ${p.n} não está na pasta temporária`,
  outputMissing: (p: { n: number }) => `Resultado ${p.n} não existe`,
  outputLengthMismatch: (p: { n: number; actual: number; declared: number }) =>
    `Resultado ${p.n} é ${p.actual} bytes, mas ${p.declared} foi declarado`,
  outputShaMismatch: (p: { n: number }) => `Resultado ${p.n}: sha256 não corresponde ao declarado`,
  outputTypeMismatch: (p: { n: number; actual: string; expected: string }) =>
    `Resultado ${p.n} é ${p.actual}, mas ${p.expected} foi solicitado`,
  outputProblem: (p: { n: number; problem: string }) => `Resultado ${p.n}: ${p.problem}`,
  noTextResult: "O executor não retornou texto",
  textOutputCount: (p: { actual: number }) => `Há ${p.actual} resultados; deveria haver 1`,
  textNotInStaging: "O resultado não está na pasta temporária",
  textMissing: "O resultado não existe",
  textLengthMismatch: (p: { actual: number; declared: number }) => `O resultado tem ${p.actual} bytes, mas ${p.declared} foi declarado`,
  textShaMismatch: "O sha256 do resultado não corresponde ao declarado",
  textTypeMismatch: (p: { actual: string; expected: string }) => `O resultado tem ${p.actual}, mas ${p.expected} foi solicitado`,
  notUtf8: "O resultado não é UTF-8 válido",
  notJson: "O resultado não é JSON válido",
  emptyOutput: "O resultado está vazio",
  generatedInvalid: "O resultado gerado falhou na verificação de decodificação",

  asrFileNotInStaging: "O arquivo de resultado não está na pasta temporária",
  asrFileMissing: "O arquivo de resultado não existe",
  asrLengthMismatch: (p: { actual: number; declared: number }) => `O resultado tem ${p.actual} bytes, mas a resposta informou ${p.declared}`,
  asrShaMismatch: "O sha256 do resultado não corresponde à resposta",
  asrContractInvalid: "A saída do modelo não atende a baocut.asr-result/v1",

  outputTruncated: (p: { limit: number }) => `A saída atingiu o limite (${p.limit} tokens) e foi cortada; o conteúdo está incompleto`,
  saveCopyFailed: (p: { dir: string; reason: string }) => `Não foi possível gravar uma cópia em ${p.dir}: ${p.reason}`,

  applyError: "A gravação no vídeo falhou",
  transcribeLabel: "Transcrição",
  voiceOverLabel: "Gerar dublagem",
  imageLabel: "Gerar imagem",
  videoClosed: "O vídeo foi fechado",
  assetGone: "A mídia não está mais no vídeo",
  assetChangedDuringTranscribe: "O conteúdo da mídia mudou durante a transcrição",
  generatedGone: "O resultado gerado não existe mais",
  asrGone: "O resultado da transcrição não existe mais",
  asrNotJson: "O resultado da transcrição não é JSON válido",
  asrInvalid: "O resultado da transcrição não atende ao contrato",
  targetGone: "O destino não existe mais",
  staleGeneratedKept: (p: { reason: string }) => `${p.reason}; o resultado gerado foi mantido`,
  protectedKept: (p: { generated: boolean }) =>
    `${p.generated ? "Geração" : "Transcrição"} terminou, mas o resultado afetou o escopo protegido do contrato; não foi gravado no vídeo. O resultado foi mantido; o usuário decide se aplica`,
  applyFailedKept: (p: { generated: boolean }): string =>
    p.generated
      ? "A geração terminou, mas a importação no vídeo falhou; o resultado foi mantido"
      : "A transcrição terminou, mas a gravação no vídeo falhou; o resultado foi mantido",
};
