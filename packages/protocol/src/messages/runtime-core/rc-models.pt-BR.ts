import { pluralForm } from '../../i18n.ts';
import type { RcModelsMessages } from './rc-models.ts';

export const ptBR: RcModelsMessages = {

  offlineStrict: "Modelos não são baixados no modo off-line estrito",
  sizeChanged: "O tamanho do download mudou. Confirme o novo plano",
  bundleInUse: "Pacote de modelo em uso. Exclua após as tarefas terminarem ou serem canceladas",
  diarizationNoCheck:
    "O pacote de diarização não tem teste próprio; é usado junto ao pacote de reconhecimento na transcrição",
  bundleUnavailable: "Pacote de modelo indisponível agora",
  installFailed: "Ocorreu um problema ao instalar o modelo",
  noSuchBundle: (p: { bundleId: string }) => `Sem pacote de modelo: ${p.bundleId}`,
  movingDirWait: "A pasta dos modelos está sendo movida. Tente após concluir",
  dirMissing:
    "A pasta não existe (disco externo desconectado pode causar isso). Conecte e tente, ou escolha outra pasta nas Configurações",
  selfTestSampleLabel: "a amostra de teste de reconhecimento",

  workerFailed: (p: { reason: string }) => `Worker falhou: ${p.reason}`,
  workerCancelledCheck: "O Worker cancelou o teste",
  noWorkerOutput: "O Worker não produziu resultado",
  outputMissing: "O arquivo de resultado não existe",
  outputMismatch: "Tamanho ou sha256 do resultado não corresponde à resposta do Worker",
  namedOutputMissing: (p: { file: string }) => `O arquivo de resultado ${p.file} não existe`,
  namedOutputMismatch: (p: { file: string }) => `O tamanho ou sha256 de ${p.file} não corresponde à resposta do Worker`,
  outputNotJson: "O resultado não é JSON válido",
  outputNotAsrResult: "O resultado não segue o contrato asr-result",
  transcriptMissingExpected: (p: { expected: string }) => `O texto reconhecido não contém “${p.expected}”`,
  separationPassed: (p: { duration: string; sampleRate: number; ratio: string; finite: boolean }) =>
    `${p.duration} s · ${p.sampleRate} Hz · voz ${p.finite ? `${p.ratio} dB` : "muito"} acima do fundo`,
  speechPassed: (p: { duration: string; sampleRate: number }) => `${p.duration} s · ${p.sampleRate} Hz`,
  imagePassed: (p: { width: number; height: number; steps: number }) => `${p.width}×${p.height} · ${p.steps} passos`,

  envLocked: "Pasta definida por BAOCUT_MODELS_DIR. Altere a variável e reinicie o BaoCut para mudar",
  movingDirWaitOrCancel: "Pasta sendo movida. Altere após conclusão ou cancelamento",
  folderMissing: "Esta pasta não existe (disco externo desconectado pode causar isso)",
  folderNotWritable: "O BaoCut não tem permissão para gravar nesta pasta",
  dirNested: "As pastas atual e nova estão contidas uma na outra. Escolha uma que não contenha nem esteja dentro da outra",
  noSpaceForMove: "O disco do novo local não tem espaço para mover os modelos",
  noSpaceRemedy: "Libere espaço, escolha outro local ou “Alterar apenas o local”",
  dirInUse: "Tarefas usam modelos locais. Mude a pasta após conclusão ou cancelamento",
  sourceKept: (p: { count: number }) =>
    `${p.count} ${pluralForm('pt-BR', p.count, { one: "repositório", other: "repositórios" })} da pasta antiga não puderam ser excluídos. Exclua manualmente`,
  moveNoSpace: "O disco do novo local encheu. O movimento foi revertido",
  moveFailed: "Ocorreu um problema ao mover; o movimento foi revertido",
  moveFailedRemedy: "A pasta original não mudou e os modelos funcionam",

  noAlignableFormat: (p: { modelId: string }) => `Modelo ${p.modelId} não gera um formato de áudio que possa ser alinhado`,
  synthOutputCount: (p: { count: number }) => `A síntese de fala produziu ${p.count} resultados; deveria produzir 1`,
  synthOutputOutsideStaging: "O resultado da síntese não está na pasta temporária",
  dubGrantHint: (p: { recipient: string }) =>
    `A dublagem envia a transcrição (tradução e original sem tradução) para ${p.recipient}. A autorização padrão ao ativar o provedor não inclui transcrições. O usuário deve autorizar explicitamente (com o comando abaixo ou nas Configurações) e executar a dublagem novamente.`,
  voiceRemoved: (p: { reason: string; voice: string }) => `${p.reason}: voz ${p.voice}`,

  notSpeakersJob: "Esta tarefa não é reconhecimento de falantes",
  jobNotForVideo: "Este reconhecimento não pertence a este vídeo",
  speakersNotDone: "O reconhecimento de falantes não terminou",
  speakersCleaned: "Os resultados foram limpos. Identifique falantes novamente",

  recoveryPrincipalName: "Recuperação de tarefa",
};
