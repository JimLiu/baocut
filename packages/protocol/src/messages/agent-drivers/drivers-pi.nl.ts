import type { DriversPiMessages } from './drivers-pi.ts';

export const nl: DriversPiMessages = {
  plan: "Modelaccounts in Pi",
  installHint: "Installeer Pi met npm (npm install -g @earendil-works/pi-coding-agent, vereist Node.js)",
  signedOut:
    "Pi is niet ingelogd. Voer pi uit in een terminal en voer /login in, of stel een API-sleutel in voor een modelaanbieder (bijvoorbeeld ANTHROPIC_API_KEY).",
  rpcFailed: (p: { error: string }) => `De RPC-modus van Pi kan niet starten: ${p.error}`,
  processStartFailed: (p: { error: string }) => `Het Pi-proces kan niet starten: ${p.error}`,

  processExited: (p: { code: string; signal: string; tail: string }) =>
    `Het Pi-proces is afgesloten (code ${p.code}, signaal ${p.signal})${p.tail ? `: ${p.tail}` : ""}`,
  processClosed: "Het Pi-proces is gesloten",
  requestTimeout: (p: { command: string; ms: string }) => `Pi heeft niet geantwoord op ${p.command} binnen ${p.ms} ms`,
  stdinUnwritable: "De stdin van Pi is niet schrijfbaar",
  commandFailed: (p: { command: string }) => `Pi: ${p.command} mislukt`,
  toolFallback: "Tool",
  sessionFileMissing: "sessiebestand niet gevonden",

  withStderr: (p: { error: string; tail: string }) => `${p.error} (${p.tail})`,
  mcpNameInvalid: (p: { name: string }) =>
    `De MCP-servernaam ${p.name} bevat tekens die Pi niet accepteert (alleen letters, cijfers, _ en -), dus die kan niet worden gebruikt in deze sessie.`,
  modelFormat: (p: { model: string }) => `Pi-modellen moeten worden geschreven als provider/id: ${p.model}`,
  switchModelFailed: (p: { model: string; error: string }) => `Pi kan niet wisselen naar het model ${p.model}: ${p.error}`,
  effortUnsupported: (p: { level: string }) =>
    `Pi heeft geen denkintensiteitsniveau ‘${p.level}’, dus deze beurt gebruikt de huidige instelling.`,
  effortFailed: (p: { error: string }) => `Pi kan de denkintensiteit niet instellen (${p.error}), dus deze beurt gebruikt de huidige instelling.`,
  mcpConnectFailed: (p: { error: string }) =>
    `Pi kan niet verbinden met de MCP-server van BaoCut, dus de tools van BaoCut (projecten en ondertitels lezen en schrijven enzovoort) zijn niet beschikbaar in deze sessie: ${p.error}`,
  extensionError: (p: { error: string }) => `Een Pi-extensie is mislukt: ${p.error}`,
  modelCallFailed: "De modelaanroep van Pi is mislukt",

  notice: (p: { message: string }) => `Pi: ${p.message}`,

  extensionAsked: (p: { title: string }) =>
    `Een Pi-extensie wilde je iets vragen${p.title ? ` (‘${p.title}’)` : ""}. BaoCut kan dit soort vraag nog niet doorgeven, dus die is voor je geannuleerd.`,

  fullAccessOnly: (p: { mode: string }) =>
    `Pi kan niet voor elke actie toestemming vragen, dus BaoCut kan het alleen uitvoeren in de modus ‘${p.mode}’: het vraagt je geen toestemming voordat het opdrachten uitvoert of bestanden wijzigt.`,
};
