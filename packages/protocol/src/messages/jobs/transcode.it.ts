import type { JobsTranscodeMessages } from './transcode.ts';

export const it: JobsTranscodeMessages = {
  label: 'Transcodifica file',
  description: 'Comprimi file video, uniscili in ordine o estrai audio: da file a file, senza creare un video, eseguito da ffmpeg; i risultati non sovrascrivono i file esistenti.',
  inputNotFound: (p) => `Impossibile trovare il file di input ${p.file}`, stepProbe: 'Leggi input', stepEncode: 'Codifica', stepVerify: 'Verifica output', stepPublish: 'Pubblica',
  noAudioTrack: (p) => `${p.name} non ha una traccia audio`, noVideoTrack: (p) => `${p.name} non ha una traccia video`, verifyFailed: (p) => `L’output di ${p.name} non ha superato la verifica`,
  actionShape: 'deve essere compress, merge o extract-audio', mergeNeedsTwo: 'richiede almeno due file da unire',
  audioReencode: (p) => `Il codec audio ${p.codec} non è compatibile con un contenitore audio comune; ricodifica in AAC`,
  fileReason: (p) => `${p.name}: ${p.reason}`, reasonSeparator: '; ',
  fieldVideoCodec: 'Codec video', fieldResolution: 'Risoluzione', fieldFrameRate: 'Frequenza dei fotogrammi', fieldPixelFormat: 'Formato pixel', fieldAudioTrack: 'Traccia audio', fieldAudioCodec: 'Codec audio', fieldSampleRate: 'Frequenza di campionamento', fieldChannels: 'Canali', present: 'sì', absent: 'nessuno',
  fieldMismatch: (p) => `${p.field} differisce (${p.values})`, videoNotMp4: (p) => `Il codec video ${p.codec} non può essere inserito direttamente in MP4`, audioNotMp4: (p) => `Il codec audio ${p.codec} non può essere inserito direttamente in MP4`,
  probeOutputFailed: 'ffprobe non può leggere il file di output', outputNoVideo: 'L’output non ha una traccia video', outputNoAudio: 'L’output non ha una traccia audio',
  durationOff: (p) => `La durata è ${p.actual} s; previsti circa ${p.expected} s`, codecMismatch: (p) => `Il codec video è ${p.actual}; previsto ${p.expected}`,
  heightOver: (p) => `L’altezza del fotogramma ${p.height} supera il limite di ${p.max}`, tooManySameName: (p) => `Troppi file con lo stesso nome nella cartella dei risultati: ${p.name}`,
};
