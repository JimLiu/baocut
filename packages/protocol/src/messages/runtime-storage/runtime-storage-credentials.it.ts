import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const it: RuntimeStorageCredentialsMessages = {
  denied: "Accesso negato",
  unavailable: "L’archivio delle credenziali non è disponibile",
  unsupported: "Questa piattaforma non supporta l’archivio sicuro del sistema",
  internal: "Errore nella lettura o scrittura della credenziale",
  problem: (p) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p) => `Impossibile scrivere il file delle credenziali (${p.code})`,
  helperBadResponse: "L’assistente per le credenziali ha restituito una risposta non valida",
  helperNotFound: "Il programma di assistenza per le credenziali non è stato trovato",
  helperTimedOut: (p) => `L’assistente per le credenziali non ha risposto entro ${p.seconds} secondi`,
  helperMissing: "Il programma di assistenza per le credenziali manca",
  helperStartFailed: (p) => `Impossibile avviare l’assistente per le credenziali (${p.code})`,
  helperResponseTooLong: "La risposta dell’assistente per le credenziali è troppo lunga",
  helperExitedSilently: "L’assistente per le credenziali è terminato senza rispondere",
  helperReportedError: "L’assistente per le credenziali ha segnalato un errore",
  redacted: "[omesso]",
};
