import type { SpaceMessages } from './space-copy.ts';
export const es: SpaceMessages = {
 kind: { video: 'Vídeo', export: 'Exportación', 'video-file': 'Material de vídeo', image: 'Imagen', audio: 'Audio', subtitle: 'Subtítulos', document: 'Documento', package: 'Paquete de vídeo', template: 'Plantilla' },
 categoryAll: 'Todo', favorite: 'Favoritos', trash: 'Papelera', sort: { created: 'Fecha de creación', updated: 'Fecha de actualización', recent: 'Actividad reciente', name: 'Nombre', kind: 'Tipo' },
 status: { generating: 'Generando', candidate: 'Candidato', applied: 'Aplicado', published: 'Publicado', 'source-changed': 'Origen cambiado', missing: 'Ausente', failed: 'Fallido' },
 statusAny: 'Todos los estados', statusNone: 'Sin estado', noProject: 'Fuera de un proyecto', removedProject: 'Proyecto eliminado', conversation: (title) => `Sesión «${title}»`,
 kindCount: (kind, n) => `${kind} ${n}`, foundFiles: (name, n) => (n === 1 ? `Coincide: ${name}` : `Coincide: ${name} y ${n - 1} más`), fileStatus: (kind, status) => `${kind}: ${status}`, filesStatus: (n, status) => `${n} ${n === 1 ? 'archivo' : 'archivos'}: ${status}`,
};
