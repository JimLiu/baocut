import type { SpaceMessages } from './space-copy.ts';
import { pluralForm } from '@baocut/protocol';
const countEs = (n: number, one: string, other: string) => `${n} ${pluralForm('es', n, { one, other })}`;
export const es: SpaceMessages = {
 help: `Uso:
  baocut space rescan              Explorar de nuevo las carpetas de origen
  baocut space rebuild             Reconstruir el catálogo de Space desde las carpetas de origen y los registros;
                                   el índice de contenido relee todos los vídeos en segundo plano
  baocut space trash|restore <entry id>
                                   Mover a la Papelera / restaurar desde ella (no se modifican los archivos;
                                   para elementos de vídeo, su carpeta entra / sale de la Papelera)
  baocut space purge <entry id>    Eliminar permanentemente un elemento de la Papelera; no se elimina mientras
                                   un vídeo o tarea lo siga usando, y se listan las referencias
  baocut space delete-video <entry id>
                                   Eliminar un vídeo: mueve su carpeta a la Papelera, restaurable durante
                                   el plazo de retención; no modifica los archivos originales de materiales vinculados
  baocut space continue <entry id> [--conversation <session id>]
                                   Continuar una sesión desde un elemento: una referencia (solo ID y metadatos) acompaña
                                   al siguiente mensaje; sin sesión se elige una según la ubicación del elemento o se crea`,
 usage: ['Uso: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>', '       baocut space continue <entry id> [--conversation <session id>]'].join('\n'), entryUsage: (action) => `Uso: baocut space ${action} <entry id>`, continueUsage: 'Uso: baocut space continue <entry id> [--conversation <session id>]', flagNotAccepted: (action, key) => `baocut space ${action} no acepta --${key}`, rescanStarted: 'Exploración iniciada', rebuilt: (entries, pendingVideos) => `Catálogo reconstruido: ${countEs(entries, 'elemento', 'elementos')}; el índice de contenido está releyendo ${countEs(pendingVideos, 'vídeo', 'vídeos')} en segundo plano, por lo que los resultados de búsqueda están incompletos hasta que termine`, purgeBlocked: (id) => `${id} sigue en uso por un vídeo o tarea; no se eliminó`, movedToTrash: (id, name) => `Movido a la Papelera: ${id}  ${name}`, restoredFromTrash: (id, name) => `Restaurado desde la Papelera: ${id}  ${name}`, purged: (id) => `Eliminado permanentemente ${id}`, notPurged: (id) => `No se eliminó ${id}: sigue referenciado`, videoTrashed: (name, entryId, retentionDays) => `Vídeo «${name}» movido a la Papelera: ${entryId} (restaura con baocut space restore ${entryId}${retentionDays === null ? '' : `; se elimina permanentemente después de ${countEs(retentionDays, 'día', 'días')}`})`, relatedKept: (n) => `${countEs(n, 'elemento', 'elementos')} exportados o generados a partir de él permanecen donde están`, continued: (created, id, cwd) => `${created ? 'Sesión creada' : 'Usando sesión'} ${id}  carpeta de trabajo ${cwd}`, referenceNext: (name, id) => `Una referencia al elemento «${name}» acompañará al siguiente mensaje: baocut chat "…" --conversation ${id}`,
};
