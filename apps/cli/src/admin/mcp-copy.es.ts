import type { McpMessages } from './mcp-copy.ts';
export const es: McpMessages = {
 previousClientUnknown: 'No se pudo identificar el cliente usado por el elemento reemplazado, por lo que no se revocó ningún cliente: baocut mcp status lista los clientes existentes; revoca los que no se usen con baocut services mcp revoke <clientId>', defaultProjectRegistered: (name, path) => `BaoCut no tenía proyectos: se registró el proyecto predeterminado «${name}» (${path}) para que los agentes externos creen vídeos en él`,
 help: `Uso:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--transport stdio|http] [--level ask|auto] [--name <client name>] [--yes]
                                   Conectar un agente externo al servicio MCP de BaoCut: iniciar el servicio (y con el
                                   Runtime), crear un cliente y token nuevos para el agente y escribir dirección y token en
                                   su configuración MCP (entrada baocut); después reiniciar el agente
                                   Si BaoCut no tiene proyectos, registrar el proyecto CLI en la carpeta predeterminada de proyectos
    --transport stdio|http         stdio (predeterminado): el agente ejecuta baocut mcp serve --stdio, que encuentra o inicia el
                                   Runtime de BaoCut por sí mismo; http: escribe la dirección del servicio, que solo funciona con el Runtime en ejecución
    --level ask|auto               Nivel de acceso: ask pide confirmar cada escritura y tarea en BaoCut (predeterminado del servicio);
                                   auto las ejecuta directamente. Si se omite, se conserva el nivel actual
    --name <client name>           Nombre del cliente en BaoCut (por defecto el del agente); se puede revocar por separado
    --yes                          Si ya hay una entrada baocut en la configuración, reemplazarla y revocar su cliente anterior
                                   (identificado por el token anterior; si no se identifica, se listan los clientes del mismo nombre
                                   para que decidas cuáles revocar). Sin él, no se sobrescribe nada ni se crea un cliente
  Dónde se guarda el token: Claude Code lo guarda en env (BAOCUT_MCP_TOKEN) de ~/.claude/settings.json y la configuración solo lo referencia.
  Codex (~/.codex/config.toml), Cursor (~/.cursor/mcp.json) y Gemini CLI (~/.gemini/settings.json) no tienen un lugar para variables
  de entorno, por lo que el token se escribe en texto plano en su configuración: no confirmes ni compartas estos archivos y prefiere
  el nivel ask; si se filtra un token, revócalo con baocut services mcp revoke <clientId>.
  El servicio solo está disponible mientras se ejecuta el Runtime de BaoCut (abre BaoCut o ejecuta baocut runtime ensure).
  baocut mcp status                Estado, dirección, nivel y clientes del servicio MCP, y si la configuración de cada agente tiene
                                   una entrada baocut (sin tokens)
  baocut mcp serve --stdio         Lo que ejecuta la entrada stdio: un servidor MCP stdio que reenvía al servicio MCP con el token de
                                   BAOCUT_MCP_TOKEN y encuentra o inicia el Runtime cuando hace falta. Lo ejecuta el agente, no una terminal`,
 entryExists: (file, entry) => `${file} ya tiene una entrada ${entry}; no se cambió nada. Añade --yes para reemplazarla`, serviceNotAvailable: 'Esta versión de BaoCut no ofrece el servicio MCP', serviceStartFailed: (reason) => `El servicio MCP no se inició: ${reason ?? 'motivo desconocido'}`, connected: (host, url) => `${host} conectado al servicio MCP de BaoCut: ${url}`, configEnv: (configFile, envFile, envVar) => `Configuración: ${configFile} (el token está en env.${envVar} de ${envFile}; la configuración solo lo referencia)`, configPlaintext: (configFile, clientId) => `Configuración: ${configFile} (el token está escrito en texto plano en este archivo: no lo confirmes ni compartas; si se filtra, revócalo con baocut services mcp revoke ${clientId})`, clientLine: (name, clientId, level) => `Cliente: ${name} (${clientId})  Nivel: ${level ?? '—'}`, restartHint: (host) => `Reinicia ${host} para que se aplique. El servicio se ejecuta con el Runtime de BaoCut: si no está en ejecución, abre BaoCut o ejecuta baocut runtime ensure primero`, replacedRevoked: (name, clientId) => `Se reemplazó la entrada anterior y se revocó su cliente: ${name} (${clientId})`, replacedRevokeFailed: (reason) => `Se reemplazó la entrada anterior, pero no se pudo revocar su cliente: ${reason}`, oldClientRemains: (ids) => `El cliente anterior sigue ahí: ${ids.join(', ')}. Si ya no se usa: baocut services mcp revoke <clientId>`, sameNameClientsRemain: (ids, unrecognized) => `${unrecognized ? 'No se pudo identificar el cliente de la entrada anterior; los clientes' : 'Los clientes'} del mismo nombre siguen ahí: ${ids.join(', ')}. Si ya no se usan: baocut services mcp revoke <clientId>`, hostsHeading: (entry) => `Si la configuración de cada agente tiene una entrada ${entry}:`, hostUnreadable: (problem) => `no se puede leer (${problem})`, hostConfigured: 'sí', hostNotConfigured: 'no', noServiceStatus: 'El Runtime no informó del estado del servicio MCP', levelChoice: (value) => `--level debe ser ask o auto: ${value}`,
  connectedStdio: (host, command) => `${host} conectado al servicio MCP de BaoCut por stdio: ${host} ejecuta ${command}`,
  configEnvInherited: (configFile, envFile, envVar) => `Configuración: ${configFile} (el token está en env.${envVar} de ${envFile}; el comando lo hereda de ahí)`,
  restartHintStdio: (host) => `Reinicia ${host} para que se aplique. ${host} ejecuta el comando por sí mismo, y el comando inicia el Runtime de BaoCut si no está en ejecución`,
  transportChoice: (value) => `--transport debe ser stdio o http: ${value}`,
  serveTokenMissing: (envVar) => `${envVar} no está definido, así que no hay token para el servicio MCP de BaoCut: ejecuta baocut mcp install --agent <agent> para escribirlo en la configuración MCP del agente`,
  serveServiceOff: 'El servicio MCP de BaoCut está desactivado: actívalo en BaoCut o ejecuta baocut services configure mcp --autostart on',
  serveTokenRejected: 'El servicio MCP de BaoCut rechazó el token (revocado o emitido por otro Runtime Home): vuelve a ejecutar baocut mcp install --agent <agent> --yes',
  serveRuntimeLost: 'El Runtime de BaoCut se detuvo mientras atendía esta solicitud; no se reintentó',
  serveRuntimeUnavailable: (reason) => `No se puede contactar con el Runtime de BaoCut: ${reason}`,
  serveHttpStatus: (status) => `El servicio MCP de BaoCut respondió HTTP ${status}`,
};
