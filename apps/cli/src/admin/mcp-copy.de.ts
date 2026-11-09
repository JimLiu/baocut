import type { McpMessages } from './mcp-copy.ts';



export const de: McpMessages = {
  previousClientUnknown: "Der Client des ersetzten Eintrags ließ sich nicht ermitteln, daher wurde keiner widerrufen: baocut mcp status listet vorhandene Clients auf; widerrufen Sie nicht mehr verwendete Clients mit baocut services mcp revoke <clientId>",
  defaultProjectRegistered: (name: string, path: string) => `BaoCut hatte keine Projekte: Standardprojekt „${name}“ (${path}) registriert, in dem externe Agenten Videos erstellen können`,


  help: `Verwendung:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--transport stdio|http] [--level ask|auto] [--name <client name>] [--yes]
                                   Externen Agenten mit dem MCP-Dienst von BaoCut verbinden: Dienst starten (und mit der Runtime
                                   starten lassen), neuen Client und Token für den Agenten erstellen und Adresse und Token in dessen
                                   MCP-Konfiguration schreiben (Eintragsname baocut); anschließend den Agenten neu starten
                                   Hat BaoCut keine Projekte, wird das CLI-Projekt im Standardprojektordner für externe Agenten registriert
    --transport stdio|http         stdio (Standard): Der Agent führt baocut mcp serve --stdio aus, das die Runtime von BaoCut selbst
                                   findet oder startet; http: schreibt die Adresse des Dienstes, die nur bei laufender Runtime funktioniert
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
                                   in der Konfiguration der einzelnen Agenten (ohne Tokens)
  baocut mcp serve --stdio         Was der stdio-Eintrag ausführt: ein stdio-MCP-Server, der mit dem Token aus BAOCUT_MCP_TOKEN an den
                                   MCP-Dienst weiterleitet und die Runtime bei Bedarf findet oder startet. Der Agent führt ihn aus, kein Terminal`,
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
  connectedStdio: (host: string, command: string) => `${host} ist über stdio mit dem MCP-Dienst von BaoCut verbunden: ${host} führt ${command} aus`,
  configEnvInherited: (configFile: string, envFile: string, envVar: string) =>
    `Konfiguration: ${configFile} (das Token liegt in env.${envVar} von ${envFile}; der Befehl erbt es von dort)`,
  restartHintStdio: (host: string) =>
    `Starten Sie ${host} neu, damit dies wirksam wird. ${host} führt den Befehl selbst aus, und der Befehl startet die Runtime von BaoCut, falls sie nicht läuft`,
  transportChoice: (value: string) => `--transport muss stdio oder http sein: ${value}`,
  serveTokenMissing: (envVar: string) =>
    `${envVar} ist nicht gesetzt, daher gibt es kein Token für den MCP-Dienst von BaoCut: Führen Sie baocut mcp install --agent <agent> aus, um es in die MCP-Konfiguration des Agenten zu schreiben`,
  serveServiceOff: 'Der MCP-Dienst von BaoCut ist ausgeschaltet: Schalten Sie ihn in BaoCut ein oder führen Sie baocut services configure mcp --autostart on aus',
  serveTokenRejected: 'Der MCP-Dienst von BaoCut hat das Token abgelehnt (widerrufen oder von einem anderen Runtime Home ausgestellt): Führen Sie baocut mcp install --agent <agent> --yes erneut aus',
  serveRuntimeLost: 'Die Runtime von BaoCut wurde während dieser Anfrage beendet; sie wurde nicht wiederholt',
  serveRuntimeUnavailable: (reason: string) => `Die Runtime von BaoCut ist nicht erreichbar: ${reason}`,
  serveHttpStatus: (status: number) => `Der MCP-Dienst von BaoCut hat mit HTTP ${status} geantwortet`,
};
