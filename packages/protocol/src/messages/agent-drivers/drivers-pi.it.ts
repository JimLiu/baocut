import type { DriversPiMessages } from './drivers-pi.ts';

export const it: DriversPiMessages = {
  plan: 'Account dei modelli in Pi', installHint: 'Installa Pi con npm (npm install -g @earendil-works/pi-coding-agent, richiede Node.js)',
  signedOut: 'Pi non ha effettuato l’accesso. Esegui pi in un terminale e inserisci /login oppure imposta una chiave API per un provider di modelli (ad esempio ANTHROPIC_API_KEY).',
  rpcFailed: (p) => `La modalità RPC di Pi non è riuscita ad avviarsi: ${p.error}`, processStartFailed: (p) => `Il processo Pi non è riuscito ad avviarsi: ${p.error}`,
  processExited: (p) => `Il processo Pi è terminato (code ${p.code}, signal ${p.signal})${p.tail ? `: ${p.tail}` : ''}`,
  processClosed: 'Il processo Pi è chiuso', requestTimeout: (p) => `Pi non ha risposto a ${p.command} entro ${p.ms} ms`, stdinUnwritable: 'stdin di Pi non è scrivibile', commandFailed: (p) => `Il comando ${p.command} di Pi non è riuscito`,
  toolFallback: 'Strumento', sessionFileMissing: 'file di sessione non trovato', withStderr: (p) => `${p.error} (${p.tail})`,
  mcpNameInvalid: (p) => `Il nome del server MCP ${p.name} contiene caratteri che Pi non accetta (solo lettere, cifre, _ e -), quindi non può essere usato in questa sessione.`,
  modelFormat: (p) => `I modelli Pi devono essere scritti come provider/id: ${p.model}`,
  switchModelFailed: (p) => `Pi non è riuscito a passare al modello ${p.model}: ${p.error}`,
  effortUnsupported: (p) => `Pi non ha il livello di intensità di ragionamento «${p.level}», quindi questo turno usa l’impostazione attuale.`,
  effortFailed: (p) => `Pi non è riuscito a impostare l’intensità di ragionamento (${p.error}), quindi questo turno usa l’impostazione attuale.`,
  mcpConnectFailed: (p) => `Pi non è riuscito a connettersi al server MCP di BaoCut, quindi gli strumenti di BaoCut (lettura e scrittura di progetti, sottotitoli ecc.) non sono disponibili in questa sessione: ${p.error}`,
  extensionError: (p) => `Un’estensione Pi non è riuscita: ${p.error}`, modelCallFailed: 'La chiamata al modello di Pi non è riuscita', notice: (p) => `Pi: ${p.message}`,
  extensionAsked: (p) => `Un’estensione Pi voleva chiederti qualcosa${p.title ? ` («${p.title}»)` : ''}. BaoCut non può ancora inoltrare questo tipo di domanda, quindi è stata annullata per te.`,
  fullAccessOnly: (p) => `Pi non ha modo di chiedere prima di ogni azione, quindi BaoCut può eseguirlo solo in modalità «${p.mode}»: non chiederà prima di eseguire comandi o modificare file.`,
};
