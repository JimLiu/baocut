import { pluralForm } from '@baocut/protocol';
import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const it: LegacyImportMessages = {
  title: 'Importare i progetti di una versione precedente?',
  lead: (n) =>
    pluralForm('it', n, {
      one: `Su questo computer c’è ${n} progetto di una versione precedente di BaoCut. Importalo per continuare a modificarlo in questa versione. I file originali restano dove sono, senza modifiche.`,
      other: `Su questo computer ci sono ${n} progetti di una versione precedente di BaoCut. Importali per continuare a modificarli in questa versione. I file originali restano dove sono, senza modifiche.`,
    }),
  found: 'Progetti trovati',
  destination: 'Importa in',
  resetDefault: 'Usa posizione predefinita',
  change: 'Cambia…',
  pickTitle: 'Scegli dove importare',
  destinationNote: 'Questa cartella compare come progetto in Home e ogni progetto precedente diventa un video al suo interno.',
  hint: 'Se salti, te lo chiederemo di nuovo al prossimo avvio di BaoCut. Seleziona «Non ricordarmelo più» per non importarli mai.',
  never: 'Non ricordarmelo più',
  skip: 'Salta',
  import: 'Importa',
  importing: (n) =>
    pluralForm('it', n, {
      one: `Importazione di ${n} progetto precedente in background`,
      other: `Importazione di ${n} progetti precedenti in background`,
    }),
  neverDone: 'Non ti ricorderemo più di importare i progetti precedenti. I file originali restano come sono.',
  skipped: 'Saltato. Te lo chiederemo di nuovo al prossimo avvio di BaoCut.',
  failed: (message) => `Impossibile importare: ${message}`,
};
