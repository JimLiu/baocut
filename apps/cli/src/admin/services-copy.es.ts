import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT, pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';
export const es: ServicesMessages = {
 accessLinkVideo: (video) => `Después de iniciar sesión, se abre directamente el editor del vídeo ${video}`,
 help: `Uso:
  baocut services [status]         Servicios externos: estado, dirección, nivel y ámbito del
                                   servicio MCP, API de modelos, servicio web y nodo de LAN
  baocut services start <service>  Iniciar un servicio (mcp, model-api, web, node)
  baocut services stop <service>   Detener un servicio (desconecta conexiones externas y cancela
                                   solicitudes pendientes de confirmación; las tareas enviadas terminan)
  baocut services configure <service> [options]
    --port <port>                  Puerto de escucha (solo bucle local; MCP usa ${MCP_DEFAULT_PORT} y API de modelos
                                   ${MODEL_API_DEFAULT_PORT}); si está ocupado, informa de error sin cambiar de puerto
    --level read|ask|auto          read es solo lectura; ask pide confirmar cada escritura, tarea
                                   y generación en BaoCut (predeterminado); auto las ejecuta directamente
    --videos all|<id,…>            Exponer todos los vídeos o solo estos videoIds (separados por comas); los vídeos fuera
                                   del ámbito no son visibles externamente (API de modelos no tiene ámbito)
    --autostart on|off             Iniciar con el Runtime
    --route-online on|off          API de modelos: reenviar a servicios en línea activados (off por defecto, solo modelos locales)
    --route-nodes on|off           API de modelos: reenviar a nodos de LAN emparejados (off por defecto)
    --route-agent on|off           API de modelos: reenviar a proveedores de agentes (off por defecto)
    --max-concurrent <n>           API de modelos: solicitudes en curso por cliente (4 por defecto); el exceso recibe 429
    --read-only on|off             Solo web: el navegador solo puede ver, no editar, enviar mensajes ni tareas
    --methods default|<method,…>   Solo web: lista de métodos permitidos (nombres o <namespace>.*), solo restringe el conjunto predeterminado
  baocut services mcp add-client <name>
                                   Crear un token para una aplicación externa (se muestra solo
                                   una vez); uno por aplicación, cada uno revocable por separado
  baocut services mcp clients      Listar clientes creados (sin tokens)
  baocut services mcp revoke <clientId>
                                   Revocar un cliente; su token deja de funcionar inmediatamente
  baocut services mcp connection [clientId]
                                   Imprimir la dirección y un fragmento para pegar en la configuración
                                   de un cliente MCP (con un marcador para el token)
  baocut services model-api add-client|clients|revoke|connection …
                                   Clientes de API de modelos (endpoint local de estilo OpenAI),
                                   uso como arriba; sus tokens no son intercambiables con los MCP;
                                   connection imprime cómo establecer OPENAI_BASE_URL y OPENAI_API_KEY
  baocut services model-api aliases
                                   Listar alias de modelos (por defecto whisper-1 → modelo local predeterminado de transcripción)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Añadir o cambiar un alias; sin modelo usa el predeterminado del proveedor
  baocut services model-api unalias <name>
                                   Eliminar un alias
  baocut services web sessions     Listar sesiones de navegador (sin tokens de sesión)
  baocut services web revoke <sessionId>
                                   Revocar una sesión de navegador: su conexión se interrumpe inmediatamente`,
 webHelp: `Uso:
  baocut web open [--video <videoId>] [--launch]       Iniciar el servicio web (puerto predeterminado ${WEB_DEFAULT_PORT}) e imprimir un enlace de acceso de un solo uso;
                                   funciona una vez durante dos minutos. --video abre ese vídeo en el editor (videoId procede de
                                   baocut videos list). --launch abre una página de inicio de sesión sin código en el navegador
                                   predeterminado; el código solo se imprime en el terminal para pegarlo en la página de inicio de sesión
                                   (no se pasa en los argumentos del comando que abre el navegador)`,
 usage: 'Uso: baocut services [status | start <service> | stop <service>\n       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n                    [--read-only on|off] [--methods default|<method,…>]\n       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n       | mcp|model-api connection [clientId]\n       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n       | web sessions | web revoke <sessionId>]',
 unknownService: (id, available) => `Servicio desconocido: ${id}. Disponibles: ${available.join(', ')}`, addClientUsage: (service) => `Uso: baocut services ${service} add-client <name> (elige un nombre reconocible, por ejemplo ${service === 'mcp' ? 'Claude Desktop' : 'Herramienta de subtítulos'})`, aliasUsage: (capabilities) => `Uso: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (capacidades: ${capabilities.join(', ')})`, unknownCapability: (capability, available) => `Capacidad desconocida: ${capability}. Disponibles: ${available.join(', ')}`, onOff: (flag) => `${flag} debe ser on u off`, portRange: '--port debe ser un entero entre 1 y 65535', levelChoice: (levels) => `--level debe ser uno de: ${levels.join(', ')}`, videosFormat: '--videos debe ser all o ID de vídeos separados por comas', maxConcurrentRange: '--max-concurrent debe ser un entero entre 1 y 64', routingOnlyModelApi: '--route-online, --route-nodes, --route-agent y --max-concurrent solo se aplican a model-api', methodsFormat: '--methods debe ser default o nombres de métodos y <namespace>.* separados por comas', webOnlyFlags: '--read-only y --methods solo se aplican al servicio web', nothingToConfigure: 'Nada que cambiar: proporciona --port, --level, --videos, --autostart, enrutamiento y concurrencia de model-api, o --read-only y --methods para web',
 states: { off: 'Desactivado', starting: 'Iniciando', on: 'Activado', stopping: 'Deteniendo', error: 'Error' }, levels: { read: 'read (solo lectura)', ask: 'ask (confirmar cada escritura)', auto: 'auto (ejecutar directamente)' }, levelAskModelApi: 'ask (confirmar cada solicitud de generación)', notProvided: (serviceId, label) => `${serviceId}  ${label}  No disponible en esta versión`, port: (port) => `puerto ${port}`, reason: (error) => `  Motivo: ${error}`, nodeHint: '  Usa baocut share para el puerto, capacidades y emparejamiento', autostart: (on) => `  Iniciar con el Runtime: ${on ? 'sí' : 'no'}`, level: (level) => `  Nivel: ${level}`, levelScope: (level, scope) => `  Nivel: ${level}  Ámbito: ${scope}`, allVideos: 'todos los vídeos', someVideos: (ids) => `${ids.length} ${pluralForm('es', ids.length, { one: 'vídeo', other: 'vídeos' })} (${ids.join(', ')})`, routeLocal: 'este ordenador', routeOnline: 'servicios en línea', routeNodes: 'nodos de LAN', routeAgent: 'agente', routing: (routes, maxConcurrent) => `  Reenvía a: ${routes.join(', ')}  ${maxConcurrent} ${pluralForm('es', maxConcurrent, { one: 'solicitud simultánea', other: 'solicitudes simultáneas' })} por cliente`, aliases: (aliases) => `  Alias: ${aliases.length > 0 ? aliases.join(', ') : 'ninguno'}`, clientCount: (count) => `  Clientes: ${count}`, web: (readOnly, methods) => `  Solo lectura: ${readOnly ? 'sí' : 'no'}  Métodos permitidos: ${methods === null ? 'conjunto predeterminado' : methods.join(', ')}`, browserSessions: (count) => `  Sesiones de navegador: ${count} (enlace de acceso: baocut web open)`, aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'modelo predeterminado'} (${capability})`, noAliases: 'Sin alias. Añade uno con baocut services model-api alias <name> <capability> <providerId>[/<modelId>]', noClients: (service) => `Sin clientes. Crea uno con baocut services ${service} add-client <name>`, client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  creado ${createdAt}  último uso ${lastUsedAt ?? 'nunca'}`, clientCreated: (name, clientId) => `Cliente creado ${name} (${clientId})`, tokenOnce: (token) => `Token (se muestra solo esta vez; cópialo y guárdalo ahora. Si lo pierdes, revoca el cliente y crea otro): ${token}`, address: (url) => `URL: ${url}`, bearerHeader: 'Encabezado: Authorization: Bearer <token>', header: (value) => `Encabezado: Authorization: ${value}`, interfaceVersion: (version) => `Versión de interfaz: ${version}`, snippetIntro: 'Fragmento de configuración (reemplaza el marcador del token con el obtenido al crear el cliente):',
 noWebSessions: 'Sin sesiones de navegador. Obtén un enlace de acceso con baocut web open', webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  sesión iniciada ${createdAt}  último uso ${lastUsedAt}  caduca ${expiresAt}  ${connections} ${pluralForm('es', connections, { one: 'conexión', other: 'conexiones' })}`, accessLinkNote: (expiresAt) => `Este enlace funciona una vez y es válido hasta ${expiresAt}; no lo compartas. Una vez usado o caducado, ejecuta baocut web open de nuevo`, badAccessLink: 'El enlace de acceso no tiene el formato esperado: actualiza BaoCut o ejecuta de nuevo sin --launch', accessCode: (code) => `Código de acceso: ${code}`, launchNote: (loginUrl, expiresAt) => `Pega este código en la página de inicio de sesión abierta en tu navegador (${loginUrl}). Funciona una vez y es válido hasta ${expiresAt}; no lo compartas. Una vez usado o caducado, ejecuta baocut web open de nuevo`, webNotStarted: (reason) => `El servicio web no se inició: ${reason}`, serviceError: (serviceId, reason) => `${serviceId} falló: ${reason}`, clientRevoked: (clientId) => `Revocado ${clientId}; su token deja de funcionar inmediatamente`, webSessionRevoked: (sessionId) => `Revocada ${sessionId}; su conexión se cerró`, browserFailed: (message) => `No se pudo abrir el navegador: ${message}. Abre la página de inicio de sesión de arriba tú`,
};
