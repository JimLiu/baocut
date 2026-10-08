import type { DriversCommonMessages } from './drivers-common.ts';
export const es: DriversCommonMessages = {
 executableMissing: (p) => `El ${p.command} especificado (${p.path}) no existe o no se puede ejecutar.`,
 commandMissing: (p) => `No se encontró el comando ${p.command}. ${p.hint}, o establece su ubicación en Ajustes.`,
 commandNotFound: (p) => `No se encontró el comando ${p.command}`, installItFirst: 'Instálalo primero', versionFailed: (p) => `${p.command} --version no terminó normalmente.`,
 outdated: (p) => `${p.name} ${p.version} es demasiado antiguo. BaoCut necesita ${p.min} o posterior.`,
 startFailed: (p) => `${p.name} no pudo iniciarse: ${p.error}`, openSessionFailed: (p) => `${p.name} no pudo abrir una sesión: ${p.error}`,
 confinedUnsupported: (p) => `${p.name} no admite llamadas puntuales restringidas`,
 resumeFailed: (p) => `No se pudo reanudar la sesión nativa de ${p.name}${p.error ? ` (${p.error})` : ''}. Se inició una sesión nueva; el agente no puede ver la conversación anterior.`,
 sessionClosed: (p) => `La sesión de ${p.name} está cerrada`, sessionNotReady: (p) => `La sesión de ${p.name} aún no está lista`, turnInProgress: 'El turno anterior aún no ha terminado',
 modelSwitchFailed: (p) => `${p.name} no pudo cambiar al modelo ${p.model}: ${p.error}`, timedOut: (p) => `${p.label} agotó el tiempo (${p.seconds} s)`,
 unknownError: 'Error desconocido', unknownReason: 'motivo desconocido', imagePlaceholder: '[Imagen]', officialScript: 'Script oficial',
};
