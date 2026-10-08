import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const it: TimelineRippleMessages = {
  removeSpan: 'Elimina questo tratto da tutte le tracce',
  removeSpanHint: 'Il seguito avanza · la durata totale si accorcia',
  removeSpanCaptions: 'I sottotitoli coprono tutto il video · Seleziona una clip',
  labelRemoveSpan: 'Elimina tratto da tutte le tracce',
  closed: (deleted: string, seconds: number) => `${deleted} · Chiuso il vuoto di ${secondsLabel(seconds)}`,
  gapKept: (deleted: string) => `${deleted} · Vuoto mantenuto: dopo c’è una traccia o una clip bloccata`,
  removed: (seconds: number) => `Eliminati ${secondsLabel(seconds)} da tutte le tracce · Il seguito è avanzato`,
  pickSpan: 'Seleziona prima una clip sulla timeline, poi elimina il suo tratto da tutte le tracce',
  locked: 'Dopo questo tratto c’è una traccia o una clip bloccata · Sbloccala prima',
};
