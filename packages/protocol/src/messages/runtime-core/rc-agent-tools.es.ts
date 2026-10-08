import type { RcAgentToolsMessages } from './rc-agent-tools.ts';
import { pluralForm } from '../../i18n.ts';
function exportKindLabel(kind: string): string { return ({ subtitles: 'subtítulos', transcript: 'transcripción', audio: 'audio', video: 'archivo de vídeo', portable: 'paquete portable', project: 'archivo de proyecto' } as Record<string, string>)[kind] ?? kind; }
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
 const recognition = `${p.language ? `, idioma ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
 if (p.target === 'create') return `, crear un vídeo${p.name ? ` «${p.name}»` : ' (con el título de la página como nombre)'} y añadirlo a la línea de tiempo${p.transcribe ? `, después transcribirlo${recognition}${p.captions ? ' y crear una capa de subtítulos' : ''}` : ''}`;
 if (p.target === 'video') return `, importarlo al vídeo${p.transcribe ? ' y transcribirlo' : ''}`;
 if (p.target === 'project') return `, guardar en downloads/ del proyecto${p.transcribe ? ' y transcribir a TXT y SRT' : ''}`;
 if (p.target === 'download') return `, guardar en la carpeta Descargas${p.transcribe ? ' y transcribir a TXT y SRT' : ''}`;
 return '';
}
const countEs = (n: number, one: string, other: string) => `${n} ${pluralForm('es', n, { one, other })}`;
export const es: RcAgentToolsMessages = {
 instructionsNotSet: 'No se han establecido las instrucciones de la sesión: el orden de montaje del Runtime es incorrecto', listSeparator: ', ', clauseSeparator: '; ',
 createVideoSummary: (p) => `Crear el vídeo «${p.name}»`, editsSummary: (p) => `${p.label} (${countEs(p.count, 'operación', 'operaciones')}: ${p.types})`, captionsSummary: (p) => `Añadir una capa de subtítulos${p.bilingual ? ' bilingües' : ''} para el documento ${p.documentId}`, captionsLabel: 'Añadir capa de subtítulos', undoSummary: (p) => `Deshacer el cambio ${p.transactionId}`, undoLatestSummary: 'Deshacer el último cambio',
 deleteVideoSummary: (p) => `Eliminar el vídeo «${p.name}» (${p.path}): moverlo a la Papelera, desde donde se puede restaurar en Space durante ${countEs(p.days, 'día', 'días')}. Los archivos originales de materiales vinculados permanecen donde están`, importPackageSummary: (p) => `Abrir el paquete portable ${p.file}`, renameVideoLabel: 'Cambiar nombre del vídeo',
 putDocumentSummary: (p) => `Escribir una versión nueva del documento ${p.documentId}`, newDocumentSummary: (p) => `Crear un documento (${p.kind})`, updateDocumentLabel: (p) => `Actualizar el documento «${p.name}»`, newDocumentLabel: (p) => `Crear el documento «${p.name}»`, translationDocumentName: (p) => `Traducción en ${p.language}`, importAssetSummary: (p) => `Importar el material ${p.name}${p.place ? ' y añadirlo a la línea de tiempo' : ''}`, importAssetLabel: (p) => `Importar ${p.name}${p.place ? ' y añadirlo a la línea de tiempo' : ''}`,
  replaceCompositionSummary: (p) => `Importar ${p.name} y reemplazar el clip ${p.clip} de la línea de tiempo`,
  replaceCompositionLabel: (p) => `Reemplazar el gráfico animado por ${p.name}`,
  pruneAssetsSummary: (p) => `Quitar del vídeo el material sin usar (${p.count}): ${p.names}`,
  pruneAssetsLabel: (p) => `Quitar material sin usar (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Usar los capítulos de origen de ${p.asset} (${p.count})${p.existing ? `, reemplazando los capítulos actuales (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Usar capítulos de origen',
 transcribePurpose: (p) => `Transcribir el material ${p.assetId}`, transcribeSummary: (p) => `Transcribir el material ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`,
 speechPurpose: (p) => `Sintetizar voz (${countEs(p.chars, 'carácter', 'caracteres')})`, speechSummary: (p) => `Sintetizar voz (${countEs(p.chars, 'carácter', 'caracteres')}${p.provider ? `, ${p.provider}` : ''}${p.voice ? `, voz ${p.voice}` : ''})`, imagePurpose: (p) => `Generar imagen: ${p.prompt}`, imageSummary: (p) => `Generar ${countEs(p.count, 'imagen', 'imágenes')}${p.size ? `, ${p.size}` : ''}${p.provider ? `, ${p.provider}` : ''}: ${p.prompt}`,
 cancelJobSummary: (p) => `Cancelar la tarea ${p.jobId}`, retryPipelineSummary: (p) => `Volver a ejecutar el flujo ${p.jobId} (${p.pipeline}, intento ${p.attempt}) desde el paso que falló`, saveArtifactSummary: (p) => `Guardar el resultado ${p.artifactId} como ${p.path}`, overwriteArtifactSummary: (p) => `Sobrescribir el archivo existente ${p.path} con el resultado ${p.artifactId}`,
 exportSummary: (p) => {
 const range = p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd} s` : p.rangeCount !== null ? `, ${countEs(p.rangeCount, 'intervalo', 'intervalos')}` : '';
 const size = p.width !== null && p.height !== null ? `, ${p.width}×${p.height}` : p.width !== null ? `, ancho ${p.width}` : p.height !== null ? `, alto ${p.height}` : '';
 const source = p.originalOnly ? ', solo audio original' : p.dubGroupId ? `, solo doblaje ${p.dubGroupId}` : '';
 return `Exportar ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` como ${p.fileName}` : ''}${p.overwrite ? ', sobrescribiendo el archivo existente' : ''}`;
 },
 installToolSummary: (p) => `Instalar ${p.tool} ${p.version} (${p.estimated ? `unos ${p.size}` : p.size}, ${p.license}) desde ${p.url} para descargar vídeos desde enlaces; descargar desde ${p.host} lo necesita`, linkImportSummary: (p) => `Descargar desde ${p.host} con ${p.tool}${p.version ? ` ${p.version}` : ''}: ${p.url}${linkImportAfter(p)}`,
 linkImportConsentSummary: (p) => `Permitir a BaoCut usar ${p.tool}${p.version ? ` ${p.version}` : ''} en este ordenador${p.path ? ` (${p.path})` : ''} para descargar vídeos de sitios web y descargar desde ${p.host}: ${p.url}${linkImportAfter(p)}`,
 downloadSaveSummary: (p) => `Copiar ${p.source} (${p.size}) de la carpeta de trabajo a la carpeta Descargas: ${p.target} (se numera si el nombre ya existe, nunca se sobrescribe)`,
 grantSummary: (p) => `Compartir datos con ${p.recipients}: ${p.items}`, grantSummaryItem: (p) => `${p.purpose} (${p.maxCalls === null ? 'sin límite de llamadas' : `hasta ${countEs(p.maxCalls, 'llamada', 'llamadas')}`})`,
 testModelSummary: (p) => `Comprobar el paquete de modelos local ${p.bundleId}: ejecutarlo de principio a fin con una muestra fija`, installModelSummary: (p) => `Descargar el modelo local ${p.bundleId}: ${p.estimated ? `unos ${p.size} (tamaño desconocido, estimado)` : p.size}${p.resumed ? `, reanudando ${p.resumed} ya descargados` : ''}, desde ${p.source} (${p.parts})`,
 registerProjectSummary: (p) => `Registrar la carpeta existente ${p.path} como proyecto${p.name ? ` (${p.name})` : ''}`, createProjectSummary: (p) => `Crear la carpeta de proyecto ${p.path}${p.name ? ` (${p.name})` : ''}`,
};
