import type { EditorMessages } from './editor-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: EditorMessages = {
  withNote: (label: string, note: string) => `${label} (${note})`, labeled: (label: string, value: string) => `${label}: ${value}`, thenNext: (message: string, next: string) => `${message}. ${next}`, gap: ' ',
  undo: 'Annulla', redo: 'Ripeti', cancel: 'Annulla', retry: 'Riprova', addClip: 'Aggiungi clip', editor: 'Editor', notEditableNow: 'Il video non può essere modificato al momento', timeline: 'Timeline', moveClips: 'Sposta clip', importAndAdd: 'Importa e aggiungi materiali', seconds2: (seconds: number) => `${seconds.toFixed(2).replace('.', ',')} s`,
  emptyTimeline: 'Trascina qui i materiali o aggiungili dal pannello a destra', hideTrack: (label: string) => `Nascondi ${label}: non compare nell’anteprima`, showTrack: (label: string) => `Mostra ${label}`, hideTrackLabel: 'Nascondi traccia', showTrackLabel: 'Mostra traccia', unmuteTrack: (label: string) => `Attiva audio di ${label}`, muteTrack: (label: string) => `Disattiva audio di ${label}`, unmuteTrackLabel: 'Attiva audio', muteTrackLabel: 'Disattiva audio della traccia',
  unlockTrack: (label: string) => `Sblocca ${label}`, lockTrack: (label: string) => `Blocca ${label}: le clip sulla traccia non possono essere spostate, rifilate o eliminate`, unlockTrackLabel: 'Sblocca traccia', lockTrackLabel: 'Blocca traccia',
  playTip: { play: 'Riproduci · Space', pause: 'Pausa · Space', replay: 'Riproduci di nuovo' }, playLabel: { play: 'Riproduci', pause: 'Pausa', replay: 'Riproduci di nuovo' },
  undoTip: (label: string, keys: string) => `Annulla «${label}» ${keys}`, redoTip: (label: string, keys: string) => `Ripeti «${label}» ${keys}`, nothingToUndo: 'Nulla da annullare', nothingToRedo: 'Nulla da ripetere', splitTip: 'Dividi alla testina di riproduzione · S', split: 'Dividi', splitClips: 'Dividi clip', deleteTip: 'Elimina selezione · Delete', deleteSelected: 'Elimina selezione', playhead: 'Posizione della testina di riproduzione',
  totalLength: (duration: string) => `Durata totale ${duration}`, editFailed: (message: string) => `Impossibile apportare la modifica: ${message}`, cantOpen: 'Impossibile aprire questo video', openingAria: 'Apertura del video', opening: 'Apertura del video…', resizeTimeline: 'Ridimensiona timeline', workingDraft: 'Bozza di lavoro', previewCanvas: 'Anteprima', previewFailed: 'Impossibile disegnare l’anteprima', emptyDrag: 'Trascina materiali sulla timeline', emptyOr: 'oppure aggiungili dal pannello dei materiali a destra',
  problemsCount: (n: number) => pluralForm('it', n, { one: `Impossibile disegnare ${n} elemento`, other: `Impossibile disegnare ${n} elementi` }), problemsTitle: 'Alcuni contenuti in questo fotogramma non possono essere disegnati', rendererFailed: (message: string) => `Il renderer dell’anteprima non è stato caricato: ${message}`,
  spectrumTooLarge: (itemId: string, assetId: string, mb: number) => `Forma d’onda ${itemId}: il materiale ${assetId} supera ${mb} MB, quindi l’anteprima non ne analizza il suono; l’esportazione non cambia`,
  stall: {
    loading: 'Caricamento dell’anteprima',
    title: 'L’anteprima è bloccata',
    engine: 'Il motore dell’anteprima è ancora in caricamento',
    video: 'Preparazione del video ancora in corso',
    media: (name: string) => `In attesa del media: ${name}`,
    mediaUnnamed: 'In attesa dei media',
    captions: (name: string) => `In attesa dei sottotitoli: ${name}`,
    captionsUnnamed: 'In attesa dei sottotitoli',
    fonts: (name: string) => `In attesa dei font: ${name}`,
    paint: 'L’immagine ha smesso di aggiornarsi',
    body: (seconds: number) => `Atteso ${seconds} s. Riprova ricarica solo l’anteprima; il video non viene modificato.`,
  },
};
