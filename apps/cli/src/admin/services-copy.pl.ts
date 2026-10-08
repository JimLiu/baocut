import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const pl: ServicesMessages = {
  accessLinkVideo: (video) => `Po logowaniu otworzy się od razu edytor wideo ${video}`,

  help: `Użycie:
  baocut services [status]         Usługi zewnętrzne: stan, adres, poziom i zakres MCP,
                                   API modeli, usługi internetowej i węzła sieci lokalnej
  baocut services start <service>  Uruchom usługę (mcp, model-api, web, node)
  baocut services stop <service>   Zatrzymaj (rozłącza zewnętrzne połączenia i anuluje żądania
                                   potwierdzenia; przesłane zadania kończą się)
  baocut services configure <service> [options]
    --port <port>                  Port (tylko loopback; MCP domyślnie ${MCP_DEFAULT_PORT}, API modeli
                                   ${MODEL_API_DEFAULT_PORT}); zajęty port powoduje błąd, nie zmianę portu
    --level read|ask|auto          read – tylko odczyt; ask potwierdza zapis, zadania i generowanie
                                   w BaoCut (domyślnie); auto działa bezpośrednio
    --videos all|<id,…>            Wszystkie wideo lub videoIds przecinkami; poza zakresem niewidoczne zewnętrznie
                                   (API modeli nie ma zakresu wideo)
    --autostart on|off             Uruchamiaj z Runtime
    --route-online on|off          API modeli: przekazuj włączonym usługom online (domyślnie off, tylko lokalne)
    --route-nodes on|off           API modeli: przekazuj sparowanym węzłom (domyślnie off)
    --route-agent on|off           API modeli: przekazuj dostawcom agentów (domyślnie off)
    --max-concurrent <n>           API modeli: współbieżne żądania na klienta (domyślnie 4); ponad limit 429
    --read-only on|off             Tylko web: podgląd bez edycji, wiadomości i zadań
    --methods default|<method,…>   Tylko web: dozwolone metody (nazwy lub <namespace>.*), tylko zawężenie domyślnego zbioru
  baocut services mcp add-client <name>
                                   Utwórz token aplikacji zewnętrznej (pokazany raz);
                                   osobny na aplikację, cofany osobno
  baocut services mcp clients      Lista klientów (bez tokenów)
  baocut services mcp revoke <clientId>
                                   Cofnij klienta, token od razu nieważny
  baocut services mcp connection [clientId]
                                   Adres i fragment konfiguracji MCP z symbolem tokenu
  baocut services model-api add-client|clients|revoke|connection …
                                   Klienci API modeli (lokalny endpoint OpenAI), używane jak powyżej;
                                   tokeny niewymienne z MCP; connection pokazuje
                                   ustawianie OPENAI_BASE_URL i OPENAI_API_KEY
  baocut services model-api aliases
                                   Aliasy modeli (domyślnie whisper-1 → lokalny model transkrypcji)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Dodaj lub zmień alias; bez modelu używa domyślnego dostawcy
  baocut services model-api unalias <name>
                                   Usuń alias
  baocut services web sessions     Sesje przeglądarki (bez tokenów)
  baocut services web revoke <sessionId>
                                   Cofnij sesję przeglądarki, połączenie od razu rozłączone`,
  webHelp: `Użycie:
  baocut web open [--video <videoId>] [--launch]       Uruchom usługę internetową (port domyślny ${WEB_DEFAULT_PORT})
                                   i pokaż jednorazowy link ważny dwie minuty.
                                   --video otwiera wideo w edytorze (videoId z baocut videos list).
                                   --launch otwiera stronę logowania bez kodu w domyślnej przeglądarce;
                                   kod tylko w terminalu, do wklejenia na stronie logowania
                                   (kod nie jest przekazany w argumentach polecenia otwierania przeglądarki)`,
  usage:
    'Usage: baocut services [status | start <service> | stop <service>\n' +
    '       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                    [--read-only on|off] [--methods default|<method,…>]\n' +
    '       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '       | mcp|model-api connection [clientId]\n' +
    '       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' +
    '       | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `Nieznana usługa: ${id}. Dostępne: ${available.join(", ")}`,
  addClientUsage: (service) => `Użycie: baocut services ${service} add-client <name> (wybierz rozpoznawalną nazwę, np. ${service === 'mcp' ? "Claude Desktop" : "Narzędzie napisów"})`,
  aliasUsage: (capabilities) => `Użycie: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (możliwości: ${capabilities.join(", ")})`,
  unknownCapability: (capability, available) => `Nieznana możliwość: ${capability}. Dostępne: ${available.join(", ")}`,
  onOff: (flag) => `${flag} musi być on lub off`,
  portRange: "--port musi być liczbą całkowitą od 1 do 65535",
  levelChoice: (levels) => `--level musi być jedną z: ${levels.join(", ")}`,
  videosFormat: "--videos musi być all lub ID wideo oddzielone przecinkami",
  maxConcurrentRange: "--max-concurrent musi być liczbą całkowitą od 1 do 64",
  routingOnlyModelApi: "--route-online, --route-nodes, --route-agent i --max-concurrent tylko dla model-api",
  methodsFormat: "--methods musi być default lub nazwy metod i <namespace>.* oddzielone przecinkami",
  webOnlyFlags: "--read-only i --methods tylko dla usługi internetowej",
  nothingToConfigure: "Brak zmian: podaj --port, --level, --videos, --autostart, routing i współbieżność model-api lub --read-only i --methods dla web",
  states: {
    off: "Wyłączone",
    starting: "Uruchamianie",
    on: "Włączone",
    stopping: "Zatrzymywanie",
    error: "Błąd",
  },
  levels: {
    read: "read (tylko odczyt)",
    ask: "ask (potwierdzaj każdy zapis)",
    auto: "auto (działaj bezpośrednio)",
  },
  levelAskModelApi: "ask (potwierdzaj każde żądanie generowania)",
  notProvided: (serviceId, label) => `${serviceId}  ${label}  Niedostępne w tej wersji`,
  port: (port) => `port ${port}`,
  reason: (error) => `  Powód: ${error}`,
  nodeHint: "  Użyj baocut share dla portu, możliwości i parowania",
  autostart: (on) => `  Uruchamiaj z Runtime: ${on ? "tak" : "nie"}`,
  level: (level) => `  Poziom: ${level}`,
  levelScope: (level, scope) => `  Poziom: ${level}  Zakres: ${scope}`,
  allVideos: "wszystkie wideo",
  someVideos: (ids) => `${ids.length} wideo (${ids.join(', ')})`,
  routeLocal: "ten komputer",
  routeOnline: "usługi online",
  routeNodes: "Węzły sieci lokalnej",
  routeAgent: "agent",
  routing: (routes, maxConcurrent) => `  Routing do: ${routes.join(', ')}  Współbieżne żądania na klienta: ${maxConcurrent}`,
  aliases: (aliases) => `  Aliasy: ${aliases.length > 0 ? aliases.join(", ") : "brak"}`,
  clientCount: (count) => `  Klienci: ${count}`,
  web: (readOnly, methods) => `  Tylko odczyt: ${readOnly ? "tak" : "nie"}  Dozwolone metody: ${methods === null ? "domyślny zbiór" : methods.join(", ")}`,
  browserSessions: (count) => `  Sesje przeglądarki: ${count} (link dostępu: baocut web open)`,
  aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'default model'} (${capability})`,
  noAliases: "Brak aliasów. Dodaj przez baocut services model-api alias <name> <capability> <providerId>[/<modelId>]",
  noClients: (service) => `Brak klientów. Utwórz przez baocut services ${service} add-client <name>`,
  client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  utworzono ${createdAt}  ostatnio użyte ${lastUsedAt ?? 'never'}`,
  clientCreated: (name, clientId) => `Utworzono klienta ${name} (${clientId})`,
  tokenOnce: (token) => `Token (pokazany tylko raz; skopiuj i zapisz. Przy utracie cofnij klienta i utwórz nowego): ${token}`,
  address: (url) => `URL: ${url}`,
  bearerHeader: "Nagłówek: Authorization: Bearer <token>",
  header: (value) => `Nagłówek: Authorization: ${value}`,
  interfaceVersion: (version) => `Wersja interfejsu: ${version}`,
  snippetIntro: "Fragment konfiguracji (zastąp symbol tokenem otrzymanym przy tworzeniu klienta):",
  noWebSessions: "Brak sesji przeglądarki. Pobierz link przez baocut web open",
  webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  logowanie ${createdAt}  ostatnie użycie ${lastUsedAt}  wygasa ${expiresAt}  połączenia: ${connections}`,
  accessLinkNote: (expiresAt) => `Link jednorazowy, ważny do ${expiresAt}; nie udostępniaj. Po użyciu lub wygaśnięciu uruchom baocut web open ponownie`,
  badAccessLink: "Błędny format linku: zaktualizuj BaoCut lub ponów bez --launch",
  accessCode: (code) => `Kod dostępu: ${code}`,
  launchNote: (loginUrl, expiresAt) => `Wklej kod na stronie logowania w przeglądarce (${loginUrl}). Kod jednorazowy, ważny do ${expiresAt}; nie udostępniaj. Po użyciu lub wygaśnięciu uruchom baocut web open ponownie`,
  webNotStarted: (reason) => `Usługa internetowa nie uruchomiła się: ${reason}`,
  serviceError: (serviceId, reason) => `${serviceId} – niepowodzenie: ${reason}`,
  clientRevoked: (clientId) => `Cofnięto ${clientId}; token od razu nieważny`,
  webSessionRevoked: (sessionId) => `Cofnięto ${sessionId}; połączenie zamknięte`,
  browserFailed: (message) => `Nie udało się otworzyć przeglądarki: ${message}. Otwórz stronę logowania powyżej samodzielnie`,
};
