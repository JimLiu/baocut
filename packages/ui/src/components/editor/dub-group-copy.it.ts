import type { DubGroupMessages } from './dub-group-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: DubGroupMessages = {
  track: 'Mostra questa traccia nella timeline',
  trackGone: 'Questo gruppo di doppiaggio non è più nella timeline',
  regen: (n: number) => pluralForm('it', n, { one: `Rigenera ${n} frase…`, other: `Rigenera ${n} frasi…` }),
  regenNote: 'Frasi non sintetizzate o che non rientrano · rivedile, modifica la traduzione se necessario, poi rifai solo queste',
  download: 'Scarica gruppo',
  downloadNote: 'Non è ancora possibile scaricare gruppi interi; per ottenere il mix di questo gruppo, scegli «Solo questo gruppo di doppiaggio» durante l’esportazione audio',
  redub: 'Rifai questa lingua',
  redubNote: 'Apre Doppiaggio tradotto',
  remove: 'Rimuovi questo gruppo di doppiaggio',
  removeNote: 'Rimuove le clip di questo gruppo dalla timeline e ripristina l’audio originale; puoi annullare. La traccia di doppiaggio vuota e il piano vengono conservati',
  removeLoading: 'Caricamento del piano di doppiaggio…',
  readOnly: 'Il video è di sola lettura',
  removed: (title: string) => `Rimosso: «${title}»`,
  rowOnTimeline: (label: string) => `Riga «${label}» nella timeline`,
  undo: 'Annulla',
  stateOn: 'Nella timeline', stateOff: 'Traccia disattivata', stateGone: 'Non nella timeline',
  groupMenu: 'Questo gruppo di doppiaggio',
  actionsOf: (title: string) => `Azioni per «${title}»`,
  clickToSelect: (text: string) => `${text} · fai clic per selezionarlo nella timeline`,
};
