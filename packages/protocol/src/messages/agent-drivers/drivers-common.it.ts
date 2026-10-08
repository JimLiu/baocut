import type { DriversCommonMessages } from './drivers-common.ts';

export const it: DriversCommonMessages = {
  executableMissing: (p) => `Il comando specificato ${p.command} (${p.path}) non esiste o non può essere eseguito.`,
  commandMissing: (p) => `Impossibile trovare il comando ${p.command}. ${p.hint}, oppure imposta la sua posizione nelle Impostazioni.`,
  commandNotFound: (p) => `Impossibile trovare il comando ${p.command}`,
  installItFirst: "Installalo prima",
  versionFailed: (p) => `${p.command} --version non è terminato normalmente.`,
  outdated: (p) => `${p.name} ${p.version} è troppo vecchio. BaoCut richiede ${p.min} o successivo.`,
  startFailed: (p) => `${p.name} non è riuscito ad avviarsi: ${p.error}`,
  openSessionFailed: (p) => `${p.name} non è riuscito ad aprire una sessione: ${p.error}`,
  confinedUnsupported: (p) => `${p.name} non supporta chiamate singole con restrizioni`,
  resumeFailed: (p) => `Impossibile riprendere la sessione nativa di ${p.name}${p.error ? ` (${p.error})` : ""}. È stata avviata una nuova sessione; l’agente non può vedere la conversazione precedente.`,
  sessionClosed: (p) => `${p.name} ha la sessione chiusa`,
  sessionNotReady: (p) => `${p.name} non ha ancora una sessione pronta`,
  turnInProgress: "Il turno precedente non è ancora terminato",
  modelSwitchFailed: (p) => `${p.name} non è riuscito a passare al modello ${p.model}: ${p.error}`,
  timedOut: (p) => `${p.label} è scaduto (${p.seconds} s)`,
  unknownError: "Errore sconosciuto",
  unknownReason: "motivo sconosciuto",
  imagePlaceholder: "[Immagine]",
  officialScript: "Script ufficiale",
};
