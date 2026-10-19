import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const it: VideoVersionsMessages = {
  title: 'Cronologia delle versioni',
  close: 'Chiudi cronologia delle versioni',
  tipLatest: (version: number) => `La più recente è la versione ${version}`,
  tipNone: 'Ancora nessuna versione',
  tipOutside: 'Questo video non è in un progetto',
  loading: 'Caricamento della cronologia delle versioni',
  loadFailed: (message: string) => `Impossibile caricare la cronologia delle versioni: ${message}`,
  stateSynced: 'Istantanea aggiornata',
  stateSyncedDesc: 'L’istantanea dello spazio di lavoro nella cartella del video corrisponde al contenuto attuale.',
  statePending: 'Scrittura dell’istantanea',
  statePendingDesc: 'Le modifiche recenti entrano nell’istantanea e nella cronologia delle versioni in pochi secondi.',
  stateConflict: 'Istantanea e BaoCut entrambi modificati',
  stateConflictDesc:
    'I file dell’istantanea sono stati modificati fuori da BaoCut, e anche BaoCut ha modifiche non ancora nell’istantanea. BaoCut non sovrascriverà l’istantanea finché non scegli cosa tenere.',
  stateInvalid: 'Istantanea illeggibile',
  stateInvalidDesc:
    'I file dell’istantanea non possono essere interpretati, quindi BaoCut non li ha importati. BaoCut ricontrolla dopo che li hai corretti, oppure puoi sovrascriverli con il contenuto di BaoCut.',
  stateExternal: 'Importazione delle modifiche esterne',
  stateExternalDesc:
    'I file dell’istantanea sono stati modificati fuori da BaoCut (git pull, un disco sincronizzato o una modifica manuale) e BaoCut non ha altre modifiche, quindi li sta importando come versione «Modifica esterna».',
  stateMissing: 'Ancora nessuna istantanea',
  stateMissingDesc: 'L’istantanea dello spazio di lavoro non è ancora stata scritta, oppure video.json non c’è più.',
  stateRebuild: 'Da ricostruire',
  stateRebuildDesc: 'C’è solo l’istantanea dello spazio di lavoro, senza la libreria del video. BaoCut ricostruisce il video da essa all’apertura.',
  footer: (keep: number) =>
    `Le versioni sono conservate in .bcut-snapshot/history/ nella cartella del video e non dipendono da git. BaoCut mantiene ${keep === 1 ? 'l’ultima versione senza nome' : `le ultime ${keep} versioni senza nome`}, più tutte le versioni salvate.`,
  save: 'Salva versione',
  saveIntro: 'Salva il contenuto attuale come versione con nome. Le versioni salvate non vengono mai rimosse automaticamente: solo tu puoi eliminarle.',
  nameLabel: 'Nome',
  namePlaceholder: 'Ad esempio: Montaggio da approvare',
  nameRequired: 'Dai un nome a questa versione',
  noteLabel: 'Nota (facoltativa)',
  cancel: 'Annulla',
  saveSubmit: 'Salva',
  conflictIntro:
    'Questi file dell’istantanea sono stati modificati fuori da BaoCut, forse da git pull, da un disco sincronizzato o da una modifica manuale, e anche BaoCut ha modifiche non ancora nell’istantanea:',
  conflictOutro:
    'Finché non scegli cosa tenere, BaoCut non sovrascrive l’istantanea. Puoi continuare a modificare il video, ma non puoi salvare versioni né tornare a una versione.',
  invalidIntro:
    'Questi file dell’istantanea non possono essere interpretati. Potrebbero contenere marcatori di conflitto di merge, essere troncati o essere stati danneggiati a mano:',
  invalidOutro:
    'BaoCut non li ha importati. Puoi continuare a modificare il video, ma non puoi salvare versioni né tornare a una versione. BaoCut ricontrolla dopo che hai corretto questi file, oppure puoi tenere il contenuto di BaoCut e sovrascriverli.',
  externalIntro: 'Questi file dell’istantanea sono stati modificati fuori da BaoCut, forse da git pull, da un disco sincronizzato o da una modifica manuale:',
  externalOutro: 'BaoCut non ha modifiche non ancora nell’istantanea, quindi li importa direttamente come versione «Modifica esterna». Potrai annullare l’importazione in seguito.',
  stripConflict: 'L’istantanea è stata modificata fuori da BaoCut, e anche BaoCut ha nuove modifiche. Scegli cosa tenere.',
  stripInvalid: 'I file dell’istantanea sono illeggibili. BaoCut non li ha importati.',
  view: 'Visualizza',
  keepVideo: 'Tieni il contenuto di BaoCut',
  useSnapshot: 'Usa l’istantanea su disco',
  keepTitle: 'Tenere il contenuto di BaoCut?',
  keepConfirm: 'Sovrascrivi l’istantanea su disco',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `Il contenuto di BaoCut viene scritto subito nell’istantanea, sovrascrivendo ${count === 1 ? `il file ${invalid ? 'illeggibile' : 'modificato'}` : `i ${count} file ${invalid ? 'illeggibili' : 'modificati'}`} su disco${files ? ` (${files})` : ''}. Quelle modifiche su disco non entrano nella cronologia delle versioni e non si possono recuperare in BaoCut; se venivano da git o da un disco sincronizzato, puoi recuperarle lì.`,
  diskTitle: 'Usare l’istantanea su disco?',
  diskConfirm: 'Usa l’istantanea su disco',
  diskBody: (files: string) =>
    `Il contenuto del video viene sostituito dall’istantanea su disco${files ? ` (${files})` : ''} e registrato come versione «Modifica esterna». Le modifiche in BaoCut non ancora nell’istantanea entrano prima nella cronologia delle versioni: torna a prima della versione «Modifica esterna» per recuperarle. Puoi anche annullare l’operazione.`,
  keptTitle: 'Contenuto di BaoCut mantenuto',
  keptText: (version: number | null) =>
    `L’istantanea su disco ora corrisponde a BaoCut${version ? `, e le tue modifiche recenti sono nella versione ${version}` : ''}. Le modifiche che erano su disco non sono entrate nella cronologia delle versioni.`,
  usedDiskTitle: (version: number) => `Usata l’istantanea su disco, registrata come versione ${version} «Modifica esterna»`,
  usedDiskText: (version: number) => `Torna a prima della versione ${version} per recuperare ciò che c’era in BaoCut. Puoi anche annullare l’operazione.`,
  importedTitle: (version: number | null) => (version ? `Modifiche esterne importate come versione ${version} «Modifica esterna»` : 'Modifiche esterne importate'),
  importedText:
    'I file dell’istantanea sono stati modificati fuori da BaoCut e BaoCut non aveva altre modifiche, quindi sono stati importati direttamente. Torna a prima di questa versione per vedere il contenuto precedente all’importazione, oppure annullala.',
  importUndoneTitle: 'Importazione annullata',
  importUndoneText:
    'Il video torna al contenuto precedente all’importazione e viene riscritto nell’istantanea in pochi secondi, scartando questa modifica esterna. Anche l’annullamento è una modifica e finisce in una nuova versione.',
  refusedBroken: 'Impossibile tornare a questa versione',
  refusedOther: 'Non eseguito',
  refusedText: (message: string) => `${message}. Il video non è cambiato.`,
  savedTitle: (version: number, name: string) => `Salvata come versione ${version} «${name}»`,
  savedText: 'Le versioni salvate restano: la regola di conservazione non le rimuove mai.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `Ritorno a prima della versione ${version}, registrato come versione ${recorded}`
      : `Ritorno alla versione ${version}, registrato come versione ${recorded}`,
  restoredText: 'È una modifica normale: puoi annullarla qui, oppure nell’editor dopo aver chiuso questa finestra.',
  undo: 'Annulla',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Annullato: torna a prima della versione ${version}` : `Annullato: torna alla versione ${version}`,
  undoneText: 'Il video torna al contenuto precedente. Anche l’annullamento è una modifica e finisce nella versione più recente.',
  noopTitle: 'Nessuna modifica',
  noopText: (version: number, before: boolean) =>
    before
      ? `Il video è già nello stato precedente all’inizio della versione ${version}. Non è stato applicato nulla e non è stata creata nessuna nuova versione.`
      : `Il video è già nello stato di fine della versione ${version}. Non è stato applicato nulla e non è stata creata nessuna nuova versione.`,
  deletedTitle: (name: string) => `Versione salvata «${name}» eliminata`,
  deletedText: 'Il contenuto del video non è cambiato.',
  emptyTitle: 'Ancora nessuna versione',
  emptyText: (missing: boolean): string =>
    missing
      ? 'L’istantanea dello spazio di lavoro non è ancora stata scritta. La tua prossima modifica diventerà la versione 1, oppure puoi salvare una versione ora.'
      : 'La tua prossima modifica diventerà la versione 1, oppure puoi salvare una versione ora.',
  outsideTitle: 'Questo video non è in un progetto',
  outsideText: 'Solo i video in un progetto hanno una cronologia delle versioni. Sposta prima il video in un progetto.',
  listLabel: 'Versioni',
  versionN: (version: number) => `Versione ${version}`,
  openBadge: 'Ancora aperta',
  blockedFlag: 'Impossibile tornare',
  unreadableTitle: 'Impossibile leggere questo file di versione',
  kindSegment: 'Modifiche',
  kindSave: 'Versione salvata',
  kindRestore: 'Ritorno a una versione',
  kindExternal: 'Modifica esterna',
  kindRebuild: 'Ricostruzione',
  revisions: (from: string, to: string) => (from === to ? `Revisione ${to}` : `Revisioni ${from}–${to}`),
  openHint: 'La versione più recente è ancora aperta: finché non passano 5 minuti senza modifiche o non arriva a 30 minuti, le tue prossime modifiche entrano in essa.',
  openHintPending: 'La versione più recente è ancora aperta. Le modifiche recenti sono in fase di scrittura e vi entreranno in pochi secondi.',
  openHintConflict: 'La versione più recente è ancora aperta, ma le nuove modifiche non entreranno nella cronologia delle versioni finché il conflitto dell’istantanea non sarà risolto.',
  openHintExternal:
    'La versione più recente è ancora aperta. L’istantanea su disco è in fase di importazione: prima si chiude questa versione, poi le modifiche esterne diventano una versione a sé.',
  externalHint:
    'Questa versione viene da fuori BaoCut: i file dell’istantanea sono stati modificati da git pull, da un disco sincronizzato o da una modifica manuale, e BaoCut li ha importati come questa versione. Torna a prima di questa versione per recuperare ciò che c’era in BaoCut prima dell’importazione.',
  restoreEnd: 'Torna a questa versione',
  restoreBefore: 'Torna a prima di questa versione',
  deleteSaved: 'Elimina questa versione salvata',
  whyNotFound: 'Questa versione non esiste più',
  whyUnreadable: (version: number) => `Il file della versione ${version} non è leggibile, quindi non si può tornare né a essa né agli stati precedenti`,
  whyBroken: (version: number) => `La cronologia delle versioni non corrisponde alla versione ${version}, quindi non si può tornare agli stati precedenti`,
  noopBoth: (version: number) => `Il video è già nello stato della versione ${version} (il contenuto è uguale prima e dopo), quindi tornarci non cambia nulla`,
  noopEnd: (version: number) => `Il video è già nello stato di fine della versione ${version}, quindi tornarci non cambia nulla`,
  noopBefore: (version: number) => `Il video è già nello stato precedente all’inizio della versione ${version}, quindi tornarci non cambia nulla`,
  factActors: 'Modificato da',
  factConversations: 'Sessioni',
  factFiles: 'Cosa è cambiato',
  factCheckpoint: 'Punto di controllo',
  actorYou: 'Tu',
  actorAgent: 'Agente',
  actorExternal: (name: string) => `Servizio esterno ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'Nessuna modifica registrata',
  noActionsRebuild: 'BaoCut ha ricostruito il video dalla sua istantanea; nessuna modifica al contenuto',
  omitted: (count: number) => (count === 1 ? 'Un’altra modifica è stata solo conteggiata' : `Altre ${count} modifiche sono state solo conteggiate`),
  notHere: '(non su questo computer)',
  openConversation: (title: string) => `Apri la sessione «${title}»`,
  fileTimeline: 'Timeline',
  fileDocument: 'Documento',
  changeAdd: 'Aggiunto',
  changeDelete: 'Eliminato',
  changeModify: 'Modificato',
  noFiles: 'Nessuna modifica al contenuto',
  diffTitle: 'Modifiche',
  copyDiff: 'Copia diff',
  copied: 'Copiato',
  copyFailed: 'Impossibile copiare. Seleziona il testo e copialo manualmente.',
  diffEmpty: 'Il diff di questa versione è vuoto: il contenuto è uguale a quello della fine della versione precedente.',
  diffLabel: (version: number) => `Diff della versione ${version}`,
  diffLoading: 'Caricamento del diff',
  diffFailed: (message: string) => `Impossibile leggere questa versione: ${message}`,
  diffMore: (count: number) =>
    count === 1
      ? 'Un’altra riga non è mostrata. Copia il diff per vederlo tutto.'
      : `Altre ${count} righe non sono mostrate. Copia il diff per vederlo tutto.`,
  unreadableHeading: (file: string) => `Impossibile leggere ${file}`,
  unreadableText: (why: string) =>
    `L’intestazione o il diff del file di versione è danneggiato; potrebbe essere stato troncato o modificato a mano. ${why}. Le versioni più recenti non sono interessate.`,
  confirmRestoreTitle: (version: number, before: boolean) =>
    before ? `Tornare a prima della versione ${version}?` : `Tornare alla versione ${version}?`,
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `Il contenuto del video sarà sostituito con il suo stato ${before ? `precedente all’inizio della versione ${version}` : `alla fine della versione ${version}`} (${when}). È una modifica annullabile, registrata come nuova versione. Le versioni esistenti restano, e i punti di controllo e le protezioni non cambiano.`,
  confirmDeleteTitle: (name: string) => `Eliminare la versione salvata «${name}»?`,
  confirmDeleteMiddle: (next: number) =>
    `Vengono eliminati solo questa versione e il suo punto di controllo: le sue modifiche confluiscono nella versione ${next}, quella successiva. Il contenuto del video non cambia.`,
  confirmDeleteTop: 'Vengono rimossi solo nome, nota e punto di controllo: questa versione diventa un normale gruppo di modifiche e le modifiche successive confluiscono in essa. Il contenuto del video non cambia.',
  delete: 'Elimina',
};
