import type { SpaceSearchMessages } from './space-search.ts';
import { pluralForm } from '@baocut/protocol';

export const it: SpaceSearchMessages = {
  documentKind: { speech: 'Trascrizione', caption: 'Sottotitoli', translation: 'Traduzione', chapter: 'Capitolo' },
  pendingVideos: (count: number) => `L’indice dei contenuti di ${count} video non ha finito di aggiornarsi; i risultati potrebbero omettere video o non essere aggiornati`,
  indexUpdating: 'L’indice dei contenuti si sta aggiornando; i risultati potrebbero non essere aggiornati',
  truncated: (count: number) => `Troppe corrispondenze; vengono mostrate solo le prime ${count}`,
  notes: (notes: readonly string[]) => `${notes.join('; ')}.`,
  sourceTime: (clock: string) => `Tempo del materiale ${clock}`,
};
