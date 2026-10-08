import type { ModelsInstallMessages } from './models-install-copy.ts';
import { pluralForm } from '@baocut/protocol';
const KEEP = 'Se conserva lo descargado para continuar la próxima vez.';
const SOURCE = '«Origen de descarga de modelos» en «Ajustes › General»';
const filesEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'archivo', other: 'archivos' })}`;
const andEs = (items: readonly string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(items);
export const es: ModelsInstallMessages = {
 planSize: (size) => `Descarga ${size}`, planSizeEstimate: (size) => `Unos ${size} (se desconocen algunos tamaños de archivo, por lo que se usa la estimación registrada)`,
 amountEstimate: (size) => `Unos ${size}`,
 noSpace: (need, have) => `No hay suficiente espacio en disco: se necesitan ${need} y solo quedan ${have} en el disco de la carpeta de modelos. Libera espacio antes de descargar.`,
 resumed: (size) => `Se reutilizan los ${size} descargados la última vez, sin volver a descargarlos.`, space: (size) => `${size} libres en el disco`,
 lineKeep: 'Ya instalado, sin cambios', lineSize: (size, count) => `${size} · ${filesEs(count)}`, lineUnknown: (count) => `Tamaño desconocido · ${filesEs(count)}`,
 queued: 'En cola para descargar', downloading: (amount) => `Descargando ${amount}`, downloadingUnknown: (amount) => `Descargando · ${amount} recibidos`,
 verifying: 'Verificando y publicando', pausedKept: (amount) => `En pausa · ${amount} conservados; al reanudar continúa donde se quedó`, paused: 'En pausa',
 remedyNoSpace: (need, have) => `${need !== null && have !== null ? `Se necesitan ${need} y solo quedan ${have}. ` : ''}Libera espacio en disco y descarga de nuevo. ${KEEP}`,
 remedyNetwork: `Comprueba la red y descarga de nuevo. ${KEEP} Si no puedes acceder al origen predeterminado, cambia a un servidor espejo en ${SOURCE}.`,
 remedyIntegrity: `Los archivos del origen de descarga no coinciden con el tamaño o sha256 del manifiesto y se eliminaron los archivos incorrectos. Cambia a otro origen de descarga (${SOURCE}) y descarga de nuevo.`,
 remedySource: `El origen de descarga no tiene este archivo o denegó el acceso. Comprueba que el servidor espejo configurado en ${SOURCE} (o la variable de entorno BAOCUT_MODELS_ENDPOINT) esté completo.`,
 remedyManifest: 'Al manifiesto integrado de este paquete de modelos le falta un sha256 fiable, por lo que no se puede instalar hasta que BaoCut se actualice.',
 remedyOffline: 'El modo sin conexión estricto está activado, por lo que no se descarga nada. Para descargar, primero desactívalo en Ajustes.',
 remedySizeChanged: 'El tamaño de descarga cambió. Vuelve a confirmar con el plan nuevo.',
 remedyInUse: 'Una tarea está usando este paquete de modelos (transcribiendo, sintetizando, comprobando o instalando). Espera a que termine o cancélala en Tareas en segundo plano y vuelve a eliminar.',
 remedyUnavailable: 'El paquete de modelos no está disponible ahora (no está completamente instalado, está desactivado o no es compatible con este ordenador). Primero repáralo o actívalo de nuevo.',
 remedyInstallFailed: `Prueba a descargar de nuevo. ${KEEP}`,
 problemText: (message, remedy) => /[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`,
 removalBody: (unknown, frees, kept) => [
 unknown ? 'Elimina los archivos que solo usa este paquete de modelos.' : frees !== null ? `Libera unos ${frees}.` : null,
 ...kept.map((k) => `${k.repo} se conserva porque ${andEs(k.usedBy)} ${pluralForm('es', k.usedBy.length, { one: 'todavía lo usa', other: 'todavía lo usan' })}.`),
 'Para usarlo de nuevo, tendrás que volver a descargarlo.',
 ].filter(Boolean).join(' '),
 removed: (bundleId) => `Eliminado ${bundleId}`,
 removedKept: (bundleId, repos) => `Eliminado ${bundleId} · ${andEs(repos)} se conserva porque otros paquetes de modelos ${pluralForm('es', repos.length, { one: 'todavía lo usan', other: 'todavía los usan' })}`,
};
