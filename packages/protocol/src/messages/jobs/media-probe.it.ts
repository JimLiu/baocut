import type { JobsMediaProbeMessages } from './media-probe.ts';

export const it: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `Tipo di media non riconosciuto ${p.mediaType}`,
  unreadable: "Impossibile leggere il file di output",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `L’intestazione del file è ${p.sniffed}, ma è stato dichiarato come ${p.mediaType}`,
  unrecognizedFormat: "un formato non riconosciuto",
  notJson: "L’output di ffprobe non è JSON",
  noAudioStream: "Nessun flusso audio",
  noImage: "Nessuna immagine",
  noFrames: "Impossibile decodificare un singolo fotogramma",
  durationNotPositive: "La durata non è positiva",
  sampleRateNotPositive: "La frequenza di campionamento non è positiva",
  channelsNotPositive: "Il numero di canali non è positivo",
  sizeNotPositive: "La larghezza o l’altezza non è positiva",
  cannotRun: (p: { reason: string }) => `Impossibile eseguire ffprobe: ${p.reason}`,
  killedBy: (p: { signal: string }) => `terminato da ${p.signal}`,
  exitCode: (p: { code: string }) => `Codice di uscita ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe non è riuscito a decodificare (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe non è riuscito a decodificare (${p.reason}): ${p.output}`,
  noProbe: "ffprobe non è disponibile, quindi non è possibile verificare l’output",
};
