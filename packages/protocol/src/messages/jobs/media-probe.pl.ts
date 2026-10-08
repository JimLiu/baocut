import type { JobsMediaProbeMessages } from './media-probe.ts';

export const pl: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `Nierozpoznany typ multimediów ${p.mediaType}`,
  unreadable: "Nie udało się odczytać pliku wyniku",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `Nagłówek pliku wskazuje ${p.sniffed}, ale zadeklarowano ${p.mediaType}`,
  unrecognizedFormat: "nierozpoznany format",
  notJson: "Wynik ffprobe nie jest JSON",
  noAudioStream: "Brak strumienia audio",
  noImage: "Brak obrazu",
  noFrames: "Nie udało się zdekodować ani jednej klatki",
  durationNotPositive: "Czas trwania nie jest dodatni",
  sampleRateNotPositive: "Częstotliwość próbkowania nie jest dodatnia",
  channelsNotPositive: "Liczba kanałów nie jest dodatnia",
  sizeNotPositive: "Szerokość lub wysokość nie jest dodatnia",
  cannotRun: (p: { reason: string }) => `Nie udało się uruchomić ffprobe: ${p.reason}`,
  killedBy: (p: { signal: string }) => `zakończono sygnałem ${p.signal}`,
  exitCode: (p: { code: string }) => `kod zakończenia ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe nie zdekodował (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe nie zdekodował (${p.reason}): ${p.output}`,
  noProbe: "ffprobe jest niedostępny, więc nie można sprawdzić wyniku",
};
