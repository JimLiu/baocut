import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT, pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';
export const de: ServicesMessages = {
  accessLinkVideo: (video) => `Nach der Anmeldung öffnet sich direkt der Editor für Video ${video}`,
  help: `Verwendung:
  baocut services [status]         Externe Dienste: Status, Adresse, Stufe und Umfang des
                                   MCP-Dienstes, der Modell-API, des Webdienstes und des LAN-Knotens
  baocut services start <service>  Dienst starten (mcp, model-api, web, node)
  baocut services stop <service>   Dienst stoppen (trennt externe Verbindungen und bricht Anfragen ab,
                                   die auf Bestätigung warten; bereits eingereichte Aufgaben laufen zu Ende)
  baocut services configure <service> [options]
    --port <port>                  Port zum Lauschen (nur Loopback-Adresse; MCP verwendet standardmäßig ${MCP_DEFAULT_PORT}, die Modell-API
                                   ${MODEL_API_DEFAULT_PORT}); bei Belegung meldet der Dienst einen Fehler statt den Port zu wechseln
    --level read|ask|auto          read ist schreibgeschützt; ask lässt Sie jeden Schreibvorgang, jede Aufgabe
                                   und Generierung in BaoCut bestätigen (Standard); auto führt sie direkt aus
    --videos all|<id,…>            Alle Videos oder nur diese videoIds freigeben (durch Kommas getrennt); Videos außerhalb
                                   des Umfangs sind extern nicht sichtbar (die Modell-API hat keinen Umfang)
    --autostart on|off             Mit der Runtime starten
    --route-online on|off          Modell-API: Anfragen an aktivierte Onlinedienste weiterleiten (standardmäßig aus, nur lokale Modelle)
    --route-nodes on|off           Modell-API: an gekoppelte LAN-Knoten weiterleiten (standardmäßig aus)
    --route-agent on|off           Modell-API: an Agenten-Anbieter weiterleiten (standardmäßig aus)
    --max-concurrent <n>           Modell-API: gleichzeitige Anfragen pro Client (Standard 4); darüber wird 429 zurückgegeben
    --read-only on|off             Nur web: Browser dürfen nur ansehen, nicht bearbeiten, Nachrichten senden oder Aufgaben einreichen
    --methods default|<method,…>   Nur web: erlaubte Methoden (Methodennamen oder <namespace>.*); nur Einschränkung der Standardmenge
  baocut services mcp add-client <name>
                                   Token für eine externe App erstellen (wird nur einmal
                                   angezeigt); eines pro App, jedes einzeln widerrufbar
  baocut services mcp clients      Erstellte Clients auflisten (ohne Token)
  baocut services mcp revoke <clientId>
                                   Client widerrufen; sein Token funktioniert sofort nicht mehr
  baocut services mcp connection [clientId]
                                   Adresse und Ausschnitt für die Konfiguration eines
                                   MCP-Clients ausgeben (mit Platzhalter für das Token)
  baocut services model-api add-client|clients|revoke|connection …
                                   Clients der Modell-API (lokaler Endpunkt im OpenAI-Stil),
                                   Verwendung wie oben; ihre Token und MCP-Token sind nicht austauschbar;
                                   connection zeigt, wie OPENAI_BASE_URL und OPENAI_API_KEY gesetzt werden
  baocut services model-api aliases
                                   Aliase für Modellnamen auflisten (standardmäßig whisper-1 → lokales Standard-Transkriptionsmodell)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Alias hinzufügen oder ändern; ohne Modell wird das Standardmodell des Anbieters verwendet
  baocut services model-api unalias <name>
                                   Alias löschen
  baocut services web sessions     Browsersitzungen auflisten (ohne Sitzungstoken)
  baocut services web revoke <sessionId>
                                   Browsersitzung widerrufen: Verbindung wird sofort getrennt`,
  webHelp: `Verwendung:
  baocut web open [--video <videoId>] [--launch]       Webdienst starten (Standardport ${WEB_DEFAULT_PORT}) und einmaligen Zugangslink ausgeben; er funktioniert
                                   nur einmal, für zwei Minuten. --video öffnet das Video direkt im Editor (videoId aus
                                   baocut videos list). --launch öffnet die Anmeldeseite ohne Code im Standardbrowser;
                                   der Zugangscode erscheint nur im Terminal und wird von Ihnen auf der Anmeldeseite
                                   eingefügt (nicht als Argument an den Befehl zum Öffnen des Browsers übergeben)`,
  usage: 'Verwendung: baocut services [status | start <service> | stop <service>\n' +
    '       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                    [--read-only on|off] [--methods default|<method,…>]\n' +
    '       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '       | mcp|model-api connection [clientId]\n' +
    '       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' +
    '       | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `Unbekannter Dienst: ${id}. Verfügbar: ${available.join(', ')}`,
  addClientUsage: (service) => `Verwendung: baocut services ${service} add-client <name> (wählen Sie einen erkennbaren Namen, z. B. ${service === 'mcp' ? 'Claude Desktop' : 'Untertitel-Werkzeug'})`,
  aliasUsage: (capabilities) => `Verwendung: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (Fähigkeiten: ${capabilities.join(', ')})`,
  unknownCapability: (capability, available) => `Unbekannte Fähigkeit: ${capability}. Verfügbar: ${available.join(', ')}`,
  onOff: (flag) => `${flag} muss on oder off sein`, portRange: '--port muss eine ganze Zahl von 1 bis 65535 sein',
  levelChoice: (levels) => `--level muss einer dieser Werte sein: ${levels.join(', ')}`,
  videosFormat: '--videos muss all oder durch Kommas getrennte Video-IDs sein', maxConcurrentRange: '--max-concurrent muss eine ganze Zahl von 1 bis 64 sein',
  routingOnlyModelApi: '--route-online, --route-nodes, --route-agent und --max-concurrent gelten nur für model-api',
  methodsFormat: '--methods muss default oder durch Kommas getrennte Methodennamen und <namespace>.* sein',
  webOnlyFlags: '--read-only und --methods gelten nur für den Webdienst',
  nothingToConfigure: 'Nichts zu ändern: geben Sie --port, --level, --videos, --autostart, Routing und Gleichzeitigkeit für model-api oder --read-only und --methods für web an',
  states: { off: 'Aus', starting: 'Wird gestartet', on: 'An', stopping: 'Wird gestoppt', error: 'Fehler' },
  levels: { read: 'read (schreibgeschützt)', ask: 'ask (jeden Schreibvorgang bestätigen)', auto: 'auto (direkt ausführen)' },
  levelAskModelApi: 'ask (jede Generierungsanfrage bestätigen)',
  notProvided: (serviceId, label) => `${serviceId}  ${label}  In dieser Version nicht verfügbar`, port: (port) => `Port ${port}`,
  reason: (error) => `  Grund: ${error}`, nodeHint: '  Port, Fähigkeiten und Kopplung: baocut share',
  autostart: (on) => `  Mit der Runtime starten: ${on ? 'ja' : 'nein'}`, level: (level) => `  Stufe: ${level}`,
  levelScope: (level, scope) => `  Stufe: ${level}  Umfang: ${scope}`, allVideos: 'alle Videos',
  someVideos: (ids) => `${ids.length} ${pluralForm('de', ids.length, { one: 'Video', other: 'Videos' })} (${ids.join(', ')})`,
  routeLocal: 'dieser Computer', routeOnline: 'Onlinedienste', routeNodes: 'LAN-Knoten', routeAgent: 'Agent',
  routing: (routes, maxConcurrent) => `  Weiterleitung an: ${routes.join(', ')}  ${maxConcurrent} ${pluralForm('de', maxConcurrent, { one: 'gleichzeitige Anfrage', other: 'gleichzeitige Anfragen' })} pro Client`,
  aliases: (aliases) => `  Aliase: ${aliases.length > 0 ? aliases.join(', ') : 'keine'}`, clientCount: (count) => `  Clients: ${count}`,
  web: (readOnly, methods) => `  Schreibgeschützt: ${readOnly ? 'ja' : 'nein'}  Erlaubte Methoden: ${methods === null ? 'Standardmenge' : methods.join(', ')}`,
  browserSessions: (count) => `  Browsersitzungen: ${count} (Zugangslink: baocut web open)`,
  aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'Standardmodell'} (${capability})`,
  noAliases: 'Keine Aliase. Hinzufügen mit baocut services model-api alias <name> <capability> <providerId>[/<modelId>]',
  noClients: (service) => `Keine Clients. Erstellen mit baocut services ${service} add-client <name>`,
  client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  erstellt ${createdAt}  zuletzt genutzt ${lastUsedAt ?? 'nie'}`,
  clientCreated: (name, clientId) => `Client ${name} erstellt (${clientId})`,
  tokenOnce: (token) => `Token (wird nur einmal angezeigt; jetzt kopieren und speichern. Bei Verlust Client widerrufen und neu erstellen): ${token}`,
  address: (url) => `URL: ${url}`, bearerHeader: 'Header: Authorization: Bearer <token>', header: (value) => `Header: Authorization: ${value}`,
  interfaceVersion: (version) => `Schnittstellenversion: ${version}`,
  snippetIntro: 'Konfigurationsausschnitt (Token-Platzhalter durch das bei der Client-Erstellung erhaltene Token ersetzen):',
  noWebSessions: 'Keine Browsersitzungen. Zugangslink abrufen mit baocut web open',
  webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  angemeldet ${createdAt}  zuletzt genutzt ${lastUsedAt}  läuft ab ${expiresAt}  ${connections} ${pluralForm('de', connections, { one: 'Verbindung', other: 'Verbindungen' })}`,
  accessLinkNote: (expiresAt) => `Dieser Link funktioniert einmal und gilt bis ${expiresAt}; geben Sie ihn nicht weiter. Nach Nutzung oder Ablauf erneut baocut web open ausführen`,
  badAccessLink: 'Der Zugangslink hat nicht das erwartete Format: BaoCut aktualisieren oder ohne --launch erneut ausführen',
  accessCode: (code) => `Zugangscode: ${code}`,
  launchNote: (loginUrl, expiresAt) => `Fügen Sie diesen Code auf der im Browser geöffneten Anmeldeseite ein (${loginUrl}). Er funktioniert einmal und gilt bis ${expiresAt}; geben Sie ihn nicht weiter. Nach Nutzung oder Ablauf erneut baocut web open ausführen`,
  webNotStarted: (reason) => `Webdienst wurde nicht gestartet: ${reason}`, serviceError: (serviceId, reason) => `${serviceId} fehlgeschlagen: ${reason}`,
  clientRevoked: (clientId) => `${clientId} widerrufen; sein Token funktioniert sofort nicht mehr`,
  webSessionRevoked: (sessionId) => `${sessionId} widerrufen; seine Verbindung wurde geschlossen`,
  browserFailed: (message) => `Browser konnte nicht geöffnet werden: ${message}. Öffnen Sie die Anmeldeseite oben selbst`,
};
