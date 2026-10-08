import type { DriversOpencodeMessages } from './drivers-opencode.ts';

export const it: DriversOpencodeMessages = {
  plan: 'Account dei modelli in OpenCode', installHint: 'Installa 2.x con npm install -g @opencode/cli',
  unsupportedMajor: (p) => `OpenCode ${p.version} è una versione principale che BaoCut non supporta ancora. È supportata solo 2.x.`,
  tooOld: (p) => `OpenCode ${p.version} è troppo vecchio. Aggiornalo: BaoCut richiede ${p.min} o una 2.x successiva (${p.command}).`,
  unsupportedVersion: (p) => `OpenCode ${p.version} non è supportato. Richiede ${p.min} o una 2.x successiva`, versionUnknown: 'versione sconosciuta',
  noModelAccount: (p) => `Nessun account di modello è ancora connesso in OpenCode, quindi sono disponibili solo i modelli gratuiti di OpenCode Zen. Esegui ${p.command} in un terminale per connetterne uno.`,
  probeFailed: (p) => `OpenCode serve non è riuscito ad avviarsi o a leggere l’elenco dei modelli: ${p.error}`, externalDirectory: 'Accedi a una posizione fuori dalla cartella di lavoro',
  directoryNotReady: (p) => `OpenCode non ha preparato la cartella ${p.directory} entro ${p.seconds} s`,
  httpFailed: (p) => `L’operazione ${p.operation} di OpenCode non è riuscita (HTTP ${p.status}${p.tag ? ` ${p.tag}` : ''})${p.detail ? `: ${p.detail}` : ''}`,
  htmlResponse: 'Ricevuta una pagina web invece dell’API v2 (versione incompatibile?)', processExited: 'Il processo OpenCode è terminato', killedBySignal: (p) => `Terminato dal segnale ${p.signal}`, exitCode: (p) => `Codice di uscita ${p.code}`,
  serveNotReady: (p) => `opencode serve non era pronto entro ${p.seconds} s`, serveExitedAtStart: (p) => `opencode serve è terminato durante l’avvio (${p.reason})`, serveExited: 'opencode serve è terminato',
  streamConnectFailed: (p) => `Impossibile connettersi al flusso di eventi (HTTP ${p.status})`, streamEnded: 'Il flusso di eventi è terminato', streamNotConnected: (p) => `Il flusso di eventi non si è connesso (${p.seconds} s)`, streamLost: (p) => `Flusso di eventi disconnesso: ${p.error}`,
  mcpFailed: (p) => `${p.name} non è riuscito a connettersi al server MCP ${p.server} (${p.error}). Gli strumenti di BaoCut non sono disponibili in questa sessione.`,
  mcpTimeout: (p) => `${p.name} non si è connesso ai server MCP (${p.servers}) in tempo. Gli strumenti di BaoCut potrebbero non essere disponibili in questa sessione.`,
  promptRejected: (p) => `${p.name} non ha accettato questo messaggio: ${p.error}`, setModeFailed: (p) => `${p.name} non è riuscito a impostare la modalità di accesso: ${p.error}`, retryFallback: 'La richiesta al modello non è riuscita. Nuovo tentativo a breve.',
  runFailed: (p) => `L’esecuzione di ${p.name} non è riuscita`,
  endedAfterRejection: (p) => `${p.name} ha concluso questo turno dopo il rifiuto di uno strumento. Invia un altro messaggio se vuoi provare un approccio diverso.`,
  interruptedTurn: (p) => `${p.name} ha interrotto questo turno (${p.reason}).`, modelFormat: (p) => `I modelli di ${p.name} devono essere scritti come provider/model (ricevuto ${p.id})`,
};
