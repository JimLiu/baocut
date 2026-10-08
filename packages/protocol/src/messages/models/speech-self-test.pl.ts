import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const pl: ModelsSpeechSelfTestMessages = {
  notWav: "To nie plik RIFF/WAVE",
  missingFmt: "Brak bloku fmt",
  missingData: "Brak bloku data",
  unsupportedEncoding: (p: { format: number }) => `Nieobsługiwane kodowanie (${p.format})`,
  badChannels: (p: { channels: number }) => `Nieprawidłowa liczba kanałów (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Nieprawidłowa częstotliwość próbkowania (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Nieobsługiwana głębia bitowa (${p.bits})`,
  nonFinite: "Próbki zawierają wartości nieskończone lub nieokreślone",
  undecodable: (p: { problem: string }) => `Nie można zdekodować wyniku: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `Czas trwania ${p.duration} s jest poza zakresem od ${p.min} i jeszcze ${p.max} s`,
  silent: "Wynik jest cichy",
  clipped: (p: { ratio: string; limit: number }) => `Wynik jest przesterowany: ${p.ratio}% próbek osiąga pełną skalę (limit ${p.limit}%)`,
};
