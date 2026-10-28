import type { ProvidersAgentMessages } from './providers-agent.ts';

export const it: ProvidersAgentMessages = {
  codexUpgradeHint: 'Aggiorna Codex CLI (ad esempio, npm install -g @openai/codex@latest), poi verifica di nuovo',
  codexImageModel: 'Generazione di immagini Codex (modello scelto da Codex e dal tuo account)',
  codexImageNotes: 'Genera con l’account Codex connesso su questo computer: un PNG alla volta, un’attività alla volta, di solito in uno o due minuti. Dimensione e seed non possono essere impostati (le richieste che li includono vengono rifiutate) e la dimensione in pixel dipende dal risultato. Usa la quota del tuo abbonamento; la quota rimanente è sconosciuta. Attivarlo significa accettare l’invio dei prompt al tuo account Codex.',
  codexImageNotesApiKey:
    "Codex ha effettuato l’accesso con una chiave API o un altro metodo diverso da ChatGPT: la generazione di immagini potrebbe non funzionare e il costo va a quell’account, non a un abbonamento. BaoCut non lo sceglierà automaticamente; sceglilo tu per provare. Un PNG alla volta; dimensioni e seed non si possono impostare.",
  imagesOnly: (p) => `${p.label} può generare solo immagini`,
  onePngOnly: (p) => `${p.label} genera un PNG alla volta e non accetta dimensione o seed`,
  unavailable: (p) => `${p.label} non è disponibile: ${p.message}`,
  sessionNotStarted: (p) => `La sessione di ${p.label} non è iniziata: ${p.error}`,
  timedOut: (p) => `La generazione di ${p.label} non è terminata entro ${p.minutes} min ed è stata interrotta`,
  exited: (p) => `${p.label} è terminato inaspettatamente: ${p.message}`,
  notCompleted: (p) => `${p.label} non ha completato questa generazione: ${p.reason}`,
  turnInterrupted: 'il turno è stato interrotto',
  noImage: (p) => `${p.label} non ha generato un’immagine`,
  noImageReply: (p) => `${p.label} non ha generato un’immagine: ${p.reply}`,
  unknownError: 'Errore sconosciuto', processExited: 'Il processo è terminato',
  turnNotStarted: (p) => `Il turno non è iniziato: ${p.error}`,
  codexTextModel: "Generazione di testo Codex (modello scelto da Codex e dal tuo account)",
  codexTextNotes:
    "Scrive con l’account Codex connesso su questo computer: una richiesta alla volta, ognuna in una nuova sessione Codex, quindi è più lento di un’API. Impegno di ragionamento, temperatura, seed e lunghezza dell’output non si possono impostare. Usa la quota del tuo abbonamento; la quota rimanente è sconosciuta. Attivarlo significa accettare di inviare i prompt, compreso il testo delle trascrizioni che contengono, al tuo account Codex.",
  codexTextNotesApiKey:
    "Codex ha effettuato l’accesso con una chiave API o un altro metodo diverso da ChatGPT, quindi i costi vanno a quell’account, non a un abbonamento. Una richiesta alla volta; impegno di ragionamento, temperatura, seed e lunghezza dell’output non si possono impostare.",
};
