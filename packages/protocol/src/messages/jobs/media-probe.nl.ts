import type { JobsMediaProbeMessages } from './media-probe.ts';

export const nl: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `Niet-herkend mediatype ${p.mediaType}`,
  unreadable: "Kan het uitvoerbestand niet lezen",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `De bestandsheader is ${p.sniffed}, maar opgegeven was ${p.mediaType}`,
  unrecognizedFormat: "een niet-herkend formaat",
  notJson: "De uitvoer van ffprobe is geen JSON",
  noAudioStream: "Geen audiostream",
  noImage: "Geen afbeelding",
  noFrames: "Kan geen enkel frame decoderen",
  durationNotPositive: "De duur is niet positief",
  sampleRateNotPositive: "De samplefrequentie is niet positief",
  channelsNotPositive: "Het aantal kanalen is niet positief",
  sizeNotPositive: "De breedte of hoogte is niet positief",
  cannotRun: (p: { reason: string }) => `ffprobe kan niet worden uitgevoerd: ${p.reason}`,
  killedBy: (p: { signal: string }) => `beëindigd door ${p.signal}`,
  exitCode: (p: { code: string }) => `afsluitcode ${p.code}`,
  decodeFailed: (p: { reason: string }) => `Decoderen door ffprobe mislukt (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `Decoderen door ffprobe mislukt (${p.reason}): ${p.output}`,
  noProbe: "ffprobe is niet beschikbaar, dus de uitvoer kan niet worden gecontroleerd",
};
