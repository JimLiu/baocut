import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';
export const es: JobsToolCatalogueMessages = {
 transcribeLabel: 'Transcribir', transcribeDescription: 'Transcribe un archivo multimedia local o un vídeo en Space. Para un vídeo, escribe una transcripción nueva y crea una capa de subtítulos; para un archivo solo, escribe TXT y SRT en la ubicación de guardado o puede crear un vídeo nuevo.',
 translateSubtitlesLabel: 'Traducir subtítulos', translateSubtitlesDescription: 'Traduce la transcripción de un vídeo frase por frase a otro idioma y la escribe en el vídeo como una traducción nueva. También puede traducir un archivo de subtítulos SRT / VTT (un archivo local o un elemento de subtítulos en Space) a un archivo de subtítulos nuevo.',
 dubLabel: 'Doblaje traducido', dubDescription: 'Sintetiza voz en el idioma de destino frase por frase a partir de la transcripción (traduciendo primero si no hay traducción), alinea los tiempos y la escribe en el vídeo como un grupo de doblaje nuevo.',
 synthesizeSpeechLabel: 'Generar voz', synthesizeSpeechDescription: 'Sintetiza voz a partir de un texto; el resultado es audio. También puede leer un documento o un elemento de subtítulos de Space (subtítulos sin códigos de tiempo).',
 generateTextLabel: 'Generar texto', generateTextDescription: 'Genera texto a partir de un prompt (opcionalmente siguiendo un JSON Schema); el resultado es texto. Se pueden adjuntar documentos o elementos de subtítulos de Space como material.',
 generateImageLabel: 'Generar imagen', generateImageDescription: 'Genera una imagen a partir de una descripción; el resultado es una imagen.',
 linkImportLabel: 'Descargar vídeo', linkImportDescription: 'Descarga un vídeo a este ordenador con yt-dlp. Se pueden usar cookies del navegador y transcribir la descarga para obtener una transcripción y subtítulos.',
 compressVideoLabel: 'Comprimir vídeo', compressVideoDescription: 'Comprime archivos de vídeo uno a uno: de archivo a archivo, sin crear un vídeo, y los resultados no sobrescriben archivos existentes.',
 mergeVideoLabel: 'Unir vídeos', mergeVideoDescription: 'Une varios archivos de vídeo en uno, en orden: de archivo a archivo, sin crear un vídeo, y los resultados no sobrescriben archivos existentes.',
 extractAudioLabel: 'Extraer audio', extractAudioDescription: 'Extrae la pista de audio de un archivo de vídeo o audio. Los códecs compatibles con un contenedor habitual se copian tal cual; los demás se recodifican a AAC. De archivo a archivo, sin crear un vídeo, y los resultados no sobrescriben archivos existentes.',
};
