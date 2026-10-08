import type { RcVideoMessages } from './rc-video.ts';

export const it: RcVideoMessages = {
  engineExited: 'Il motore video è terminato, quindi la modifica potrebbe non essere stata registrata. Riprova con lo stesso comando',
  engineStartFailed: (p) => `Impossibile avviare il motore video: ${p.reason}`,
  engineNotRunning: 'Il motore video non è in esecuzione', engineRequestFailed: (p) => `Il motore non è riuscito a gestire ${p.method}`,
  engineRestarting: 'Il motore video si sta riavviando. Riprova tra poco con lo stesso comando', runtimeStopping: 'Il Runtime si sta interrompendo',
  engineNotFound: 'Il motore video (engine-host) non è stato trovato. Esegui prima npm run build:engine',
  defaultDirName: 'Video', untitledVideo: 'Video senza titolo', sourceDirNotFound: 'La cartella di origine non esiste', reservedDirOutsideSource: 'La cartella riservata non è nella cartella di origine', videoInUse: 'Questo video è aperto',
  videoNotOpenOpenFirst: 'Il video non è aperto. Aprilo prima', assetVersionNotFound: 'Il materiale o questa versione non esiste', videoNotFound: 'Il video non esiste', onlyWorkspaceVideos: 'Si possono aprire solo video nella cartella di lavoro',
  videoDeletedRestoreFromTrash: 'Questo video è stato eliminato. Ripristinalo prima dal Cestino', dirNotVideo: 'Questa cartella non è un video', linkedPreviewUnsupported: 'Si possono visualizzare in anteprima solo immagini, audio, video, font e animazioni Lottie collegati',
  packageNotFound: 'Il pacchetto portatile non esiste', packageNotFile: 'Il pacchetto portatile deve essere un file .baocut', videoInTrash: 'Questo video è nel Cestino. Ripristinalo prima', videoNotInSourceDir: 'Il video non è in una cartella di progetto o sessione',
  cantCreateInSession: 'Questo Runtime non può creare video in una sessione', targetLocationIncomplete: 'La posizione del video di destinazione è incompleta', reservedDirOutsideProject: 'La cartella riservata non è in questa cartella di progetto o sessione', pipelinePrincipalName: 'Flusso',
  openElsewhere: 'Questo video è aperto in un’altra finestra o connessione. Chiudilo prima lì', videoBusy: 'Questo video ha ancora attività o esportazioni in corso. Annullale prima',
  crossDevice: 'La cartella del video e quella di origine non sono sullo stesso disco, quindi non può essere spostata nel Cestino',
  videoEntryNotFound: 'Impossibile trovare questo video (non è nello Space o lo Space sta ancora eseguendo la scansione)',
  notDeletedVideo: 'Questa voce non è un video eliminato', restoreRootGone: 'Il progetto o la sessione di questo video non esiste più, quindi non può essere ripristinato', trashDirGone: 'La cartella del video nel Cestino non esiste più',
  sourceRootInTrash: 'Questa cartella del video è una cartella di progetto o una cartella di lavoro di sessione (o ne contiene una), quindi non può essere spostata nel Cestino',
  sourceRootRemedy: 'In BaoCut, rimuovi prima il progetto o la sessione che usa questa cartella, poi elimina questo video dal progetto padre',
  compositionImportFailed: (p) => `Impossibile importare la grafica animata (${p.code})`,
  compositionPreviewFailed: (p) => `Impossibile visualizzare l’anteprima della grafica animata (${p.code})`,
};
