import type { DriversAcpMessages } from './drivers-acp.ts';

export const de: DriversAcpMessages = {
  copilotPlan: "GitHub Copilot-Abonnement",
  copilotLoginHint: "zum Anmelden copilot login im Terminal ausführen (oder /login im interaktiven Modus von copilot eingeben)",
  copilotInstallHint: "GitHub Copilot CLI installieren (npm install -g @github/copilot)",
  geminiPlan: "Google-Konto",
  geminiLoginHint: "gemini im Terminal ausführen und Anmeldung mit einem Google-Konto auswählen oder GEMINI_API_KEY=… in ~/.gemini/.env eintragen",
  geminiInstallHint: "Gemini CLI installieren (brew install gemini-cli)",
  cursorPlan: "Cursor-Abonnement",
  cursorInstallHint: "Cursor Agent mit dem offiziellen Skript installieren",
  grokPlan: "xAI-Konto",
  grokInstallHint: "Grok CLI mit dem offiziellen Skript installieren",
  kimiPlan: "Kimi-Konto",
  kimiInstallHint: "Kimi Code nach der offiziellen Anleitung installieren (https://github.com/MoonshotAI/kimi-code)",
  customNoCommand: (p: { id: string }) => `Agent ${p.id} hat keinen Befehl`,
  customInstallHint: (p: { command: string }) => `Prüfen, ob ${p.command} installiert und in PATH ist, oder erneut mit einem absoluten Pfad hinzufügen`,

  loginViaTerminal: (p: { command: string }) => `Ausführen: ${p.command} im Terminal, um sich anzumelden`,
  loginPerInstructions: "den Anweisungen zur Anmeldung folgen",

  signedOut: (p: { name: string; login: string; detail: string }) =>
    `${p.name} ist nicht angemeldet: ${p.login}.${p.detail ? ` (${p.detail})` : ""}`,
  probeTimeout: (p: { name: string; seconds: number }) => `${p.name} hat nicht innerhalb der Zeitgrenze geantwortet: ${p.seconds} Sekunden`,
  acpModeFailed: (p: { name: string; error: string }) => `${p.name} konnte nicht im ACP-Modus starten: ${p.error}`,
  exitCode: (p: { code: string }) => `Exit-Code ${p.code}`,

  exited: (p: { name: string; status: string; tail: string }) => `${p.name} wurde beendet (${p.status})${p.tail ? `: ${p.tail}` : ""}`,
  exitedBeforeInit: (p: { name: string }) => `${p.name} wurde vor der Initialisierung beendet`,
  initTimeout: (p: { name: string }) => `${p.name} hat die ACP-Initialisierung nicht rechtzeitig abgeschlossen`,
  mcpHttpUnsupported: (p: { name: string }) =>
    `${p.name} kann keine MCP-Server über HTTP verbinden. Die Werkzeuge von BaoCut (Projekte und Untertitel lesen und bearbeiten usw.) sind in dieser Sitzung daher nicht verfügbar.`,
  resumeUnsupported: (p: { name: string }) => `${p.name} unterstützt keine Wiederaufnahme von Sitzungen`,
  onlyAlwaysAllow: (p: { name: string }) =>
    `${p.name} hat diesmal nur „Immer erlauben“ angeboten. BaoCut übernimmt dies nicht in Ihre Einstellungen; die Anfrage wurde daher abgelehnt.`,
  modeSwitchFailed: (p: { name: string; mode: string; error: string }) => `${p.name} konnte den Sitzungsmodus nicht wechseln (${p.mode}): ${p.error}`,
  noAllowAllSwitch: (p: { name: string; configId: string }) =>
    `Diese Sitzung mit ${p.name} hat keinen Schalter „Alles erlauben“ (${p.configId}); im Modus Vollzugriff wird daher weiterhin jede Aktion einzeln angefragt.`,
  setOptionFailed: (p: { name: string; configId: string; value: string; error: string }) =>
    `${p.name} konnte nicht festlegen: ${p.configId}=${p.value}: ${p.error}`,
  stillAskThisTurn: (p: { failure: string }) => `${p.failure}. In dieser Runde wird weiterhin jede Aktion einzeln angefragt.`,
  noMatchingMode: (p: { name: string }) =>
    `${p.name} hat keinen Sitzungsmodus für diesen Zugriffsmodus und läuft daher mit dem eigenen Standard. BaoCut prüft genehmigungspflichtige Aktionen weiterhin anhand des Zugriffsmodus.`,
  modelSwitchUnsupported: (p: { name: string }) => `${p.name} kann innerhalb einer Sitzung keine Modelle wechseln und verwendet daher weiterhin das aktuelle Modell.`,
};
