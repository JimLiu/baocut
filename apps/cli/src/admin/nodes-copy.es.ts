import type { NodesMessages } from './nodes-copy.ts';
export const es: NodesMessages = {
 nodesHelp: (port) => `Uso:
  baocut nodes                     Listar nodos de LAN emparejados (cada uno con comprobación en vivo)
  baocut nodes discover            Explorar nodos de LAN que comparten capacidades (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Emparejar con el código de Compartir este ordenador del otro
                                   ordenador; el puerto predeterminado es ${port}
  baocut nodes remove <nodeId|alias>
                                   Eliminar el nodo y token recordados en este ordenador`,
 noPairedNodes: 'No hay nodos emparejados. Empareja uno con baocut nodes pair <address[:port]> <pairing code>', noNodesDiscovered: 'No se encontraron nodos que compartan capacidades (explorar solo funciona en macOS; también puedes emparejar introduciendo una dirección)', pairUsage: 'Uso: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]', removeUsage: 'Uso: baocut nodes remove <nodeId|alias>', paired: (description) => `Emparejado: ${description}`, noSuchNode: (ref) => `No hay un nodo emparejado: ${ref}`, removed: (alias, nodeId) => `Eliminado ${alias} (${nodeId})`, invalidPort: (port) => `Puerto no válido: ${port}`,
 shareHelp: (port, capabilities) => `Uso:
  baocut share [status]            Estado de Compartir este ordenador: dirección, puerto,
                                   interruptores de capacidades, código de emparejamiento, ordenadores emparejados
  baocut share start [options]     Empezar a compartir y generar un código de emparejamiento
    --port <port>                  Predeterminado ${port}
    --name <name>                  Nombre que ven otros; por defecto, el nombre del host
    --allow-any-source             Aceptar cualquier dirección de origen (solo direcciones LAN por defecto)
  baocut share stop                Dejar de compartir (cancela tareas enviadas por otros)
  baocut share code                Invalidar el código anterior y generar uno nuevo
  baocut share revoke <clientId>   Revocar un ordenador emparejado
  baocut share capability <capability> <on|off>
                                   Activar o desactivar compartir una capacidad (${capabilities.join(', ')}), con efecto
                                   inmediato: al desactivar, se rechazan las tareas nuevas de otros; las tareas
                                   ya aceptadas se ejecutan hasta terminar`,
 portRange: '--port debe ser un entero entre 0 y 65535', shareRevokeUsage: 'Uso: baocut share revoke <clientId>', capabilityLabels: { transcribe: 'Transcripción' }, capabilityUsage: 'Uso: baocut share capability <capability> <on|off> (p. ej., baocut share capability transcribe off)', shareOff: 'Desactivado', shareOn: 'Activado', shareNotListening: (error) => `Activado, pero sin escuchar${error ? `: ${error}` : ''}`, shareState: (state) => `Compartir este ordenador: ${state}`, name: (name, nodeId) => `Nombre: ${name}${nodeId ? ` (${nodeId})` : ''}`, port: (port, anySource) => `Puerto: ${port}${anySource ? ' (cualquier dirección de origen)' : ''}`, addresses: (addresses) => `Direcciones: ${addresses ?? '(sin dirección de red local)'}`, capabilitiesHead: (empty) => `Capacidades: ${empty ? 'ninguna' : ''}`, capabilityLine: (label, capability, enabled) => `  ${label} (${capability}): ${enabled ? 'activada' : `desactivada (activa con baocut share capability ${capability} on)`}`, pairingCode: (code, until) => `Código de emparejamiento: ${code} (válido hasta ${until})`, pairingLocked: (until) => `El emparejamiento está bloqueado hasta ${until} (baocut share code lo desbloquea ahora)`, noPairingCode: 'Código de emparejamiento: ninguno (baocut share code crea uno)', clientsHead: (empty) => `Ordenadores emparejados: ${empty ? 'ninguno' : ''}`, clientLine: (name, clientId, pairedAt, lastSeenAt) => `  ${name}  ${clientId}  emparejado ${pairedAt}${lastSeenAt ? `  última conexión ${lastSeenAt}` : ''}`, remoteTasks: (running, queued) => `Tareas remotas: ${running} en curso, ${queued} en cola`, unreachable: 'No se puede conectar', versionMismatch: 'Versión de protocolo incompatible', unpaired: 'Emparejamiento ya no válido (empareja de nuevo)', available: 'Disponible', transcribeReady: (bundles, running, queued) => `Disponible · modelos ${bundles.length > 0 ? bundles.join(', ') : 'ninguno'} · ${running} en curso, ${queued} en cola`, transcribeOff: 'No disponible · el nodo desactivó compartir transcripción (actívalo en ese ordenador)',
};
