import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const es: TimelineRippleMessages = {
  removeSpan: 'Eliminar este tramo de todas las pistas',
  removeSpanHint: 'El contenido posterior se adelanta · la duración total se acorta',
  removeSpanCaptions: 'Los subtítulos abarcan todo el video · Selecciona un clip',
  labelRemoveSpan: 'Eliminar tramo de todas las pistas',
  closed: (deleted: string, seconds: number) => `${deleted} · Se cerró el hueco de ${secondsLabel(seconds)}`,
  gapKept: (deleted: string) => `${deleted} · El hueco se mantiene: hay una pista o un clip bloqueado después`,
  removed: (seconds: number) => `Se eliminaron ${secondsLabel(seconds)} de todas las pistas · El contenido posterior se adelantó`,
  pickSpan: 'Primero selecciona un clip en la línea de tiempo y luego elimina su tramo de todas las pistas',
  locked: 'Hay una pista o un clip bloqueado después de este tramo · Desbloquéalo primero',
};
