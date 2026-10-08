import type { JobsMediaProbeMessages } from './media-probe.ts';

export const fr: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `Type de média non reconnu ${p.mediaType}`,
  unreadable: "Impossible de lire le fichier résultat",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `L’en-tête du fichier est ${p.sniffed}, mais il a été déclaré comme ${p.mediaType}`,
  unrecognizedFormat: "un format non reconnu",
  notJson: "La sortie de ffprobe n’est pas du JSON",
  noAudioStream: "Aucun flux audio",
  noImage: "Aucune image",
  noFrames: "Impossible de décoder une seule image",
  durationNotPositive: "La durée n’est pas positive",
  sampleRateNotPositive: "La fréquence d’échantillonnage n’est pas positive",
  channelsNotPositive: "Le nombre de canaux n’est pas positif",
  sizeNotPositive: "La largeur ou la hauteur n’est pas positive",
  cannotRun: (p: { reason: string }) => `Impossible d’exécuter ffprobe : ${p.reason}`,
  killedBy: (p: { signal: string }) => `terminé par ${p.signal}`,
  exitCode: (p: { code: string }) => `code de sortie ${p.code}`,
  decodeFailed: (p: { reason: string }) => `Échec de décodage ffprobe (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `Échec de décodage ffprobe (${p.reason}) : ${p.output}`,
  noProbe: "ffprobe est indisponible ; impossible de vérifier le résultat",
};
