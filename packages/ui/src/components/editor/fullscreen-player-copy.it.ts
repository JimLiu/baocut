import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const it: FullscreenPlayerMessages = {
  region: 'Player a schermo intero',
  enter: 'Riproduci a schermo intero',
  enterTip: 'Riproduci a schermo intero (F)',
  captions: 'Sottotitoli',
  captionsTip: (mode: string) => `Sottotitoli: ${mode} (C)`,
  captionMode: { off: 'Sottotitoli disattivati', source: 'Originale', trans: 'Traduzione', both: 'Bilingue' },
  keysTip: 'Scorciatoie da tastiera (?)',
  keysTitle: 'Scorciatoie da tastiera',
  keysFooter: 'Premi Esc per chiudere questo elenco e di nuovo per uscire da schermo intero.',
  keys: {
    play: 'Riproduci / pausa (equivale a un clic sull’immagine)',
    exit: 'Esci da schermo intero (equivale a un doppio clic sull’immagine)',
    back: 'Indietro / avanti di 5 secondi',
    back10: 'Indietro / avanti di 10 secondi',
    prevChapter: 'Capitolo precedente / successivo',
    volUp: 'Volume ±10 (riattiva l’audio automaticamente)',
    mute: 'Disattiva / attiva l’audio',
    captions: 'Scorri le modalità dei sottotitoli',
    start: 'Vai all’inizio / alla fine',
    percent: 'Vai allo 0% – 90% del video',
    keys: 'Questo elenco',
  },
};
