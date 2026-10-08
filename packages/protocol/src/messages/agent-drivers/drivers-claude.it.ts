import type { DriversClaudeMessages } from './drivers-claude.ts';

export const it: DriversClaudeMessages = {
  plan: 'Abbonamento Claude Pro o Max', installHint: 'Installa Claude Code',
  signedOut: 'Claude Code non ha effettuato l’accesso. Esegui claude in un terminale e segui le istruzioni per accedere.',
  subscriptionPro: 'Abbonamento Claude Pro', subscriptionMax: 'Abbonamento Claude Max', subscriptionTeam: 'Abbonamento Claude Team', subscriptionEnterprise: 'Abbonamento Claude Enterprise',
  providerAnthropicAws: 'Anthropic (AWS)', providerAnthropicGoogleCloud: 'Anthropic (Google Cloud)', enterpriseGateway: 'Gateway aziendale', claudeAccount: 'Account Claude',
  longLivedToken: 'Abbonamento Claude (token di lunga durata)', apiKey: 'Chiave API Anthropic', thirdPartyCloud: 'Cloud di terze parti',
  fromSettings: (p) => `Dalle impostazioni di Claude Code (env.${p.key})`,
  imageUnsupported: (p) => `Claude non supporta questo formato di immagine: ${p.mimeType} (supportati: JPEG, PNG, GIF, WebP)`,
  defaultModel: 'modello predefinito',
  switchModelFailed: (p) => `Claude non è riuscito a cambiare modello (${p.model}): ${p.error}`,
  autoUnsupported: (p) => `${p.model ? `Il modello ${p.model}` : 'Il modello attuale'} non supporta la modalità di permessi «auto» di Claude${p.reason ? ` (${p.reason})` : ''}. Questo turno viene eseguito come «chiedi ogni volta» e chiederà prima di agire.`,
  apiRetry: (p) => `Errore API Claude (${p.error}); tentativo ${p.attempt}/${p.max}`,
  turnFailed: (p) => `Il turno di Claude Code non è riuscito (${p.subtype})`,
  exitedPlanMode: (p) => `Claude Code è uscito dalla modalità di pianificazione con il piano approvato e inizierà ad apportare modifiche. Finché la modalità di accesso rimane «${p.plan}», queste modifiche verranno rifiutate. Per consentirgli di procedere, cambia la modalità di accesso in «${p.edit}» o un altro livello.`,
};
