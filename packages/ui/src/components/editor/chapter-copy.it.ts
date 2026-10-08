import type { ChapterMessages } from './chapter-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ChapterMessages = {
  band: 'Capitoli', prev: 'Capitolo precedente', next: 'Capitolo successivo', noChapters: 'Nessun capitolo ancora presente',
  gap: 'Nessun capitolo', beforeFirst: 'Prima del primo capitolo', add: 'Aggiungi capitolo alla testina di riproduzione', rename: 'Rinomina…', remove: 'Elimina questo capitolo',
  menuLabel: (title: string) => `Capitolo «${title}»`, gapMenuLabel: 'Barra dei capitoli',
  segmentLabel: (title: string, range: string) => `${title}, ${range}, fai clic per andare all’inizio`,
  dragHint: 'Trascina per spostare l’inizio di questo capitolo', addTitle: 'Aggiungi capitolo', renameTitle: 'Rinomina capitolo', titleLabel: 'Titolo',
  addAt: (time: string) => `Inizia a ${time} e prosegue fino al capitolo successivo`, confirmAdd: 'Aggiungi', confirmRename: 'Rinomina', cancel: 'Annulla',
  refusal: { exists: 'C’è già un capitolo alla testina di riproduzione', beyond: 'La testina di riproduzione è alla fine; non puoi aggiungere un capitolo qui', blank: 'Il titolo non può essere vuoto' },
  labels: { add: 'Aggiungi capitolo', rename: 'Rinomina capitolo', remove: 'Elimina capitolo', move: 'Sposta inizio del capitolo' },
  added: (title: string) => `Capitolo aggiunto: «${title}»`, renamed: (title: string) => `Rinominato in «${title}»`, removed: (title: string) => `Capitolo eliminato: «${title}»`,
  undo: 'Annulla', clickRename: 'Fai clic per rinominare', jump: 'Vai all’inizio di questo capitolo',
  paragraphs: (n: number) => pluralForm('it', n, { one: `${n} paragrafo`, other: `${n} paragrafi` }),
  empty: 'Questo capitolo non ha ancora paragrafi',
};
