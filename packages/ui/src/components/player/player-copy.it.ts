import type { PlayerMessages } from './player-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: PlayerMessages = {
  surface: (fileName) => `${fileName}: Space per riprodurre o mettere in pausa, frecce sinistra e destra per saltare indietro o avanti`,
  loading: 'Caricamento in corso', buffering: 'Buffering in corso', openFailed: (message) => `Impossibile aprire questo file: ${message}`,
  subtitles: 'Sottotitoli', cueCount: (n) => pluralForm('it', n, { one: `${n} riga`, other: `${n} righe` }), subtitleFile: 'File di sottotitoli', noSubtitles: 'Nessun sottotitolo',
  listFailed: (message) => `Impossibile elencare i file di sottotitoli: ${message}`, finding: 'Ricerca dei file di sottotitoli…',
  noneNearby: (isAudio) => `Nessun file di sottotitoli nella stessa cartella. Metti un file .srt, .vtt o .ass accanto al ${isAudio ? 'file audio' : 'video'}; viene scelto automaticamente quello con lo stesso nome.`,
  noneSelected: 'Nessun sottotitolo selezionato.', reading: (fileName) => `Lettura di «${fileName}»…`, readFailed: (fileName, message) => `Impossibile leggere «${fileName}»: ${message}`,
  empty: (fileName) => `Nessuna riga trovata in «${fileName}». Sono supportati SRT, WebVTT e ASS.`, unknownFormat: 'Formato dei sottotitoli non riconosciuto', tooLarge: 'Il file è troppo grande', fetchFailed: (status) => `Impossibile leggere il file (${status})`,
  play: 'Riproduci', pause: 'Pausa', playTip: 'Riproduci (Space)', pauseTip: 'Pausa (Space)', replayTip: 'Riproduci di nuovo (Space)',
  overlay: 'Sovrapponi sottotitoli', showTip: 'Mostra sottotitoli (C)', hideTip: 'Nascondi sottotitoli (C)', rateCurrent: (rate) => `Velocità di riproduzione ${rate}×`, rate: 'Velocità di riproduzione', rateNormal: '1× (Normale)',
  mute: 'Disattiva audio', unmute: 'Attiva audio', muteTip: 'Disattiva audio (M)', unmuteTip: 'Attiva audio (M)', volume: 'Volume', fullscreen: 'Schermo intero', exitFullscreen: 'Esci da schermo intero', fullscreenTip: 'Schermo intero (F)', exitFullscreenTip: 'Esci da schermo intero (F)',
  position: 'Posizione di riproduzione', backToCurrent: 'Torna alla riga attuale',
  mediaError: { aborted: 'Il caricamento è stato interrotto', network: 'Si è verificato un errore durante la lettura del file', decode: 'Decodifica non riuscita; il file potrebbe essere danneggiato', unsupported: 'BaoCut non può ancora riprodurre il formato o il codec di questo file', other: 'Impossibile riprodurre questo file' },
};
