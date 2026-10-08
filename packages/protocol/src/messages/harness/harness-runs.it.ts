import type { HarnessRunsMessages } from './harness-runs.ts';

export const it: HarnessRunsMessages = {
  retrying: (p) => `${p.message} (nuovo tentativo in corso)`,
  modeChanged: (p) => `Modalità di accesso cambiata in «${p.to}» (era «${p.from}»). Si applica alle azioni successive.`,
  jobsCancelled: (p) => `Richiesto l’annullamento delle attività in background non completate di questa sessione (${p.count}). I risultati completati vengono conservati.`,
  jobsCancelledGenerated: (p) => `Richiesto l’annullamento delle attività in background non completate di questa sessione (${p.count}, generazione o trascrizione). I risultati completati vengono conservati.`,
  goalChangedStopped: "Obiettivo cambiato: l’attività precedente è stata interrotta. Avvio di una nuova attività per il nuovo obiettivo.",
  goalChangedKept: "Obiettivo cambiato: il turno dell’attività precedente è stato interrotto. Le attività in background già inviate terminano normalmente e i risultati rimangono come candidati. Avvio di una nuova attività per il nuovo obiettivo.",
  stopReplyUnconfirmed: (p) => `È stato richiesto di smettere di rispondere, ma non è stato possibile confermare se ${p.agent} si è fermato.`,
  stopUnconfirmed: (p) => `È stato richiesto di fermarsi, ma non è stato possibile confermare se ${p.agent} si è fermato.`,
  stopTimedOut: (p) => `${p.agent} non ha confermato l’interruzione entro 10 secondi, quindi il suo processo è stato terminato. I passaggi di cui non è stato confermato l’annullamento potrebbero già aver avuto effetto.`,
  agentRemovedNotice: (p) => `L’agente ${p.agent} è stato rimosso, quindi questa attività non è stata completata. Le modifiche già effettuate non vengono annullate automaticamente.`,
  agentRemoved: (p) => `L’agente ${p.agent} è stato rimosso`,
  runtimeStoppedNotice: "L’attività era ancora in corso quando il Runtime si è interrotto, quindi è stata interrotta.",
  runtimeExitedNotice: "Il Runtime è terminato durante l’esecuzione dell’attività, quindi questa non è stata completata. Le modifiche già effettuate non vengono annullate automaticamente.",
  runtimeExited: "Il Runtime è terminato durante l’esecuzione dell’attività",
  turnFailed: "Il turno non è riuscito",
  processExited: (p) => `${p.agent} ha avuto il processo terminato inaspettatamente: ${p.error}`,
  noErrorMessage: "nessun messaggio di errore",
  fileChangeSummary: "Modifica file",
};
