import type { McpMessages } from './mcp-copy.ts';
export const nl: McpMessages = {
 previousClientUnknown: 'Kan niet bepalen welke client het vervangen item gebruikte, dus er is geen client ingetrokken: baocut mcp status toont bestaande clients; trek ongebruikte clients in met baocut services mcp revoke <clientId>', defaultProjectRegistered: (name, path) => `BaoCut had geen projecten: standaardproject ‘${name}’ (${path}) geregistreerd waarin externe agents video’s kunnen maken`,
 help: `Gebruik:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--transport stdio|http] [--level ask|auto] [--name <client name>] [--yes]
                                   Een externe agent verbinden met de MCP-dienst van BaoCut: de dienst starten (ook met de Runtime),
                                   een nieuwe client en token voor de agent maken en het adres en token naar de
                                   MCP-configuratie van de agent schrijven (itemnaam baocut); daarna de agent herstarten
                                   Als BaoCut geen projecten heeft, het CLI-project registreren in de standaardprojectmap voor externe agents
    --transport stdio|http         stdio (standaard): de agent voert baocut mcp serve --stdio uit, dat de Runtime van BaoCut zelf
                                   vindt of start; http: schrijft het adres van de dienst, dat alleen werkt terwijl de Runtime draait
    --level ask|auto               Toegangsniveau: ask laat je elke schrijfactie en taak bevestigen in BaoCut (dienststandaard); auto
                                   voert ze direct uit. Zonder deze optie blijft het huidige niveau staan
    --name <client name>           Clientnaam in BaoCut (standaard de agentnaam); afzonderlijk in te trekken
    --yes                          Als de configuratie al een baocut-item heeft, dit vervangen en de oude client intrekken
                                   (herkend aan het oude token; indien niet herkenbaar worden clients met dezelfde naam
                                   getoond zodat je beslist welke je intrekt). Zonder deze optie geen overschrijving of nieuwe client
  Waar het token staat: Claude Code bewaart het in env (BAOCUT_MCP_TOKEN) van ~/.claude/settings.json; de configuratie verwijst er alleen naar.
  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) en Gemini CLI (~/.gemini/settings.json) hebben geen plek voor omgevingsvariabelen,
  dus het token staat als platte tekst in hun configuratiebestand: commit of deel die bestanden niet en kies bij voorkeur ask.
  Als een token uitlekt, trek het in met baocut services mcp revoke <clientId>.
  De dienst is alleen beschikbaar terwijl de Runtime van BaoCut draait (open BaoCut of voer baocut runtime ensure uit).
  baocut mcp status                Status, adres, niveau en clients van de MCP-dienst en of elke agentconfiguratie een
                                   baocut-item bevat (zonder tokens)
  baocut mcp serve --stdio         Wat de stdio-vermelding uitvoert: een stdio-MCP-server die met het token uit BAOCUT_MCP_TOKEN naar de
                                   MCP-dienst doorstuurt en de Runtime zo nodig vindt of start. De agent voert hem uit, geen terminal`,
 entryExists: (file, entry) => `${file} bevat al een ${entry}-item; niets gewijzigd. Voeg --yes toe om dit te vervangen`, serviceNotAvailable: 'Deze BaoCut-versie biedt geen MCP-dienst', serviceStartFailed: (reason) => `De MCP-dienst kan niet starten: ${reason ?? 'onbekende reden'}`, connected: (host, url) => `${host} verbonden met de MCP-dienst van BaoCut: ${url}`, configEnv: (configFile, envFile, envVar) => `Configuratie: ${configFile} (het token staat in env.${envVar} van ${envFile}; de configuratie verwijst er alleen naar)`, configPlaintext: (configFile, clientId) => `Configuratie: ${configFile} (het token staat als platte tekst in dit bestand: commit of deel het niet; trek het bij uitlekken in met baocut services mcp revoke ${clientId})`, clientLine: (name, clientId, level) => `Client: ${name} (${clientId})  Niveau: ${level ?? '—'}`, restartHint: (host) => `Herstart ${host} om dit toe te passen. De dienst draait met de Runtime van BaoCut: als die niet draait, open BaoCut of voer eerst baocut runtime ensure uit`, replacedRevoked: (name, clientId) => `Oud item vervangen en de bijbehorende client ingetrokken: ${name} (${clientId})`, replacedRevokeFailed: (reason) => `Oud item vervangen, maar de bijbehorende client kan niet worden ingetrokken: ${reason}`, oldClientRemains: (ids) => `De oude client bestaat nog: ${ids.join(', ')}. Als deze niet meer wordt gebruikt: baocut services mcp revoke <clientId>`, sameNameClientsRemain: (ids, unrecognized) => `${unrecognized ? 'Kan niet bepalen welke client het oude item gebruikte; clients' : 'Clients'} met dezelfde naam bestaan nog: ${ids.join(', ')}. Als ze niet meer worden gebruikt: baocut services mcp revoke <clientId>`, hostsHeading: (entry) => `Of elke agentconfiguratie een ${entry}-item bevat:`, hostUnreadable: (problem) => `kan niet lezen (${problem})`, hostConfigured: 'ja', hostNotConfigured: 'nee', noServiceStatus: 'De Runtime heeft geen status van de MCP-dienst gemeld', levelChoice: (value) => `--level moet ask of auto zijn: ${value}`,
  connectedStdio: (host, command) => `${host} is via stdio verbonden met de MCP-dienst van BaoCut: ${host} voert ${command} uit`,
  configEnvInherited: (configFile, envFile, envVar) => `Configuratie: ${configFile} (het token staat in env.${envVar} van ${envFile}; de opdracht erft het daarvandaan)`,
  restartHintStdio: (host) => `Herstart ${host} om dit toe te passen. ${host} voert de opdracht zelf uit, en de opdracht start de Runtime van BaoCut als die niet draait`,
  transportChoice: (value) => `--transport moet stdio of http zijn: ${value}`,
  serveTokenMissing: (envVar) => `${envVar} is niet ingesteld, dus er is geen token voor de MCP-dienst van BaoCut: voer baocut mcp install --agent <agent> uit om het in de MCP-configuratie van de agent te schrijven`,
  serveServiceOff: 'De MCP-dienst van BaoCut staat uit: zet hem aan in BaoCut of voer baocut services configure mcp --autostart on uit',
  serveTokenRejected: 'De MCP-dienst van BaoCut heeft het token geweigerd (ingetrokken, of uitgegeven door een andere Runtime Home): voer baocut mcp install --agent <agent> --yes opnieuw uit',
  serveRuntimeLost: 'De Runtime van BaoCut stopte tijdens dit verzoek; het is niet opnieuw geprobeerd',
  serveRuntimeUnavailable: (reason) => `De Runtime van BaoCut is niet bereikbaar: ${reason}`,
  serveHttpStatus: (status) => `De MCP-dienst van BaoCut antwoordde met HTTP ${status}`,
};
