import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const de: TimelineRippleMessages = {
  removeSpan: 'Abschnitt aus allen Spuren löschen',
  removeSpanHint: 'Nachfolgendes rückt auf · Gesamtlänge wird kürzer',
  removeSpanCaptions: 'Untertitel reichen über das ganze Video · Wählen Sie einen Clip',
  labelRemoveSpan: 'Abschnitt aus allen Spuren löschen',
  closed: (deleted: string, seconds: number) => `${deleted} · Lücke von ${secondsLabel(seconds)} geschlossen`,
  gapKept: (deleted: string) => `${deleted} · Lücke bleibt: Eine Spur oder ein Clip danach ist gesperrt`,
  removed: (seconds: number) => `${secondsLabel(seconds)} aus allen Spuren gelöscht · Nachfolgendes ist aufgerückt`,
  pickSpan: 'Wählen Sie zuerst einen Clip auf der Zeitleiste aus und löschen Sie dann seinen Abschnitt aus allen Spuren',
  locked: 'Nach diesem Abschnitt ist eine Spur oder ein Clip gesperrt · Zuerst entsperren',
};
