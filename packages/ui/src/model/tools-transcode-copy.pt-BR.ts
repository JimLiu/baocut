import type { ToolsTranscodeMessages } from './tools-transcode-copy.ts';

import { pluralForm } from '@baocut/protocol';
const plural = (n: number, one: string, many: string) => pluralForm('pt-BR', n, { one, other: many });

export const ptBR: ToolsTranscodeMessages = {
  quality: {
    smaller: { name: "Menor", sub: "Suficiente para mensagens e nuvem" },
    balanced: { name: "Equilibrado", sub: "Diferença difícil de perceber" },
    high: { name: "Alta qualidade", sub: "Manter para editar depois" },
  },
  heightOriginal: "Originais",
  heightOriginalLong: "Resolução original",
  codecSub: {
    h264: "Reproduz em todo lugar",
    hevc: "40% menor na mesma qualidade; antigos podem não reproduzir",
  },

  notVideoFiles: (names: readonly string[]) => `${names.join(", ")} ${plural(names.length, "não é arquivo de vídeo", "não são arquivos de vídeo")}`,
  notAbsolute: (paths: readonly string[]) => `${paths.join(", ")} ${plural(paths.length, "não é caminho absoluto", "não são caminhos absolutos")}`,
  alreadyListed: (names: readonly string[]) => `${names.join(", ")} ${plural(names.length, "já está na lista", "já estão na lista")}`,
  overflow: (limit: number, extra: number) => `Até ${limit} arquivos por vez; ${extra} outros ${plural(extra, "foi", "foram")} não adicionados`,
  joinNotices: (bits: readonly string[]) => bits.join("; "),

  needTwoVideos: "Adicione ao menos dois vídeos",
  needMediaFile: "Escolha vídeo ou áudio primeiro",
  needVideoFile: "Escolha arquivo de vídeo primeiro",
  needOneMore: "Mesclar exige dois vídeos; adicione mais um",
  tooManyFiles: (limit: number) => `Até ${limit} arquivos por vez`,
  videoKbpsRange: (min: number, max: number) => `Taxa de bits do vídeo deve estar entre ${min} e ${max} kbps`,
  audioKbpsRange: (min: number, max: number) => `Taxa de bits do áudio deve estar entre ${min} e ${max} kbps`,
  outDirAbsolute: "Pasta de resultado deve ser caminho absoluto",
  ffmpegUnusable: (message: string) => `ffmpeg indisponível: ${message}`,
  audioKbps: (kbps: number) => `Áudio ${kbps} kbps`,

  ffmpegNeeded: "Instale ffmpeg primeiro",
  ffmpegInstallHint: "Instale ffmpeg ou defina BAOCUT_FFMPEG",
  ffmpegReady: (version: string) => `ffmpeg${version} pronto`,
  ffmpegOutdated: (version: string) => `ffmpeg${version} é antiga demais`,
  ffmpegCannotRun: "ffmpeg não executa",

  filesTitle: (first: string, count: number) => `${first} e ${count - 1} a mais`,
  defaultTitle: "Conversão de arquivo",
  mergeTitle: (first: string, more: number) => `${first} + ${more} a mais`,
  qualityWithCrf: (name: string, crf: number) => `${name} (CRF ${crf})`,
  mergeStreamCopy: (n: number) => `Mesclar ${n} clipes · cópia de fluxo`,
  extractAudioMany: (n: number) => `Extrair áudio de ${n} arquivos`,
  extractAudio: "Extrair áudio",
  mergeClips: (n: number) => `Mesclar ${n} clipes`,
  compressMany: (n: number) => `Comprimir ${n} arquivos`,
  compress: "Compactar",
  stepQueued: (step: string, detail: string | null) => `${step} · ${detail ?? "Na fila"}`,
  stepOf: (step: string, cur: number, total: number) => `${step} · etapa ${cur} de ${total}`,
  noAudioTrack: "Sem áudio",
  mergedSize: (after: string, before: string) => `${after} (total das origens ${before})`,
  savedSize: (before: string, after: string, saved: number | null) =>
    `${before} → ${after} (${saved === null ? "não menor" : saved === 0 ? "quase igual" : `${saved}% menor`})`,
  streamCopyLine: "Clipes compatíveis: fluxos copiados sem reencodificar, qualidade intacta",
  reencodeLine: (reason: string | null) => (reason ? `Reencodificado: ${reason}` : "Recodificado"),
  underASecond: "Menos de 1 segundo",
  took: (duration: string) => `Levou ${duration}`,
  stateQueued: "Na fila",
  stateProcessing: "Trabalhando",

  remedyThenRetry: (remedy: string) => `${remedy}, depois tente`,
  inputUnreadable: "Não foi possível ler quadros. Confira no reprodutor ou escolha outro arquivo",
  transcodeFailed: "ffmpeg falhou; saída original abaixo. Se disco cheio, libere; se origem movida, escolha de novo",
  validationFailed: "Resultado inválido e descartado, nada na pasta. Repita ou mude configurações",
};
