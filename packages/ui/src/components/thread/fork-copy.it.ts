import type { ForkMessages } from './fork-copy.ts';

export const it: ForkMessages = {
  button: 'Dirama da questo turno',
  fork: 'Continua in una nuova sessione',
  forkHint: 'Porta la conversazione fino a questo turno',
  restore: 'Continua con i video ripristinati a quel momento…',
  restoreOne: (name) => `«${name}» torna alla fine di questo turno`,
  restoreMany: (n) => `${n} video tornano alla fine di questo turno`,
  restoreNone: 'Le versioni di quel momento non ci sono più o non si possono leggere',
  checking: 'Controllo della cronologia delle versioni…',
  dialogTitle: 'Dirama e ripristina i video',
  dialogLead:
    'La nuova sessione porta la conversazione fino a questo turno. I video qui sotto tornano alla fine di questo turno. Ogni ripristino viene salvato come nuova versione, quindi puoi tornare indietro dalla cronologia delle versioni.',
  listLabel: 'Video da ripristinare',
  cancel: 'Annulla',
  confirm: 'Dirama e ripristina',
  ok: (version, undone) =>
    `Ripristina la versione ${version}. Le ${undone} versioni successive (modifiche tue e di altre sessioni) vengono annullate`,
  pruned: 'La versione di quel momento non c’è più (la cronologia delle versioni conserva solo le recenti e quelle salvate)',
  createdAfter: 'Questo video è stato creato dopo questo turno, quindi resta com’è',
  chainBroken: 'La cronologia delle versioni non si può leggere fino a quel momento',
  done: 'Diramata in una nuova sessione',
  doneRestored: (n) =>
    `Diramata in una nuova sessione e ${n} video ripristinati a quel momento. Puoi tornare indietro dalla cronologia delle versioni`,
  failed: (error) => `Impossibile diramare: ${error}`,
  forkedFrom: (title, turn) => `Diramata da «${title}» · fino al turno ${turn}`,
  sourceDeleted: '(sessione originale eliminata)',
  history: (turns, omitted) => `Cronologia inclusa · ${turns} turni${omitted ? ` (${omitted} precedenti omessi)` : ''}`,
  hideHistory: 'Nascondi cronologia',
};
