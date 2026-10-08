import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT, pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';
export const it: ServicesMessages = {
 accessLinkVideo: (video) => `Dopo l’accesso si apre direttamente l’editor del video ${video}`,
 help: `Uso:
  baocut services [status]         Servizi esterni: stato, indirizzo, livello e ambito del
                                   servizio MCP, API dei modelli, servizio web e nodo LAN
  baocut services start <service>  Avvia un servizio (mcp, model-api, web, node)
  baocut services stop <service>   Interrompe un servizio (scollega connessioni esterne e annulla richieste
                                   in attesa di conferma; le attività già inviate terminano)
  baocut services configure <service> [options]
    --port <port>                  Porta di ascolto (solo loopback; MCP usa ${MCP_DEFAULT_PORT}, l’API dei modelli
                                   ${MODEL_API_DEFAULT_PORT}); se occupata il servizio segnala errore, senza cambiare porta
    --level read|ask|auto          read è sola lettura; ask richiede conferma in BaoCut per ogni scrittura, attività
                                   e generazione (predefinito); auto le esegue direttamente
    --videos all|<id,…>            Espone tutti i video o solo questi videoIds (separati da virgole); quelli fuori
                                   ambito non sono visibili esternamente (l’API dei modelli non ha ambito)
    --autostart on|off             Avvia con il Runtime
    --route-online on|off          API dei modelli: inoltra ai servizi online attivi (disattivato per default, solo modelli locali)
    --route-nodes on|off           API dei modelli: inoltra a nodi LAN abbinati (disattivato per default)
    --route-agent on|off           API dei modelli: inoltra a provider di agenti (disattivato per default)
    --max-concurrent <n>           API dei modelli: richieste contemporanee per client (default 4); oltre il limite restituisce 429
    --read-only on|off             Solo web: il browser può solo vedere, non modificare, inviare messaggi o attività
    --methods default|<method,…>   Solo web: metodi consentiti (nomi o <namespace>.*), solo riduzione dell’insieme predefinito
  baocut services mcp add-client <name>
                                   Crea un token per un’app esterna (mostrato solo
                                   una volta); uno per app, ciascuno revocabile separatamente
  baocut services mcp clients      Elenca i client creati (senza token)
  baocut services mcp revoke <clientId>
                                   Revoca un client; il token smette subito di funzionare
  baocut services mcp connection [clientId]
                                   Stampa indirizzo e frammento da incollare nella configurazione
                                   di un client MCP (con segnaposto del token)
  baocut services model-api add-client|clients|revoke|connection …
                                   Client dell’API dei modelli (endpoint locale in stile OpenAI),
                                   uso come sopra; i token non sono intercambiabili con quelli MCP;
                                   connection mostra come impostare OPENAI_BASE_URL e OPENAI_API_KEY
  baocut services model-api aliases
                                   Elenca alias dei modelli (default whisper-1 → modello locale di trascrizione predefinito)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Aggiunge o cambia un alias; senza modello usa il predefinito del provider
  baocut services model-api unalias <name>
                                   Elimina un alias
  baocut services web sessions     Elenca sessioni browser (senza token di sessione)
  baocut services web revoke <sessionId>
                                   Revoca una sessione browser: connessione interrotta subito`,
 webHelp: `Uso:
  baocut web open [--video <videoId>] [--launch]       Avvia il servizio web (porta predefinita ${WEB_DEFAULT_PORT}) e stampa un link di accesso monouso;
                                   funziona una volta per due minuti. --video apre direttamente quel video nell’editor (videoId da
                                   baocut videos list). --launch apre una pagina di accesso senza codice nel browser predefinito;
                                   il codice è stampato solo nel terminale, da incollare nella pagina di accesso
                                   (non passato negli argomenti del comando che apre il browser)`,
 usage: 'Uso: baocut services [status | start <service> | stop <service>\n' +
 '       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
 '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
 '                    [--read-only on|off] [--methods default|<method,…>]\n' +
 '       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
 '       | mcp|model-api connection [clientId]\n' +
 '       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' +
 '       | web sessions | web revoke <sessionId>]',
 unknownService: (id, available) => `Servizio sconosciuto: ${id}. Disponibili: ${available.join(', ')}`, addClientUsage: (service) => `Uso: baocut services ${service} add-client <name> (scegli un nome riconoscibile, es. ${service === 'mcp' ? 'Claude Desktop' : 'Strumento sottotitoli'})`, aliasUsage: (capabilities) => `Uso: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (capacità: ${capabilities.join(', ')})`, unknownCapability: (capability, available) => `Capacità sconosciuta: ${capability}. Disponibili: ${available.join(', ')}`, onOff: (flag) => `${flag} deve essere on o off`, portRange: '--port deve essere un intero da 1 a 65535', levelChoice: (levels) => `--level deve essere uno tra ${levels.join(', ')}`, videosFormat: '--videos deve essere all o ID video separati da virgole', maxConcurrentRange: '--max-concurrent deve essere un intero da 1 a 64', routingOnlyModelApi: '--route-online, --route-nodes, --route-agent e --max-concurrent valgono solo per model-api', methodsFormat: '--methods deve essere default o nomi di metodi e <namespace>.* separati da virgole', webOnlyFlags: '--read-only e --methods valgono solo per il servizio web', nothingToConfigure: 'Nulla da cambiare: specifica --port, --level, --videos, --autostart, instradamento e concorrenza di model-api oppure --read-only e --methods per web', states: { off: 'Disattivato', starting: 'Avvio', on: 'Attivo', stopping: 'Interruzione', error: 'Errore' }, levels: { read: 'read (sola lettura)', ask: 'ask (conferma ogni scrittura)', auto: 'auto (esegui direttamente)' }, levelAskModelApi: 'ask (conferma ogni richiesta di generazione)', notProvided: (serviceId, label) => `${serviceId}  ${label}  Non disponibile in questa versione`, port: (port) => `porta ${port}`, reason: (error) => `  Motivo: ${error}`, nodeHint: '  Usa baocut share per porta, capacità e abbinamento', autostart: (on) => `  Avvia con il Runtime: ${on ? 'sì' : 'no'}`, level: (level) => `  Livello: ${level}`, levelScope: (level, scope) => `  Livello: ${level}  Ambito: ${scope}`, allVideos: 'tutti i video', someVideos: (ids) => `${ids.length} video (${ids.join(', ')})`, routeLocal: 'questo computer', routeOnline: 'servizi online', routeNodes: 'nodi LAN', routeAgent: 'agente', routing: (routes, maxConcurrent) => `  Inoltra a: ${routes.join(', ')}  ${maxConcurrent} ${pluralForm('it', maxConcurrent, { one: 'richiesta contemporanea', other: 'richieste contemporanee' })} per client`, aliases: (aliases) => `  Alias: ${aliases.length > 0 ? aliases.join(', ') : 'nessuno'}`, clientCount: (count) => `  Client: ${count}`, web: (readOnly, methods) => `  Sola lettura: ${readOnly ? 'sì' : 'no'}  Metodi consentiti: ${methods === null ? 'insieme predefinito' : methods.join(', ')}`, browserSessions: (count) => `  Sessioni browser: ${count} (link di accesso: baocut web open)`, aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'modello predefinito'} (${capability})`, noAliases: 'Nessun alias. Aggiungine uno con baocut services model-api alias <name> <capability> <providerId>[/<modelId>]', noClients: (service) => `Nessun client. Creane uno con baocut services ${service} add-client <name>`, client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  creato ${createdAt}  ultimo utilizzo ${lastUsedAt ?? 'mai'}`, clientCreated: (name, clientId) => `Client ${name} creato (${clientId})`, tokenOnce: (token) => `Token (mostrato una sola volta; copialo e salvalo ora. Se lo perdi, revoca il client e creane uno nuovo): ${token}`, address: (url) => `URL: ${url}`, bearerHeader: 'Header: Authorization: Bearer <token>', header: (value) => `Header: Authorization: ${value}`, interfaceVersion: (version) => `Versione dell’interfaccia: ${version}`, snippetIntro: 'Frammento di configurazione (sostituisci il segnaposto del token con quello ricevuto alla creazione del client):', noWebSessions: 'Nessuna sessione browser. Ottieni un link con baocut web open', webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  accesso ${createdAt}  ultimo utilizzo ${lastUsedAt}  scade ${expiresAt}  ${connections} ${pluralForm('it', connections, { one: 'connessione', other: 'connessioni' })}`, accessLinkNote: (expiresAt) => `Questo link funziona una volta ed è valido fino a ${expiresAt}; non condividerlo. Dopo uso o scadenza esegui di nuovo baocut web open`, badAccessLink: 'Il link di accesso non ha il formato previsto: aggiorna BaoCut o esegui di nuovo senza --launch', accessCode: (code) => `Codice di accesso: ${code}`, launchNote: (loginUrl, expiresAt) => `Incolla questo codice nella pagina di accesso aperta nel browser (${loginUrl}). Funziona una volta ed è valido fino a ${expiresAt}; non condividerlo. Dopo uso o scadenza esegui di nuovo baocut web open`, webNotStarted: (reason) => `Servizio web non avviato: ${reason}`, serviceError: (serviceId, reason) => `${serviceId} non riuscito: ${reason}`, clientRevoked: (clientId) => `${clientId} revocato; il token smette subito di funzionare`, webSessionRevoked: (sessionId) => `${sessionId} revocata; connessione chiusa`, browserFailed: (message) => `Impossibile aprire il browser: ${message}. Apri manualmente la pagina di accesso sopra`,
};
