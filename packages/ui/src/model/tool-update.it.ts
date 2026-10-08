import type { ToolUpdateMessages } from './tool-update.ts';

export const it: ToolUpdateMessages = {
  standalone: 'Programma indipendente ufficiale',
  updateInTerminal: 'Aggiorna nel Terminale',
  unknownInstall: 'Impossibile capire come è stato installato questo yt-dlp. Esegui il comando corrispondente alla tua installazione, poi fai clic su «Verifica di nuovo».',
  cannotRun: 'BaoCut non può eseguire questo comando per te.',
  thenRecheck: 'Poi fai clic su «Verifica di nuovo».',
  runThenRecheck: 'Esegui questo comando nel Terminale, poi fai clic su «Verifica di nuovo».',
  updateWith: (method) => `Aggiorna con ${method}`,
  stoppedTitle: 'Aggiornamento interrotto',
  stoppedBody: 'Il comando potrebbe essere stato eseguito solo in parte. Controlla l’output qui sotto, poi fai clic su «Verifica di nuovo» per confermare la versione attuale di yt-dlp.',
  failedTitle: (exitCode) => exitCode === null ? 'Aggiornamento non completato' : `Aggiornamento non completato (codice di uscita ${exitCode})`,
  failedBody: (error) => `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}Il tuo yt-dlp esistente non è stato modificato. L’output è qui sotto; puoi anche copiare il comando, eseguirlo nel Terminale e fare clic su «Verifica di nuovo».`,
  updatedTo: (version) => `Aggiornato a ${version}`,
  upToDate: (version) => version ? `Già aggiornato (${version})` : 'Già aggiornato',
  logTruncated: '… (output precedente omesso; l’output completo è nel registro dell’attività)\n',
  logStopped: '(Interrotto)',
  logExitCode: (exitCode) => `(Codice di uscita ${exitCode})`,
};
