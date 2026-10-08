import type { MainMessages } from './main-copy.ts';

export const it: MainMessages = {
  about: (app: string) => `Informazioni su ${app}`, services: 'Servizi', hide: (app: string) => `Nascondi ${app}`, hideOthers: 'Nascondi altre', showAll: 'Mostra tutto', quit: (app: string) => `Esci da ${app}`, exit: 'Esci',
  fileMenu: 'File', closeWindow: 'Chiudi finestra', close: 'Chiudi', editMenu: 'Modifica', undo: 'Annulla', redo: 'Ripeti', cut: 'Taglia', copy: 'Copia', paste: 'Incolla', pasteAndMatchStyle: 'Incolla e adegua lo stile', delete: 'Elimina', selectAll: 'Seleziona tutto',
  speech: 'Voce', startSpeaking: 'Avvia riproduzione', stopSpeaking: 'Interrompi riproduzione', viewMenu: 'Vista', reload: 'Ricarica', forceReload: 'Forza ricaricamento', toggleDevTools: 'Attiva o disattiva strumenti per sviluppatori', actualSize: 'Dimensione reale', zoomIn: 'Ingrandisci', zoomOut: 'Riduci', toggleFullScreen: 'Attiva o disattiva schermo intero', windowMenu: 'Finestra', minimize: 'Riduci a icona', zoom: 'Zoom', bringAllToFront: 'Porta tutto in primo piano',
  openProjectTitle: 'Apri cartella del progetto', open: 'Apri', choose: 'Scegli', importAssetsTitle: 'Importa materiali', importButton: 'Importa', mediaFilter: 'Video, audio e immagini', allFilesFilter: 'Tutti i file', openFileTitle: 'Apri file', save: 'Salva',
  runtimeNoDiscovery: 'Il Runtime è partito ma non ha scritto il file di rilevamento', runtimeTimeout: 'Il Runtime ha impiegato troppo tempo ad avviarsi',
  runtimeExited: (code: number | null) => `Il Runtime non è riuscito ad avviarsi (codice di uscita ${code})`,
  webCreateNotWindow: 'Solo le finestre dell’app possono creare schede web', webTooManyTabs: 'Troppe schede web aperte', webTabMissing: 'Questa scheda web non esiste più', webClearNotWindow: 'Solo le finestre dell’app possono cancellare dati web', webOpenNotWindow: 'Solo le finestre dell’app possono aprire link esterni', webOpenScheme: 'Si possono aprire solo URL http e https',
};
