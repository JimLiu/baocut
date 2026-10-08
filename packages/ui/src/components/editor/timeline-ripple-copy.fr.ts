import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const fr: TimelineRippleMessages = {
  removeSpan: 'Supprimer ce passage de toutes les pistes',
  removeSpanHint: 'La suite avance · la durée totale raccourcit',
  removeSpanCaptions: 'Les sous-titres couvrent toute la vidéo · Sélectionnez un clip',
  labelRemoveSpan: 'Supprimer un passage de toutes les pistes',
  closed: (deleted: string, seconds: number) => `${deleted} · Trou de ${secondsLabel(seconds)} refermé`,
  gapKept: (deleted: string) => `${deleted} · Trou conservé : une piste ou un clip verrouillé suit`,
  removed: (seconds: number) => `${secondsLabel(seconds)} supprimé(s) de toutes les pistes · La suite a avancé`,
  pickSpan: 'Sélectionnez d’abord un clip sur la timeline, puis supprimez son passage de toutes les pistes',
  locked: 'Une piste ou un clip verrouillé suit ce passage · Déverrouillez-le d’abord',
};
