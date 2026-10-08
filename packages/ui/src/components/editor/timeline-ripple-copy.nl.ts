import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const nl: TimelineRippleMessages = {
  removeSpan: 'Dit stuk uit alle sporen verwijderen',
  removeSpanHint: 'Wat volgt schuift op · totale duur wordt korter',
  removeSpanCaptions: 'Ondertitels beslaan de hele video · Selecteer een clip',
  labelRemoveSpan: 'Stuk uit alle sporen verwijderen',
  closed: (deleted: string, seconds: number) => `${deleted} · Gat van ${secondsLabel(seconds)} gesloten`,
  gapKept: (deleted: string) => `${deleted} · Gat blijft: een spoor of clip erna is vergrendeld`,
  removed: (seconds: number) => `${secondsLabel(seconds)} uit alle sporen verwijderd · Wat volgt is opgeschoven`,
  pickSpan: 'Selecteer eerst een clip op de tijdlijn en verwijder dan dat stuk uit alle sporen',
  locked: 'Na dit stuk is een spoor of clip vergrendeld · Ontgrendel het eerst',
};
