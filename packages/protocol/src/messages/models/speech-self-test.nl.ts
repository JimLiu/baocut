import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const nl: ModelsSpeechSelfTestMessages = {
  notWav: "Geen RIFF/WAVE-bestand",
  missingFmt: "Het fmt-blok ontbreekt",
  missingData: "Het data-blok ontbreekt",
  unsupportedEncoding: (p: { format: number }) => `Niet-ondersteunde codering (${p.format})`,
  badChannels: (p: { channels: number }) => `Onredelijk aantal kanalen (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Onredelijke samplefrequentie (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Niet-ondersteunde bitdiepte (${p.bits})`,
  nonFinite: "De samples bevatten niet-eindige waarden",
  undecodable: (p: { problem: string }) => `De uitvoer kan niet worden gedecodeerd: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `De duur van ${p.duration} seconden ligt niet tussen ${p.min} en ${p.max} seconden`,
  silent: "De uitvoer is stil",
  clipped: (p: { ratio: string; limit: number }) => `De uitvoer clipt: ${p.ratio} % van de samples bereiken het maximale niveau (limiet ${p.limit} %)`,
};
