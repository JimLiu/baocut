import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const de: ModelsSpeechSelfTestMessages = {
  notWav: "Keine RIFF/WAVE-Datei",
  missingFmt: "Der fmt-Block fehlt",
  missingData: "Der data-Block fehlt",
  unsupportedEncoding: (p: { format: number }) => `Nicht unterstützte Codierung (${p.format})`,
  badChannels: (p: { channels: number }) => `Unplausible Kanalanzahl (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Unplausible Abtastrate (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Nicht unterstützte Bittiefe (${p.bits})`,
  nonFinite: "Die Samples enthalten nichtendliche Werte",
  undecodable: (p: { problem: string }) => `Das Ergebnis kann nicht decodiert werden: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `Die Dauer von ${p.duration} Sekunden liegt nicht zwischen ${p.min} und ${p.max} Sekunden`,
  silent: "Das Ergebnis ist stumm",
  clipped: (p: { ratio: string; limit: number }) => `Das Ergebnis übersteuert: ${p.ratio} % der Samples erreichen den Maximalpegel (Limit ${p.limit} %)`,
};
