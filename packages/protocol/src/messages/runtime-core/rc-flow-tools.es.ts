import type { RcFlowToolsMessages } from './rc-flow-tools.ts';
function providerNote(p: { provider: string | null; model: string | null }): string { return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''; }
function originalLabel(original: string): string { switch (original) { case 'mute': return 'silenciar'; case 'keep': return 'conservar'; default: return 'atenuar'; } }
function transcodeAction(action: string, count: number): string { switch (action) { case 'merge': return `Unir ${count} archivos en orden`; case 'extract-audio': return `Extraer audio de ${count} archivos`; default: return `Comprimir ${count} archivos`; } }
export const es: RcFlowToolsMessages = {
 listSeparator: ', ',
 transcribeVideoSummary: (p) => `Transcribir ${p.asset ? `el material ${p.asset}` : 'el material de la pista principal'}${providerNote(p)}${p.captions ? ' y añadir una capa de subtítulos' : ''}`,
 transcribeFileSummary: (p) => `Transcribir ${p.file}${providerNote(p)} y escribir transcripciones TXT y SRT en ${p.outDir ?? 'la carpeta Descargas'}`,
 transcribeCreateSummary: (p) => `Crear un vídeo${p.name ? ` «${p.name}»` : ''}, importar ${p.file} y añadirlo a la línea de tiempo, después transcribirlo${providerNote(p)}${p.captions ? ' y añadir una capa de subtítulos' : ''}`,
 translateVideoSummary: (p) => `Traducir la transcripción a ${p.to} con el modelo de texto${providerNote(p)}${p.captions ? ` y añadir una capa de subtítulos${p.bilingual ? ' bilingües' : ''}` : ''}`,
 translateFileSummary: (p) => `Traducir el archivo de subtítulos ${p.input} a ${p.to} con el modelo de texto${providerNote(p)} y escribir el archivo nuevo en ${p.outDir ?? 'la carpeta Descargas'}`,
 dubSummary: (p) => `Doblaje traducido${p.to ? ` (${p.to})` : ''}: ${p.translation ? `usar la traducción ${p.translation}` : 'traducir primero con el modelo de texto'}, sintetizar frase por frase${providerNote(p)}${p.voice ? ` con la voz ${p.voice}` : ''}, añadir una pista de doblaje nueva y ${originalLabel(p.original)} el audio original`,
 transcodeSummary: (p) => `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? '…' : ''}) y guardar en ${p.outDir ?? 'la carpeta Descargas'}`,
  transcribeReplaceSummary: (p) =>
    `Volver a transcribir ${p.asset ? `el material ${p.asset}` : 'el material de la pista principal'}${providerNote(p)} y sustituir la transcripción actual del vídeo, conservando traducciones, subtítulos y doblaje (una sola operación que se puede deshacer)`,
};
