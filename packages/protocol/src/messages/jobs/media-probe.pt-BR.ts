import type { JobsMediaProbeMessages } from './media-probe.ts';

export const ptBR: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `Tipo de mídia não reconhecido ${p.mediaType}`,
  unreadable: "Não foi possível ler o arquivo de saída",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `O cabeçalho do arquivo é ${p.sniffed}, mas foi declarado como ${p.mediaType}`,
  unrecognizedFormat: "um formato não reconhecido",
  notJson: "A saída de ffprobe não é JSON",
  noAudioStream: "Nenhum fluxo de áudio",
  noImage: "Nenhuma imagem",
  noFrames: "Não foi possível decodificar nenhum quadro",
  durationNotPositive: "A duração não é positiva",
  sampleRateNotPositive: "A taxa de amostragem não é positiva",
  channelsNotPositive: "O número de canais não é positivo",
  sizeNotPositive: "A largura ou altura não é positiva",
  cannotRun: (p: { reason: string }) => `Não foi possível executar ffprobe: ${p.reason}`,
  killedBy: (p: { signal: string }) => `encerrado por ${p.signal}`,
  exitCode: (p: { code: string }) => `Código de saída ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe falhou ao decodificar (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe falhou ao decodificar (${p.reason}): ${p.output}`,
  noProbe: "ffprobe não está disponível, então não é possível verificar a saída",
};
