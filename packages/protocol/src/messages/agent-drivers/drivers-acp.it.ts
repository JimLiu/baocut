import type { DriversAcpMessages } from './drivers-acp.ts';

export const it: DriversAcpMessages = {
  copilotPlan: 'Abbonamento GitHub Copilot',
  copilotLoginHint: 'esegui copilot login in un terminale per accedere (o inserisci /login nella modalità interattiva di copilot)',
  copilotInstallHint: 'Installa GitHub Copilot CLI (npm install -g @github/copilot)', geminiPlan: 'Account Google',
  geminiLoginHint: 'esegui gemini in un terminale e scegli l’accesso con un account Google, oppure inserisci GEMINI_API_KEY=… in ~/.gemini/.env', geminiInstallHint: 'Installa Gemini CLI (brew install gemini-cli)',
  cursorPlan: 'Abbonamento Cursor', cursorInstallHint: 'Installa Cursor Agent con lo script ufficiale', grokPlan: 'Account xAI', grokInstallHint: 'Installa Grok CLI con lo script ufficiale', kimiPlan: 'Account Kimi', kimiInstallHint: 'Installa Kimi Code seguendo le istruzioni ufficiali (https://github.com/MoonshotAI/kimi-code)',
  customNoCommand: (p) => `L’agente ${p.id} non ha un comando`,
  customInstallHint: (p) => `Verifica che il comando ${p.command} sia installato e presente su PATH, oppure aggiungilo di nuovo con un percorso assoluto`,
  loginViaTerminal: (p) => `esegui ${p.command} in un terminale per accedere`, loginPerInstructions: 'segui le sue istruzioni per accedere',
  signedOut: (p) => `${p.name} non ha effettuato l’accesso: ${p.login}.${p.detail ? ` (${p.detail})` : ''}`,
  probeTimeout: (p) => `${p.name} non ha risposto entro ${p.seconds} s`, acpModeFailed: (p) => `${p.name} non è riuscito ad avviarsi in modalità ACP: ${p.error}`, exitCode: (p) => `codice di uscita ${p.code}`,
  exited: (p) => `${p.name} è terminato (${p.status})${p.tail ? `: ${p.tail}` : ''}`, exitedBeforeInit: (p) => `${p.name} è terminato prima dell’inizializzazione`, initTimeout: (p) => `${p.name} non ha completato l’inizializzazione ACP in tempo`,
  mcpHttpUnsupported: (p) => `${p.name} non può connettersi ai server MCP tramite HTTP, quindi gli strumenti di BaoCut (lettura e modifica di progetti, sottotitoli ecc.) non sono disponibili in questa sessione.`,
  resumeUnsupported: (p) => `${p.name} non supporta la ripresa delle sessioni`,
  onlyAlwaysAllow: (p) => `${p.name} ha offerto solo «Consenti sempre» questa volta. BaoCut non lo scriverà nelle impostazioni per te, quindi la richiesta è stata rifiutata.`,
  modeSwitchFailed: (p) => `${p.name} non è riuscito a cambiare la modalità della sessione (${p.mode}): ${p.error}`,
  noAllowAllSwitch: (p) => `Questa sessione di ${p.name} non ha un interruttore «consenti tutto» (${p.configId}), quindi chiederà ancora prima di ogni azione in Accesso completo.`,
  setOptionFailed: (p) => `${p.name} non è riuscito a impostare ${p.configId}=${p.value}: ${p.error}`,
  stillAskThisTurn: (p) => `${p.failure}. Chiederà ancora prima di ogni azione in questo turno.`,
  noMatchingMode: (p) => `${p.name} non ha una modalità di sessione corrispondente a questa modalità di accesso, quindi usa la propria modalità predefinita. BaoCut continua a verificare le azioni che richiedono approvazione in base alla modalità di accesso.`,
  modelSwitchUnsupported: (p) => `${p.name} non può cambiare modello durante una sessione, quindi continua a usare quello attuale.`,
};
