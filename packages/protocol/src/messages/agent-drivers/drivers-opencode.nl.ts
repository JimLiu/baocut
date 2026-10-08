import type { DriversOpencodeMessages } from './drivers-opencode.ts';

export const nl: DriversOpencodeMessages = {
  plan: "Modelaccounts in OpenCode",
  installHint: "Installeer 2.x met npm install -g @opencode/cli",
  unsupportedMajor: (p: { version: string }) =>
    `OpenCode ${p.version} is een hoofdversie die BaoCut nog niet ondersteunt. Alleen 2.x wordt ondersteund.`,
  tooOld: (p: { version: string; min: string; command: string }) =>
    `OpenCode ${p.version} is te oud. Werk het bij: BaoCut vereist ${p.min} of een nieuwere 2.x (${p.command}).`,
  unsupportedVersion: (p: { version: string; min: string }) => `OpenCode ${p.version} wordt niet ondersteund. Vereist is ${p.min} of een nieuwere 2.x`,
  versionUnknown: "onbekende versie",
  noModelAccount: (p: { command: string }) =>
    `Er is nog geen modelaccount verbonden in OpenCode, dus alleen de gratis modellen van OpenCode Zen zijn beschikbaar. Voer ${p.command} uit in een terminal om er een te verbinden.`,
  probeFailed: (p: { error: string }) => `OpenCode serve kan niet starten of de modellenlijst lezen: ${p.error}`,
  externalDirectory: "Een locatie buiten de werkmap benaderen",
  directoryNotReady: (p: { seconds: string; directory: string }) =>
    `OpenCode kan de map niet voorbereiden: ${p.directory} binnen ${p.seconds} seconden`,

  httpFailed: (p: { operation: string; status: string; tag: string; detail: string }) =>
    `OpenCode ${p.operation} mislukt (HTTP ${p.status}${p.tag ? ` ${p.tag}` : ""})${p.detail ? `: ${p.detail}` : ""}`,
  htmlResponse: "Een webpagina ontvangen in plaats van de v2-API (incompatibele versie?)",
  processExited: "Het OpenCode-proces is afgesloten",
  killedBySignal: (p: { signal: string }) => `Beëindigd door signaal ${p.signal}`,
  exitCode: (p: { code: string }) => `Afsluitcode ${p.code}`,
  serveNotReady: (p: { seconds: string }) => `opencode serve was niet gereed binnen ${p.seconds} seconden`,
  serveExitedAtStart: (p: { reason: string }) => `opencode serve is tijdens het opstarten afgesloten (${p.reason})`,
  serveExited: "opencode serve is afgesloten",
  streamConnectFailed: (p: { status: string }) => `Kan niet verbinden met de gebeurtenisstream (HTTP ${p.status})`,
  streamEnded: "De gebeurtenisstream is beëindigd",
  streamNotConnected: (p: { seconds: string }) => `De gebeurtenisstream heeft geen verbinding gemaakt (${p.seconds} seconden)`,
  streamLost: (p: { error: string }) => `Gebeurtenisstream verbroken: ${p.error}`,
  mcpFailed: (p: { name: string; server: string; error: string }) =>
    `${p.name} kan niet verbinden met de MCP-server ${p.server} (${p.error}). De tools van BaoCut zijn niet beschikbaar in deze sessie.`,
  mcpTimeout: (p: { name: string; servers: string }) =>
    `${p.name} heeft niet op tijd verbinding gemaakt met de MCP-servers (${p.servers}). De tools van BaoCut zijn mogelijk niet beschikbaar in deze sessie.`,
  promptRejected: (p: { name: string; error: string }) => `${p.name} heeft dit bericht niet geaccepteerd: ${p.error}`,
  setModeFailed: (p: { name: string; error: string }) => `${p.name} kan de toegangsmodus niet instellen: ${p.error}`,
  retryFallback: "Het modelverzoek is mislukt. Binnenkort wordt het opnieuw geprobeerd.",
  runFailed: (p: { name: string }) => `${p.name}-uitvoering mislukt`,
  endedAfterRejection: (p: { name: string }) =>
    `${p.name} heeft deze beurt beëindigd nadat een tool is geweigerd. Stuur nog een bericht als je wilt dat het een andere aanpak probeert.`,
  interruptedTurn: (p: { name: string; reason: string }) => `${p.name} heeft deze beurt onderbroken (${p.reason}).`,
  modelFormat: (p: { name: string; id: string }) => `${p.name}-modellen moeten worden geschreven als provider/model (ontvangen: ${p.id})`,
};
