import type { DriversOpencodeMessages } from './drivers-opencode.ts';

export const de: DriversOpencodeMessages = {
  plan: "Modellkonten in OpenCode",
  installHint: "2.x mit npm install -g @opencode/cli installieren",
  unsupportedMajor: (p: { version: string }) =>
    `OpenCode ${p.version} ist eine Hauptversion, die BaoCut noch nicht unterstützt. Nur 2.x wird unterstützt.`,
  tooOld: (p: { version: string; min: string; command: string }) =>
    `OpenCode ${p.version} ist zu alt. Aktualisieren: BaoCut benötigt ${p.min} oder eine neuere 2.x-Version (${p.command}).`,
  unsupportedVersion: (p: { version: string; min: string }) => `OpenCode ${p.version} wird nicht unterstützt. Benötigt wird ${p.min} oder eine neuere 2.x-Version`,
  versionUnknown: "unbekannte Version",
  noModelAccount: (p: { command: string }) =>
    `In OpenCode ist noch kein Modellkonto verbunden. Daher sind nur die kostenlosen Modelle von OpenCode Zen verfügbar. Zum Verbinden im Terminal ausführen: ${p.command}, um eines zu verbinden.`,
  probeFailed: (p: { error: string }) => `OpenCode serve konnte nicht starten oder die Modellliste lesen: ${p.error}`,
  externalDirectory: "Auf einen Speicherort außerhalb des Arbeitsverzeichnisses zugreifen",
  directoryNotReady: (p: { seconds: string; directory: string }) =>
    `OpenCode konnte das Verzeichnis nicht vorbereiten: ${p.directory} innerhalb von ${p.seconds} Sekunden`,

  httpFailed: (p: { operation: string; status: string; tag: string; detail: string }) =>
    `OpenCode ${p.operation} fehlgeschlagen (HTTP ${p.status}${p.tag ? ` ${p.tag}` : ""})${p.detail ? `: ${p.detail}` : ""}`,
  htmlResponse: "Webseite statt v2-API empfangen (inkompatible Version?)",
  processExited: "Der OpenCode-Prozess wurde beendet",
  killedBySignal: (p: { signal: string }) => `Beendet durch Signal ${p.signal}`,
  exitCode: (p: { code: string }) => `Exit-Code ${p.code}`,
  serveNotReady: (p: { seconds: string }) => `opencode serve war nicht bereit innerhalb von ${p.seconds} Sekunden`,
  serveExitedAtStart: (p: { reason: string }) => `opencode serve wurde beim Start beendet (${p.reason})`,
  serveExited: "opencode serve wurde beendet",
  streamConnectFailed: (p: { status: string }) => `Verbindung zum Ereignisstream fehlgeschlagen (HTTP ${p.status})`,
  streamEnded: "Der Ereignisstream wurde beendet",
  streamNotConnected: (p: { seconds: string }) => `Der Ereignisstream hat keine Verbindung hergestellt (${p.seconds} Sekunden)`,
  streamLost: (p: { error: string }) => `Ereignisstream getrennt: ${p.error}`,
  mcpFailed: (p: { name: string; server: string; error: string }) =>
    `${p.name} konnte keine Verbindung zum MCP-Server herstellen: ${p.server} (${p.error}). Die Werkzeuge von BaoCut sind in dieser Sitzung nicht verfügbar.`,
  mcpTimeout: (p: { name: string; servers: string }) =>
    `${p.name} hat die MCP-Server nicht rechtzeitig verbunden (${p.servers}). Die Werkzeuge von BaoCut sind in dieser Sitzung möglicherweise nicht verfügbar.`,
  promptRejected: (p: { name: string; error: string }) => `${p.name} hat diese Nachricht nicht angenommen: ${p.error}`,
  setModeFailed: (p: { name: string; error: string }) => `${p.name} konnte den Zugriffsmodus nicht festlegen: ${p.error}`,
  retryFallback: "Die Modellanfrage ist fehlgeschlagen. Wird in Kürze erneut versucht.",
  runFailed: (p: { name: string }) => `${p.name}-Ausführung fehlgeschlagen`,
  endedAfterRejection: (p: { name: string }) =>
    `${p.name} hat diese Runde nach Ablehnung eines Werkzeugs beendet. Für einen anderen Ansatz eine weitere Nachricht senden.`,
  interruptedTurn: (p: { name: string; reason: string }) => `${p.name} hat diese Runde unterbrochen (${p.reason}).`,
  modelFormat: (p: { name: string; id: string }) => `${p.name}-Modelle müssen als provider/model angegeben werden (erhalten: ${p.id})`,
};
