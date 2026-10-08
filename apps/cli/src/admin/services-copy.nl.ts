import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT, pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';
export const nl: ServicesMessages = {
 accessLinkVideo: (video) => `Na het inloggen wordt de editor voor video ${video} direct geopend`,
 help: `Gebruik:
  baocut services [status]         Externe diensten: status, adres, niveau en bereik van de
                                   MCP-dienst, model-API, webdienst en het LAN-knooppunt
  baocut services start <service>  Een dienst starten (mcp, model-api, web, node)
  baocut services stop <service>   Een dienst stoppen (externe verbindingen sluiten en wachtende bevestigingsverzoeken
                                   annuleren; ingediende taken worden afgemaakt)
  baocut services configure <service> [options]
    --port <port>                  Luisterpoort (alleen loopback; MCP standaard ${MCP_DEFAULT_PORT}, model-API
                                   ${MODEL_API_DEFAULT_PORT}); bij bezetting geeft de dienst een fout en wisselt niet van poort
    --level read|ask|auto          read is alleen-lezen; ask laat je elke schrijfactie, taak
                                   en generatie bevestigen in BaoCut (standaard); auto voert direct uit
    --videos all|<id,…>            Alle video’s beschikbaar stellen, of alleen deze videoIds (komma’s); video’s buiten
                                   het bereik zijn extern niet zichtbaar (de model-API heeft geen bereik)
    --autostart on|off             Met de Runtime starten
    --route-online on|off          Model-API: doorsturen naar ingeschakelde online diensten (standaard uit, alleen lokale modellen)
    --route-nodes on|off           Model-API: doorsturen naar gekoppelde LAN-knooppunten (standaard uit)
    --route-agent on|off           Model-API: doorsturen naar agentaanbieders (standaard uit)
    --max-concurrent <n>           Model-API: lopende verzoeken per client (standaard 4); boven de limiet wordt 429 teruggegeven
    --read-only on|off             Alleen web: de browser kan alleen bekijken, niet bewerken of berichten en taken indienen
    --methods default|<method,…>   Alleen web: toegestane methoden (namen of <namespace>.*); alleen beperking van de standaardset
  baocut services mcp add-client <name>
                                   Een token voor een externe app maken (alleen deze keer getoond);
                                   één per app, elk afzonderlijk in te trekken
  baocut services mcp clients      Gemaakte clients tonen (zonder tokens)
  baocut services mcp revoke <clientId>
                                   Een client intrekken; het token werkt direct niet meer
  baocut services mcp connection [clientId]
                                   Het adres en een fragment voor de configuratie van een MCP-client
                                   afdrukken (met een tijdelijke aanduiding voor het token)
  baocut services model-api add-client|clients|revoke|connection …
                                   Clients van de model-API (een lokaal OpenAI-achtig endpoint),
                                   gebruik zoals hierboven; de tokens zijn niet uitwisselbaar met MCP-tokens;
                                   connection toont hoe OPENAI_BASE_URL en OPENAI_API_KEY worden ingesteld
  baocut services model-api aliases
                                   Modelnaamaliassen tonen (standaard whisper-1 → het lokale standaardtranscriptiemodel)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Een alias toevoegen of wijzigen; zonder model wordt het standaardmodel van de aanbieder gebruikt
  baocut services model-api unalias <name>
                                   Een alias verwijderen
  baocut services web sessions     Browsersessies tonen (zonder sessietokens)
  baocut services web revoke <sessionId>
                                   Een browsersessie intrekken: de verbinding wordt direct verbroken`,
 webHelp: `Gebruik:
  baocut web open [--video <videoId>] [--launch]       De webdienst starten (standaardpoort ${WEB_DEFAULT_PORT}) en een eenmalige toegangslink afdrukken; de link werkt
                                   één keer, twee minuten. --video opent de video direct in de editor (videoId uit
                                   baocut videos list). --launch opent een inlogpagina zonder code in de standaardbrowser;
                                   de toegangscode staat alleen in de terminal, om op de inlogpagina te plakken
                                   (de code gaat niet mee in de argumenten van de opdracht die de browser opent)`,
 usage: 'Gebruik: baocut services [status | start <service> | stop <service>\n       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n                    [--read-only on|off] [--methods default|<method,…>]\n       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n       | mcp|model-api connection [clientId]\n       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n       | web sessions | web revoke <sessionId>]',
 unknownService: (id, available) => `Onbekende dienst: ${id}. Beschikbaar: ${available.join(', ')}`, addClientUsage: (service) => `Gebruik: baocut services ${service} add-client <name> (kies een herkenbare naam, bijv. ${service === 'mcp' ? 'Claude Desktop' : 'Ondertiteltool'})`, aliasUsage: (capabilities) => `Gebruik: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (functies: ${capabilities.join(', ')})`, unknownCapability: (capability, available) => `Onbekende functie: ${capability}. Beschikbaar: ${available.join(', ')}`, onOff: (flag) => `${flag} moet on of off zijn`, portRange: '--port moet een geheel getal van 1 tot 65535 zijn', levelChoice: (levels) => `--level moet een van ${levels.join(', ')} zijn`, videosFormat: '--videos moet all zijn, of video-id’s gescheiden door komma’s', maxConcurrentRange: '--max-concurrent moet een geheel getal van 1 tot 64 zijn', routingOnlyModelApi: '--route-online, --route-nodes, --route-agent en --max-concurrent gelden alleen voor model-api', methodsFormat: '--methods moet default zijn, of methodenamen en <namespace>.* gescheiden door komma’s', webOnlyFlags: '--read-only en --methods gelden alleen voor de webdienst', nothingToConfigure: 'Niets te wijzigen: geef --port, --level, --videos, --autostart, model-api-routing en gelijktijdigheid, of --read-only en --methods voor web op',
 states: { off: 'Uit', starting: 'Starten', on: 'Aan', stopping: 'Stoppen', error: 'Fout' }, levels: { read: 'read (alleen-lezen)', ask: 'ask (elke schrijfactie bevestigen)', auto: 'auto (direct uitvoeren)' }, levelAskModelApi: 'ask (elk generatieverzoek bevestigen)', notProvided: (serviceId, label) => `${serviceId}  ${label}  Niet beschikbaar in deze versie`, port: (port) => `poort ${port}`, reason: (error) => `  Reden: ${error}`, nodeHint: '  Gebruik baocut share voor poort, functies en koppelen', autostart: (on) => `  Met de Runtime starten: ${on ? 'ja' : 'nee'}`, level: (level) => `  Niveau: ${level}`, levelScope: (level, scope) => `  Niveau: ${level}  Bereik: ${scope}`, allVideos: 'alle video’s', someVideos: (ids) => `${ids.length} ${pluralForm('nl', ids.length, { one: 'video', other: 'video’s' })} (${ids.join(', ')})`, routeLocal: 'deze computer', routeOnline: 'online diensten', routeNodes: 'LAN-knooppunten', routeAgent: 'agent', routing: (routes, maxConcurrent) => `  Doorsturen naar: ${routes.join(', ')}  ${maxConcurrent} ${pluralForm('nl', maxConcurrent, { one: 'gelijktijdig verzoek', other: 'gelijktijdige verzoeken' })} per client`, aliases: (aliases) => `  Aliassen: ${aliases.length > 0 ? aliases.join(', ') : 'geen'}`, clientCount: (count) => `  Clients: ${count}`, web: (readOnly, methods) => `  Alleen-lezen: ${readOnly ? 'ja' : 'nee'}  Toegestane methoden: ${methods === null ? 'standaardset' : methods.join(', ')}`, browserSessions: (count) => `  Browsersessies: ${count} (toegangslink: baocut web open)`, aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'standaardmodel'} (${capability})`, noAliases: 'Geen aliassen. Voeg er een toe met baocut services model-api alias <name> <capability> <providerId>[/<modelId>]', noClients: (service) => `Geen clients. Maak er een met baocut services ${service} add-client <name>`, client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  gemaakt ${createdAt}  laatst gebruikt ${lastUsedAt ?? 'nooit'}`, clientCreated: (name, clientId) => `Client ${name} gemaakt (${clientId})`, tokenOnce: (token) => `Token (alleen deze keer getoond; kopieer en bewaar het nu. Bij verlies trek je de client in en maak je een nieuwe): ${token}`, address: (url) => `URL: ${url}`, bearerHeader: 'Header: Authorization: Bearer <token>', header: (value) => `Header: Authorization: ${value}`, interfaceVersion: (version) => `Interfaceversie: ${version}`, snippetIntro: 'Configuratiefragment (vervang de tijdelijke tokenaanduiding door het token dat je bij het maken kreeg):', noWebSessions: 'Geen browsersessies. Haal een toegangslink op met baocut web open', webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  ingelogd ${createdAt}  laatst gebruikt ${lastUsedAt}  verloopt ${expiresAt}  ${connections} ${pluralForm('nl', connections, { one: 'verbinding', other: 'verbindingen' })}`, accessLinkNote: (expiresAt) => `Deze link werkt één keer en is geldig tot ${expiresAt}; deel deze niet. Voer baocut web open opnieuw uit na gebruik of verlopen`, badAccessLink: 'De toegangslink heeft niet het verwachte formaat: werk BaoCut bij of voer opnieuw uit zonder --launch', accessCode: (code) => `Toegangscode: ${code}`, launchNote: (loginUrl, expiresAt) => `Plak deze code op de inlogpagina die in je browser is geopend (${loginUrl}). De code werkt één keer en is geldig tot ${expiresAt}; deel deze niet. Voer baocut web open opnieuw uit na gebruik of verlopen`, webNotStarted: (reason) => `De webdienst kan niet starten: ${reason}`, serviceError: (serviceId, reason) => `${serviceId} mislukt: ${reason}`, clientRevoked: (clientId) => `${clientId} ingetrokken; het token werkt direct niet meer`, webSessionRevoked: (sessionId) => `${sessionId} ingetrokken; de verbinding is gesloten`, browserFailed: (message) => `Kan de browser niet openen: ${message}. Open zelf de inlogpagina hierboven`,
};
