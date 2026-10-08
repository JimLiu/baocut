import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const it: ModelsSpeechSelfTestMessages = {
  notWav: "Non è un file RIFF/WAVE",
  missingFmt: "Il blocco fmt manca",
  missingData: "Il blocco data manca",
  unsupportedEncoding: (p: { format: number }) => `Codifica non supportata (${p.format})`,
  badChannels: (p: { channels: number }) => `Numero di canali non valido (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Frequenza di campionamento non valida (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Profondità di bit non supportata (${p.bits})`,
  nonFinite: "I campioni contengono valori non finiti",
  undecodable: (p: { problem: string }) => `Impossibile decodificare l’output: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `La durata di ${p.duration} secondi non è compresa tra ${p.min}–${p.max} secondi`,
  silent: "L’output è silenzioso",
  clipped: (p: { ratio: string; limit: number }) => `L’output presenta clipping: ${p.ratio}% dei campioni raggiunge il fondo scala (limite ${p.limit}%)`,
};
