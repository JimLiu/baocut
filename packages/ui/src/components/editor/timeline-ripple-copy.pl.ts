import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const pl: TimelineRippleMessages = {
  removeSpan: 'Usuń ten odcinek ze wszystkich ścieżek',
  removeSpanHint: 'Dalsza część się przesunie · całość będzie krótsza',
  removeSpanCaptions: 'Napisy obejmują cały film · Zaznacz klip',
  labelRemoveSpan: 'Usuń odcinek ze wszystkich ścieżek',
  closed: (deleted: string, seconds: number) => `${deleted} · Zamknięto lukę ${secondsLabel(seconds)}`,
  gapKept: (deleted: string) => `${deleted} · Luka pozostała: dalej jest zablokowana ścieżka lub klip`,
  removed: (seconds: number) => `Usunięto ${secondsLabel(seconds)} ze wszystkich ścieżek · Dalsza część przesunęła się`,
  pickSpan: 'Najpierw zaznacz klip na osi czasu, a potem usuń jego odcinek ze wszystkich ścieżek',
  locked: 'Za tym odcinkiem jest zablokowana ścieżka lub klip · Najpierw odblokuj',
};
