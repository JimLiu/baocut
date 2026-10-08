import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const ptBR: ModelsSpeechSelfTestMessages = {
  notWav: "Não é um arquivo RIFF/WAVE",
  missingFmt: "O bloco fmt está ausente",
  missingData: "O bloco data está ausente",
  unsupportedEncoding: (p: { format: number }) => `Codificação não suportada (${p.format})`,
  badChannels: (p: { channels: number }) => `Número de canais inválido (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Taxa de amostragem inválida (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Profundidade de bits não suportada (${p.bits})`,
  nonFinite: "As amostras contêm valores não finitos",
  undecodable: (p: { problem: string }) => `Não é possível decodificar a saída: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `A duração de ${p.duration} segundos não está entre ${p.min}–${p.max} segundos`,
  silent: "A saída está silenciosa",
  clipped: (p: { ratio: string; limit: number }) => `A saída apresenta clipping: ${p.ratio}% das amostras atingem a escala total (limite ${p.limit}%)`,
};
