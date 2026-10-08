import type { SpaceActionsMessages } from './space-actions-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: SpaceActionsMessages = {
 edit: { video: 'Abrir vídeo', 'source-video': 'Editar en el vídeo de origen', 'new-video': 'Nuevo vídeo a partir de este material', text: 'Editar texto', version: 'Guardar una copia y editar' },
 trashed: 'Primero restaura este elemento de la Papelera', editGenerating: 'Aún se está generando; podrás editarlo al terminar',
 editMissing: 'Archivo no encontrado; vuelve a conectarlo antes de editar', editFailed: 'La generación falló; no hay un archivo que editar',
 editPackage: 'Los paquetes de vídeo (paquetes portables) no se pueden editar',
 editText: 'Aún no se puede guardar una nueva versión del texto aquí; continúa en una sesión y deja que el agente lo cambie',
 editVersion: 'Aún no se pueden editar manualmente imágenes, audio ni plantillas; continúa en una sesión y deja que el agente los cambie',
 newVideoOutside: 'Este archivo no está en una carpeta de proyecto o sesión, por lo que aún no se puede usar para un vídeo nuevo',
 packageGenerating: 'Aún se está exportando; podrás abrirlo al terminar', packageMissing: 'No se encuentra este archivo',
 packageFailed: 'La exportación falló; no hay un paquete que abrir',
 packageOutside: 'Este paquete no está en una carpeta de proyecto o sesión, por lo que aún no se puede abrir',
 continueTrashed: 'Restaura este elemento de la Papelera antes de llevarlo a una sesión',
 purgeGenerating: 'La tarea sigue en curso; primero cancélala en la página Tareas', purgeNotTrashed: 'Primero muévelo a la Papelera y después elimínalo de ella',
 referenceKind: { 'video-asset': 'Material de vídeo', job: 'Tarea en curso', unverified: 'No se puede confirmar', 'user-file': 'Otros archivos en la carpeta del vídeo' },
 importAllFailed: (count, error) => `No se importó ninguno de los ${count} archivos: ${error}`,
 importFailed: (error) => `Sin importar: ${error}`,
 imported: (count) => `${pluralForm('es', count, { one: `Importado ${count} material`, other: `Importados ${count} materiales` })}`,
 copiedAll: 'copiados en imports/ del proyecto', copiedSome: (count) => `${count} copiados en imports/ del proyecto`,
 notImported: (count) => `${count} sin importar`,
 references: (names, total) => {
 const quoted = names.map((name) => `«${name}»`).join(', ');
 return total > names.length ? `Elementos de Space ${quoted} y ${total - names.length} más` : `${pluralForm('es', total, { one: 'Elemento', other: 'Elementos' })} de Space ${quoted}`;
 },
 referenceOutput: 'Resultado',
};
