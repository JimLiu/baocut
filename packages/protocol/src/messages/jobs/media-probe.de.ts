import type { JobsMediaProbeMessages } from './media-probe.ts';

export const de: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `Nicht erkannter Medientyp ${p.mediaType}`,
  unreadable: "Ergebnisdatei konnte nicht gelesen werden",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `Der Dateikopf ist ${p.sniffed}, deklariert war jedoch ${p.mediaType}`,
  unrecognizedFormat: "ein nicht erkanntes Format",
  notJson: "Die Ausgabe von ffprobe ist kein JSON",
  noAudioStream: "Kein Audiostream",
  noImage: "Kein Bild",
  noFrames: "Kein einziger Frame konnte decodiert werden",
  durationNotPositive: "Die Dauer ist nicht positiv",
  sampleRateNotPositive: "Die Abtastrate ist nicht positiv",
  channelsNotPositive: "Die Kanalanzahl ist nicht positiv",
  sizeNotPositive: "Die Breite oder Höhe ist nicht positiv",
  cannotRun: (p: { reason: string }) => `ffprobe konnte nicht ausgeführt werden: ${p.reason}`,
  killedBy: (p: { signal: string }) => `beendet durch ${p.signal}`,
  exitCode: (p: { code: string }) => `Exit-Code ${p.code}`,
  decodeFailed: (p: { reason: string }) => `Decodierung durch ffprobe fehlgeschlagen (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `Decodierung durch ffprobe fehlgeschlagen (${p.reason}): ${p.output}`,
  noProbe: "ffprobe ist nicht verfügbar; das Ergebnis kann daher nicht geprüft werden",
};
