import type { McpMessages } from './mcp-copy.ts';



export const de: McpMessages = {
  previousClientUnknown: "Der Client des ersetzten Eintrags ließ sich nicht ermitteln, daher wurde keiner widerrufen: baocut mcp status listet vorhandene Clients auf; widerrufen Sie nicht mehr verwendete Clients mit baocut services mcp revoke <clientId>",
  defaultProjectRegistered: (name: string, path: string) => `BaoCut hatte keine Projekte: Standardprojekt „${name}“ (${path}) registriert, in dem externe Agenten Videos erstellen können`,


  help: `Verwendung:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <client name>] [--yes]
                                   Externen Agenten mit dem MCP-Dienst von BaoCut verbinden: Dienst starten (und mit der Runtime
                                   starten lassen), neuen Client und Token für den Agenten erstellen und Adresse und Token in dessen
                                   MCP-Konfiguration schreiben (Eintragsname baocut); anschließend den Agenten neu starten
                                   Hat BaoCut keine Projekte, wird das CLI-Projekt im Standardprojektordner für externe Agenten registriert
    --level ask|auto               Zugriffsstufe: ask lässt Sie jede Änderung und Aufgabe in BaoCut bestätigen (Standard des Dienstes);
                                   auto führt sie direkt aus. Ohne Angabe bleibt die aktuelle Stufe erhalten
    --name <client name>           In BaoCut angezeigter Clientname (standardmäßig der Agentname); der Client lässt sich einzeln widerrufen
    --yes                          Vorhandenen baocut-Eintrag in der Agent-Konfiguration ersetzen und dessen Client widerrufen
                                   (anhand des alten Tokens erkannt; falls nicht erkennbar, werden gleichnamige Clients aufgelistet,
                                   damit Sie entscheiden können). Ohne diese Option wird nichts überschrieben und kein Client erstellt
  Speicherort des Tokens: Claude Code speichert es in env (BAOCUT_MCP_TOKEN) in ~/.claude/settings.json; die Konfiguration verweist nur darauf.
  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) und Gemini CLI (~/.gemini/settings.json) bieten keinen Ort für
  Umgebungsvariablen, daher steht das Token im Klartext in ihrer Konfigurationsdatei: Committen oder teilen Sie diese Dateien nicht und
  bevorzugen Sie ask; falls ein Token offengelegt wird, widerrufen Sie es mit baocut services mcp revoke <clientId>.
  Der Dienst ist nur verfügbar, solange die BaoCut-Runtime läuft (BaoCut öffnen oder baocut runtime ensure ausführen).
  baocut mcp status                Status, Adresse, Stufe und Clients des MCP-Dienstes sowie Vorhandensein eines baocut-Eintrags
                                   in der Konfiguration der einzelnen Agenten (ohne Tokens)`,
  entryExists: (file: string, entry: string) => `${file} hat bereits einen ${entry}-Eintrag; nichts wurde geändert. Fügen Sie --yes hinzu, um ihn zu ersetzen`,
  serviceNotAvailable: "Diese BaoCut-Version bietet den MCP-Dienst nicht an",
  serviceStartFailed: (reason: string | null) => `Der MCP-Dienst wurde nicht gestartet: ${reason ?? "unbekannter Grund"}`,
  connected: (host: string, url: string) => `Verbunden: ${host} mit dem MCP-Dienst von BaoCut: ${url}`,
  configEnv: (configFile: string, envFile: string, envVar: string) =>
    `Konfiguration: ${configFile} (das Token liegt in env.${envVar} von ${envFile}; die Konfiguration verweist nur darauf)`,
  configPlaintext: (configFile: string, clientId: string) =>
    `Konfiguration: ${configFile} (das Token steht im Klartext in dieser Datei: Geben Sie sie nicht weiter und committen Sie sie nicht; falls es offengelegt wird, widerrufen Sie es mit baocut services mcp revoke ${clientId})`,
  clientLine: (name: string, clientId: string, level: string | null) => `Client: ${name} (${clientId})  Stufe: ${level ?? "—"}`,
  restartHint: (host: string) =>
    `Starten Sie ${host} neu, damit dies wirksam wird. Der Dienst läuft mit der Runtime von BaoCut: Falls die Runtime nicht läuft, öffnen Sie zuerst BaoCut oder führen Sie baocut runtime ensure aus`,
  replacedRevoked: (name: string, clientId: string) => `Der alte Eintrag wurde ersetzt und sein Client widerrufen: ${name} (${clientId})`,
  replacedRevokeFailed: (reason: string) => `Der alte Eintrag wurde ersetzt, aber sein Client ließ sich nicht widerrufen: ${reason}`,
  oldClientRemains: (ids: readonly string[]) =>
    `Der alte Client besteht weiterhin: ${ids.join(", ")}. Falls er nicht mehr verwendet wird: baocut services mcp revoke <clientId>`,

  sameNameClientsRemain: (ids: readonly string[], unrecognized: boolean) =>
    `${unrecognized ? "Der Client des alten Eintrags ließ sich nicht ermitteln; Clients" : "Clients"} mit demselben Namen bestehen weiterhin: ${ids.join(", ")}. Falls sie nicht mehr verwendet werden: baocut services mcp revoke <clientId>`,
  hostsHeading: (entry: string) => `Ob die Konfiguration der einzelnen Agenten einen ${entry}-Eintrag enthält:`,
  hostUnreadable: (problem: string) => `nicht lesbar (${problem})`,
  hostConfigured: "ja",
  hostNotConfigured: "nein",
  noServiceStatus: "Die Runtime hat den Status des MCP-Dienstes nicht gemeldet",
  levelChoice: (value: string) => `--level muss ask oder auto sein: ${value}`,
};
