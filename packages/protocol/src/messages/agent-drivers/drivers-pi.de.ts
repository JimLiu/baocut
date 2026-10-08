import type { DriversPiMessages } from './drivers-pi.ts';

export const de: DriversPiMessages = {
  plan: "Modellkonten in Pi",
  installHint: "Pi mit npm installieren (npm install -g @earendil-works/pi-coding-agent, benötigt Node.js)",
  signedOut:
    "Pi ist nicht angemeldet. Im Terminal pi ausführen und /login eingeben oder einen API-Schlüssel für einen Modellanbieter festlegen (zum Beispiel ANTHROPIC_API_KEY).",
  rpcFailed: (p: { error: string }) => `Der RPC-Modus von Pi konnte nicht starten: ${p.error}`,
  processStartFailed: (p: { error: string }) => `Der Pi-Prozess konnte nicht starten: ${p.error}`,

  processExited: (p: { code: string; signal: string; tail: string }) =>
    `Der Pi-Prozess wurde beendet (Code ${p.code}, Signal ${p.signal})${p.tail ? `: ${p.tail}` : ""}`,
  processClosed: "Der Pi-Prozess ist geschlossen",
  requestTimeout: (p: { command: string; ms: string }) => `Pi hat nicht geantwortet auf ${p.command} innerhalb von ${p.ms} ms`,
  stdinUnwritable: "stdin von Pi ist nicht beschreibbar",
  commandFailed: (p: { command: string }) => `Pi: ${p.command} fehlgeschlagen`,
  toolFallback: "Werkzeug",
  sessionFileMissing: "Sitzungsdatei nicht gefunden",

  withStderr: (p: { error: string; tail: string }) => `${p.error} (${p.tail})`,
  mcpNameInvalid: (p: { name: string }) =>
    `Der MCP-Servername ${p.name} enthält Zeichen, die Pi nicht akzeptiert (nur Buchstaben, Ziffern, _ und -); er kann in dieser Sitzung daher nicht verwendet werden.`,
  modelFormat: (p: { model: string }) => `Pi-Modelle müssen als provider/id angegeben werden: ${p.model}`,
  switchModelFailed: (p: { model: string; error: string }) => `Pi konnte nicht wechseln zum Modell ${p.model}: ${p.error}`,
  effortUnsupported: (p: { level: string }) =>
    `Pi hat keine Denkaufwandsstufe „${p.level}“; diese Runde verwendet daher die aktuelle Einstellung.`,
  effortFailed: (p: { error: string }) => `Pi konnte den Denkaufwand nicht festlegen (${p.error}); diese Runde verwendet daher die aktuelle Einstellung.`,
  mcpConnectFailed: (p: { error: string }) =>
    `Pi konnte keine Verbindung zum MCP-Server von BaoCut herstellen. Die Werkzeuge von BaoCut (Projekte, Untertitel usw. lesen und schreiben) sind in dieser Sitzung daher nicht verfügbar: ${p.error}`,
  extensionError: (p: { error: string }) => `Eine Pi-Erweiterung ist fehlgeschlagen: ${p.error}`,
  modelCallFailed: "Der Modellaufruf von Pi ist fehlgeschlagen",

  notice: (p: { message: string }) => `Pi: ${p.message}`,

  extensionAsked: (p: { title: string }) =>
    `Eine Pi-Erweiterung wollte Ihnen eine Frage stellen${p.title ? ` („${p.title}“)` : ""}. BaoCut kann diese Art von Frage noch nicht weitergeben; sie wurde daher abgebrochen.`,

  fullAccessOnly: (p: { mode: string }) =>
    `Pi kann nicht vor jeder Aktion nachfragen. BaoCut kann es daher nur im Modus „${p.mode}“ ausführen: Es fragt vor Befehlen oder Dateiänderungen nicht nach.`,
};
