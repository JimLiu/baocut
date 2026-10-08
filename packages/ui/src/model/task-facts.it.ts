import type { TaskFactsMessages } from './task-facts.ts';
import { pluralForm } from '@baocut/protocol';

export const it: TaskFactsMessages = {
  fact: { kind: 'Tipo', submitter: 'Avviato da', status: 'Stato', startedAt: 'Avviato', runsOn: 'Eseguito su', language: 'Lingua', phase: 'Fase', images: 'Immagini', took: 'Tempo impiegato', cost: 'Costo' },
  imageCount: (count: number) => pluralForm('it', count, { one: `${count} immagine`, other: `${count} immagini` }),
};
