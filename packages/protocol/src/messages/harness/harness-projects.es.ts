import type { HarnessProjectsMessages } from './harness-projects.ts';
export const es: HarnessProjectsMessages = {
 conversationNotFound: (p) => `Sesión no encontrada: ${p.id}`, projectNotFound: (p) => `Proyecto no encontrado: ${p.id}`,
 folderInaccessible: (p) => `La carpeta no existe o no se puede acceder a ella: ${p.dir}`, markerReadFailed: (p) => `No se pudo leer el marcador del proyecto: ${p.error}`,
 markerNewer: (p) => `Este proyecto se creó con una versión más reciente de BaoCut (versión ${p.version} del marcador del proyecto). Actualiza BaoCut y ábrelo de nuevo`,
 untitledProject: 'Proyecto sin título', recoveredVideos: 'Vídeos recuperados', createFolderFailed: (p) => `No se pudo crear la carpeta del proyecto: ${p.error}`, tooManySameName: 'Demasiadas carpetas de proyecto tienen este nombre. Elige otro',
 markerNotWritable: (p) => `No se puede escribir en la carpeta del proyecto, por lo que no se pudo escribir el marcador .bcut/project.json: ${p.dir}`,
 markerWriteFailed: (p) => `No se pudo escribir el marcador del proyecto: ${p.error}`,
 sessionVideosOpen: (p) => `Algunos vídeos de esta sesión siguen abiertos: ${p.names}. Ciérralos y vuelve a intentarlo`,
 projectFolderMissing: (p) => `La carpeta del proyecto ya no está: ${p.dir}. Vuelve a ponerla en su sitio, ábrela desde su nueva ubicación o quita el proyecto de BaoCut`,
 projectVideosOpen: (p) => `Algunos vídeos de este proyecto siguen abiertos: ${p.names}. Ciérralos y vuelve a intentarlo`,
};
