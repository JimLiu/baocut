import type { DriversAcpMessages } from './drivers-acp.ts';

export const nl: DriversAcpMessages = {
  copilotPlan: "GitHub Copilot-abonnement",
  copilotLoginHint: "voer copilot login uit in een terminal om in te loggen (of voer /login in de interactieve modus van copilot in)",
  copilotInstallHint: "Installeer GitHub Copilot CLI (npm install -g @github/copilot)",
  geminiPlan: "Google-account",
  geminiLoginHint: "voer gemini uit in een terminal en kies inloggen met een Google-account, of zet GEMINI_API_KEY=… in ~/.gemini/.env",
  geminiInstallHint: "Installeer Gemini CLI (brew install gemini-cli)",
  cursorPlan: "Cursor-abonnement",
  cursorInstallHint: "Installeer Cursor Agent met het officiële script",
  grokPlan: "xAI-account",
  grokInstallHint: "Installeer Grok CLI met het officiële script",
  kimiPlan: "Kimi-account",
  kimiInstallHint: "Installeer Kimi Code volgens de officiële instructies (https://github.com/MoonshotAI/kimi-code)",
  customNoCommand: (p: { id: string }) => `Agent ${p.id} heeft geen opdracht`,
  customInstallHint: (p: { command: string }) => `Controleer of ${p.command} is geïnstalleerd en in PATH staat, of voeg het opnieuw toe met een absoluut pad`,

  loginViaTerminal: (p: { command: string }) => `voer ${p.command} uit in een terminal om in te loggen`,
  loginPerInstructions: "volg de instructies om in te loggen",

  signedOut: (p: { name: string; login: string; detail: string }) =>
    `${p.name} is niet ingelogd: ${p.login}.${p.detail ? ` (${p.detail})` : ""}`,
  probeTimeout: (p: { name: string; seconds: number }) => `${p.name} heeft niet geantwoord binnen ${p.seconds} seconden`,
  acpModeFailed: (p: { name: string; error: string }) => `${p.name} kan niet in ACP-modus starten: ${p.error}`,
  exitCode: (p: { code: string }) => `afsluitcode ${p.code}`,

  exited: (p: { name: string; status: string; tail: string }) => `${p.name} is afgesloten (${p.status})${p.tail ? `: ${p.tail}` : ""}`,
  exitedBeforeInit: (p: { name: string }) => `${p.name} is afgesloten voor het initialiseren`,
  initTimeout: (p: { name: string }) => `${p.name} heeft de ACP-initialisatie niet op tijd voltooid`,
  mcpHttpUnsupported: (p: { name: string }) =>
    `${p.name} kan geen verbinding maken met MCP-servers via HTTP, dus de tools van BaoCut (projecten en ondertitels lezen en bewerken enzovoort) zijn niet beschikbaar in deze sessie.`,
  resumeUnsupported: (p: { name: string }) => `${p.name} ondersteunt het hervatten van sessies niet`,
  onlyAlwaysAllow: (p: { name: string }) =>
    `${p.name} bood deze keer alleen ‘Altijd toestaan’ aan. BaoCut schrijft dat niet voor je in de instellingen, dus het verzoek is geweigerd.`,
  modeSwitchFailed: (p: { name: string; mode: string; error: string }) => `${p.name} kan de sessiemodus niet wijzigen (${p.mode}): ${p.error}`,
  noAllowAllSwitch: (p: { name: string; configId: string }) =>
    `Deze sessie met ${p.name} heeft geen schakelaar ‘Alles toestaan’ (${p.configId}), dus ook bij Volledige toegang wordt nog steeds voor elke actie toestemming gevraagd.`,
  setOptionFailed: (p: { name: string; configId: string; value: string; error: string }) =>
    `${p.name} kan niet instellen: ${p.configId}=${p.value}: ${p.error}`,
  stillAskThisTurn: (p: { failure: string }) => `${p.failure}. In deze beurt wordt nog steeds voor elke actie toestemming gevraagd.`,
  noMatchingMode: (p: { name: string }) =>
    `${p.name} heeft geen sessiemodus voor deze toegangsmodus en gebruikt daarom de eigen standaard. BaoCut controleert acties waarvoor goedkeuring nodig is nog steeds aan de hand van de toegangsmodus.`,
  modelSwitchUnsupported: (p: { name: string }) => `${p.name} kan binnen een sessie niet van model wisselen en blijft daarom het huidige model gebruiken.`,
};
