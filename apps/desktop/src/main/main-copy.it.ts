import { pluralForm } from '@baocut/protocol';
import type { MainMessages } from './main-copy.ts';

export const it: MainMessages = {
  about: (app: string) => `Informazioni su ${app}`, services: 'Servizi', hide: (app: string) => `Nascondi ${app}`, hideOthers: 'Nascondi altre', showAll: 'Mostra tutto', quit: (app: string) => `Esci da ${app}`, exit: 'Esci',
  fileMenu: 'File', closeWindow: 'Chiudi finestra', close: 'Chiudi', editMenu: 'Modifica', undo: 'Annulla', redo: 'Ripeti', cut: 'Taglia', copy: 'Copia', paste: 'Incolla', pasteAndMatchStyle: 'Incolla e adegua lo stile', delete: 'Elimina', selectAll: 'Seleziona tutto',
  speech: 'Voce', startSpeaking: 'Avvia riproduzione', stopSpeaking: 'Interrompi riproduzione', viewMenu: 'Vista', reload: 'Ricarica', forceReload: 'Forza ricaricamento', toggleDevTools: 'Attiva o disattiva strumenti per sviluppatori', actualSize: 'Dimensione reale', zoomIn: 'Ingrandisci', zoomOut: 'Riduci', toggleFullScreen: 'Attiva o disattiva schermo intero', windowMenu: 'Finestra', minimize: 'Riduci a icona', zoom: 'Zoom', bringAllToFront: 'Porta tutto in primo piano',
  openProjectTitle: 'Apri cartella del progetto', open: 'Apri', choose: 'Scegli', importAssetsTitle: 'Importa materiali', importButton: 'Importa', mediaFilter: 'Video, audio e immagini', allFilesFilter: 'Tutti i file', openFileTitle: 'Apri file', save: 'Salva',
  runtimeNoDiscovery: 'Il Runtime è partito ma non ha scritto il file di rilevamento', runtimeTimeout: 'Il Runtime ha impiegato troppo tempo ad avviarsi',
  runtimeExited: (code: number | null) => `Il Runtime non è riuscito ad avviarsi (codice di uscita ${code})`,
  runtimeQuitting: 'L’app si sta chiudendo',
  quitBusyTitle: (count: number) => pluralForm('it', count, { one: `${count} attività è ancora in corso`, other: `${count} attività sono ancora in corso` }),
  quitBusyDetail: 'Se esci ora, verranno interrotte. Puoi anche lasciarle continuare in background; BaoCut si fermerà da solo al termine.',
  quitKeepRunning: 'Continua in background',
  quitStop: 'Interrompi ed esci',
  relaunchBusyDetail: 'Riavviare ora le interrompe, ma serve perché la nuova autorizzazione abbia effetto.', relaunchStop: 'Interrompi e riavvia',
  cancel: 'Annulla',
  remoteHeading: 'Queste chiamate sono già state inviate. Interromperle non le annulla presso il fornitore e potrebbero comunque essere addebitate:',
  remoteMore: (count: number) => pluralForm('it', count, { one: `e un’altra`, other: `e altre ${count}` }),
  callKind: { agent: 'Attività dell’agente', task: 'Attività', transcribe: 'Trascrivi', synthesizeSpeech: 'Genera voce', generateImage: 'Genera immagine', generateMusic: 'Genera musica', generateText: 'Genera testo', modelTest: 'Verifica modello', voiceClone: 'Clona voce', agentTranslate: 'Traduci' },
  webCreateNotWindow: 'Solo le finestre dell’app possono creare schede web', webTooManyTabs: 'Troppe schede web aperte', webTabMissing: 'Questa scheda web non esiste più', webClearNotWindow: 'Solo le finestre dell’app possono cancellare dati web', webOpenNotWindow: 'Solo le finestre dell’app possono aprire link esterni', webOpenScheme: 'Si possono aprire solo URL http e https',
  runtimeOlderCliBusy: (version: string, jobs: number | null) =>
    `Un Runtime di BaoCut precedente (${version}) avviato dalla riga di comando ${jobs === null ? 'è ancora in esecuzione' : `ha ancora lavori in corso: ${jobs}`}. BaoCut passerà da solo a questa versione quando avrà finito`,
};
