import type { RcExportMessages } from './rc-export.ts';

import { pluralForm } from '../../i18n.ts';
const s = (n: number, one: string, many: string) => pluralForm('pt-BR', n, { one, other: many });

export const ptBR: RcExportMessages = {

  listSeparator: ", ",
  clauseSeparator: "; ",

  destinationNotAbsolute: "A pasta de exportação deve ser um caminho absoluto",
  destinationCreateFailed: (p: { reason: string }) => `Não foi possível criar a pasta de exportação: ${p.reason}`,
  destinationNotDirectory: "A pasta de exportação não existe ou não é uma pasta",
  destinationNotWritable: "A pasta de exportação não permite gravação",
  destinationFileExists: (p: { fileName: string }) => `O arquivo já existe: ${p.fileName}`,
  destinationWriteFailed: (p: { reason: string }) => `Não foi possível gravar na pasta de exportação: ${p.reason}`,
  destinationTooManyDuplicates: "Arquivos demais com o mesmo nome",
  destinationExistsRecovery: "Escolha outro nome ou peça explicitamente para sobrescrever (overwrite)",
  destinationUnwritableRecovery: "Escolha uma pasta gravável ou peça ao usuário para alterar as permissões",

  exportTaskNotFound: "Tarefa de exportação não encontrada",
  exportKindUnsupported: (p: { kind: string }) => `Esta versão não pode exportar ${p.kind} ainda`,
  videoNotOpen: "O vídeo não está aberto; abra primeiro",
  fileNameWithMultipleRanges: "Cada intervalo gera seu próprio arquivo; não podem compartilhar fileName",
  documentNotExportable: (p: { kind: string }) => `${p.kind} documentos não podem ser exportados como legendas ou transcrição`,
  nothingInRange: "Não há texto no intervalo (pode ter sido cortado ou o documento estar vazio)",
  audioExportNeeds: (p: { missing: string }) => `A exportação de áudio exige ${p.missing}`,
  loudnessNeedsWorker: "Normalizar volume exige Render Worker (export-worker), não encontrado",
  videoExportNeeds: (p: { missing: string }) => `A exportação de vídeo exige ${p.missing}`,
  videoExportNeedsWorker: "A exportação de vídeo exige Render Worker (export-worker), não encontrado",
  videoExportNeedsEncoders: (p: { encoders: string }) => `A exportação de vídeo exige os codificadores ffmpeg ${p.encoders}`,
  unsupportedContent: (p: { count: number; items: string }) =>
    `${p.count} ${s(p.count, "item não pode", "itens não podem")} ser renderizados na exportação: ${p.items}`,
  unsupportedContentRemedy: "Remova ou substitua o conteúdo, ou ignore com onUnsupported: 'skip' (cada item é registrado como aviso)",
  workerRemedy: "Compile Render Worker (`npm run build:engine`) ou defina BAOCUT_EXPORT_WORKER para o local de export-worker",
  workerGone: (p: { error: string }) => `Render Worker (export-worker) não está mais disponível: ${p.error}`,
  fontCensusNeedsWorker: "Verificar fontes exige Render Worker (export-worker), não encontrado",
  sequenceNotFound: (p: { sequenceId: string }) => `Sequência ${p.sequenceId} não existe`,
  sequenceMissing: "A sequência não existe",
  dubGroupNotFound: (p: { groupId: string }) => `Esta sequência não tem o grupo de dublagem ${p.groupId}`,
  projectNothingToExport:
    "A sequência não tem clipes exportáveis para projeto (vídeo, imagens, áudio ou composições com pré-renderização)",
  noSourceForLanguage: (p: { language: string }) => `Não há legendas ou transcrição em ${p.language}`,
  noSource: "O vídeo não tem legendas ou transcrição para exportar",
  bilingualDocumentNotFound: "O documento para mesclar em saída bilíngue não existe",
  bilingualNeedsOtherDocument: "A saída bilíngue exige outro documento",
  noBilingualCounterpart: "Não há outro idioma para mesclar (tradução ou legendas em outro idioma)",
  sourceAmbiguous: "Há vários documentos exportáveis; escolha com documentId ou language",
  linkedAssetMissing: (p: { name: string }) => `A mídia vinculada “${p.name}” não está mais no local`,
  linkedAssetContentChanged: (p: { name: string }) =>
    `A mídia vinculada “${p.name}” mudou desde o vínculo; vincule novamente ou troque explicitamente de revisão`,
  linkedAssetGoneBeforeExport: (p: { name: string }) => `A mídia vinculada “${p.name}” desapareceu antes da exportação`,
  linkedAssetChangedBeforeExport: (p: { name: string }) => `A mídia vinculada “${p.name}” foi modificada antes da exportação`,

  fileNotExported: (p: { fileName: string; problems: string }) => `${p.fileName} não foi exportado: ${p.problems}`,
  noFilesExported: "Nenhum arquivo foi exportado",
  partiallyPublished: (p) => `${p.failed} ${s(p.failed, 'arquivo não foi exportado', 'arquivos não foram exportados')}; ${p.published} ${s(p.published, 'foi publicado', 'foram publicados')}`,
  xmlIncomplete: "O XML gravado está incompleto",

  toolStartFailed: (p: { tool: string; error: string }) => `${p.tool} não iniciou: ${p.error}`,
  toolExited: (p: { tool: string; code: string; output: string }) => `${p.tool} encerrou com ${p.code}: ${p.output}`,
  ffmpegEncoder: (p: { encoder: string }) => `o codificador ffmpeg ${p.encoder}`,
  ffmpegAmixNormalize: "ffmpeg 4.4 ou posterior (opção normalize de amix)",
  ffmpegFilter: (p: { filter: string }) => `o codificador ffmpeg ${p.filter} filtro`,
  masterNeedsWorker: "Normalizar volume exige export-worker",
  workerExitedUnexpectedly: (p: { signal: string | null; code: string; output: string }) =>
    `export-worker encerrou inesperadamente (${p.signal ?? `código de saída ${p.code}`})${p.output ? `: ${p.output}` : ""}`,

  planAssetNotFrozen: (p: { assetId: string }) => `Mídia ${p.assetId} no plano não foi congelada`,
  loudnessNotMeasurable: "A mixagem é silenciosa ou curta demais para medir volume; só o limite de pico real foi aplicado",
  audioNote: (p: { itemId: string; note: string }) => `Item ${p.itemId}: ${p.note}`,
  noteDuckNoSpeech:
    "A redução de volume por fala não teve efeito: não há transcrição ou as palavras não estão na linha do tempo",
  noteHoldIsSilent: "Itens com quadro congelado ficam sem som (como na prévia)",
  noteAssetHasNoAudio: "A mídia não tem fluxo de áudio; nada para mixar",
  noteCrossfadeHandleShort:
    "O crossfade de áudio precisa de mídia além do intervalo (handles); falta conteúdo desse lado, exportado como silêncio",
  gainAbovePreview: (p: { itemId: string; gainDb: number }) =>
    `Item ${p.itemId} tem ganho de pico de +${p.gainDb} dB: a prévia limita a 0 dB, mas a exportação aplica o valor e soará mais alta`,

  outputSizeAdjusted: (p: { width: number; height: number; canvasWidth: number; canvasHeight: number }) =>
    `Tamanho de saída definido para ${p.width}×${p.height} (segue a proporção ${p.canvasWidth}×${p.canvasHeight} do canvas, com dimensões pares)`,
  outputSizeLetterboxed: (p: { width: number; height: number; pictureWidth: number; pictureHeight: number }) =>
    `Tamanho de saída definido para ${p.width}×${p.height} (dimensões pares; a imagem tem ${p.pictureWidth}×${p.pictureHeight}, o restante são barras pretas)`,
  contentSkippedEffect: (p: { itemId: string; effectId: string; kind: string; message: string }) =>
    `Efeito ${p.effectId} (${p.kind}) no item ${p.itemId} ignorado: ${p.message}`,
  contentSkippedTransition: (p: { transitionId: string; kind: string; message: string }) =>
    `Transição ${p.transitionId} (${p.kind}) renderizada como corte: ${p.message}`,
  contentSkippedItem: (p: { itemId: string; layerKind: string; message: string }) =>
    `Item ${p.itemId} (${p.layerKind}) não foi renderizado: ${p.message}`,
  fontNotDownloaded: (p: { family: string; weight: number; italic: boolean; reason: string; fallback: string }) =>
    `“${p.family}" ${p.weight}${p.italic ? " itálico" : ""}: ${p.reason}; usando “${p.fallback}” no lugar`,
  fontNotDownloadedReason: "Não baixado",
  fontStillMissingAfterDownload: "Ainda não encontrada após baixar",
  fontDownloadUnavailable: "Download de fontes indisponível",

  translationPartialSkipped: (p) => `${p.count} ${s(p.count, 'frase foi cortada parcialmente e ficou sem tradução', 'frases foram cortadas parcialmente e ficaram sem tradução')}`,
  translationStale: (p) => `${p.count} ${s(p.count, 'unidade de tradução está desatualizada (a origem mudou) e não foi gravada', 'unidades de tradução estão desatualizadas (a origem mudou) e não foram gravadas')}`,
  bilingualUnmatched: (p) => `${p.count} ${s(p.count, 'entrada do outro idioma fica fora das frases principais e não foi gravada', 'entradas do outro idioma ficam fora das frases principais e não foram gravadas')}`,
  cueSplitEstimated: (p) => `${p.count} ${s(p.count, 'frase foi dividida', 'frases foram divididas')} em vários blocos nos tempos interpolados das palavras; os tempos são estimados`,
  assStyleUnmapped: (p: { styles: string }) => `Estilos não representáveis em ASS (não gravados): ${p.styles}`,
  assWholeStyle: (p: { schema: string | null }) => `O estilo inteiro (${p.schema ?? "sem schema"})`,

  durationMismatch: (p: { actual: number; expected: number; tolerance: number }) =>
    `A duração é ${p.actual} s, esperado ${p.expected} s (tolerância ${p.tolerance})`,
  sampleRateMismatch: (p: { actual: number; expected: number }) => `A taxa de amostragem é ${p.actual}, mas a configuração é ${p.expected}`,
  channelsMismatch: (p) => `${p.actual} ${s(p.actual, 'canal', 'canais')}, mas a configuração é ${p.expected}`,
  validationFailed: (p: { problems: string }) => `O resultado falhou na validação: ${p.problems}`,
  probeFailed: (p: { error: string }) => `ffprobe não consegue ler o resultado: ${p.error}`,
  probeNotJson: "A saída de ffprobe não é JSON",
  noAudioStream: "Nenhum fluxo de áudio",
  noDecodableFrame: "Não foi possível decodificar nenhum quadro",
  noVideoStream: "O resultado não tem fluxo de vídeo",
  frameCountMismatch: (p: { actual: number; expected: number }) => `${p.actual} quadros, esperado ${p.expected}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) =>
    `O tamanho é ${p.width}×${p.height}, esperado ${p.expectedWidth}×${p.expectedHeight}`,
  fpsMismatch: (p: { actual: string; expected: string }) => `A taxa de quadros é ${p.actual}, esperado ${p.expected}`,
  codecMismatch: (p: { actual: string; expected: string }) => `O codec de vídeo é ${p.actual}, esperado ${p.expected}`,
  videoDurationMismatch: (p: { actual: number; expected: number }) =>
    `A duração da imagem é ${p.actual} s, esperado ${p.expected} s (tolerância de um quadro)`,
  noAudioInOutput: "O resultado não tem áudio",
  audioDurationMismatch: (p: { actual: number; expected: number }) =>
    `A duração do áudio é ${p.actual} s; deve corresponder à imagem (${p.expected} s)`,
  vttMissingHeader: "VTT sem cabeçalho WEBVTT",
  cueMissingIndex: (p: { n: number }) => `Bloco ${p.n} não tem índice`,
  cueTimeLineUnparsable: (p: { n: number }) => `Não foi possível analisar a linha de tempo do bloco ${p.n}`,
  cueNoText: (p: { n: number }) => `Bloco ${p.n} não tem texto`,
  assMissingSections: "ASS sem cabeçalhos de seção",
  cueTimeUnparsable: (p: { n: number }) => `Não foi possível analisar os tempos do bloco ${p.n}`,
  wordTimeOutsideSentence: "Os tempos das palavras ficam fora da frase",
  invalidJson: "JSON inválido",
  cueEndNotAfterStart: (p: { n: number }) => `Bloco ${p.n} não termina depois de começar`,
  cueOverlapsPrevious: (p: { n: number }) => `Bloco ${p.n} sobrepõe a anterior`,
  lastCueBeyondRange: (p: { end: number; range: number }) => `O último bloco termina em ${p.end} s, além de ${p.range} s de intervalo de exportação`,
  entryCountMismatch: (p: { parsed: number; written: number }) => `Lidas ${p.parsed} entradas, mas ${p.written} foram gravados`,
  noContent: "Sem conteúdo",

  itemKindVideo: "Vídeo",
  itemKindImage: "Imagem",
  itemKindAudio: "Áudio",
  itemKindText: "Texto",
  itemKindShape: "Forma",
  itemKindComposition: "Composição",
  itemKindCaption: "Legendas",
  itemKindSticker: "Adesivo",
  itemKindVisualizer: "Forma de onda",
  itemKindProgress: "Barra de progresso",
  itemKindDraw: "Desenho",
  itemKindPlaceholder: "Espaço reservado",
  itemKindConfetti: "Confete",
  itemKindWhiteboard: "Quadro branco",
  projectItemOmitted: (p: { kind: string; itemId: string; name: string | null; reason: string }) =>
    `${p.kind} item ${p.itemId}${p.name ? ` "${p.name}”` : ""}: ${p.reason}`,
  projectFpsInexact: (p: { fps: string; timebase: number }) =>
    `A taxa de quadros da sequência ${p.fps} só pode ser gravada como ${p.timebase} em xmeml`,
  projectAssetOffline: (p: { name: string; reason: string }) =>
    `Não foi possível ler a mídia “${p.name}" (${p.reason}); é um clipe off-line no projeto`,
  projectTransitionOmitted: (p: { kind: string }) => `Transição ${p.kind} não gravado no projeto (gravado como corte)`,
  embeddedAudioTrack: (p: { n: number }) => `Áudio incorporado ${p.n}`,
  omitCaption: "legendas não gravadas no projeto (exporte SRT separadamente)",
  omitUnsupportedKind: "não gravado no projeto (xmeml não pode representar)",
  omitNoPrerender: "a composição não tem pré-renderização e não foi gravada no projeto",
  omitAssetMissing: "a mídia referenciada não existe",
  omitFreezeFrame: "quadro congelado não gravado no projeto",
  omitSpeed: "velocidade não gravada no projeto (gravado em velocidade normal)",
  omitSubframe: "início subquadro arredondado para o quadro mais próximo",
  omitAudioMix: "volume, fades e envelope não gravados no projeto",
  omitPlacement: "posição, escala, rotação e espelhamento não gravados no projeto (gravado preenchendo o canvas)",
  omitOpacity: "opacidade não gravada no projeto",
  omitCornerRadius: "cantos arredondados não gravados no projeto",
  omitEffects: "efeitos não gravados no projeto",
  omitMask: "máscara não gravada no projeto",
  omitAnimation: "animação de elementos não gravada no projeto",
  omitKeyframes: "quadros-chave não gravados no projeto",
  omitCrop: "recorte não gravado no projeto",
  omitEmbeddedAudioMix: "volume, fades e envelope do áudio incorporado não gravados no projeto",
};
