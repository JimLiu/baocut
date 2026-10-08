import type { JobsLinkImportMessages } from './link-import.ts';
export const es: JobsLinkImportMessages = {
 languageTag: 'debe ser una etiqueta de idioma BCP 47', requiresTranscribe: 'solo se puede proporcionar con transcribe',
 noVideoDiarize: 'Sin un vídeo de destino, solo se escriben transcripciones independientes; no se pueden distinguir los hablantes',
 noVideoCaptions: 'No se crean capas de subtítulos sin un vídeo de destino', notWrittenToVideo: 'La transcripción terminó, pero no se escribió en el vídeo',
 label: 'Descargar vídeo',
 description: 'Descarga un vídeo a una carpeta con yt-dlp y, opcionalmente, lo transcribe a TXT y SRT. La pertenencia al proyecto y la carpeta de guardado son independientes; el protocolo anterior sigue aceptando un destino de importación de vídeo. Requiere instalar yt-dlp y aceptar su uso.',
 offlineStrict: 'No se descargan enlaces en modo sin conexión estricto', cannotCreateVideo: 'Este Runtime no puede crear vídeos', cannotTranscribe: 'Este Runtime no puede transcribir',
 fileTranscribeUnavailable: 'La transcripción de archivos no está disponible', videoNotOpen: 'El vídeo no está abierto', sourceExpired: 'El enlace original ya no está disponible: inicia una importación nueva',
 stepResolve: 'Resolver enlace', stepDownload: 'Descargar', stepVerify: 'Comprobar que se decodifica', stepPublish: 'Mover a la carpeta de descargas', stepCreate: 'Crear vídeo', stepImport: 'Importar al vídeo', stepTranscribe: 'Transcribir',
 undecodable: 'El archivo descargado no se puede decodificar', noStreams: 'El archivo descargado no tiene imagen ni sonido',
 undecodableRemedy: 'El archivo del origen está incompleto o tiene un formato no compatible: vuelve a intentarlo o prueba otro formato (audioOnly)', noMediaFile: 'La herramienta de descarga no dejó un archivo multimedia',
 destinationUnwritable: (p) => `No se puede escribir en la carpeta de guardado: ${p.dir}`,
 destinationRemedy: 'Comprueba que la carpeta de guardado (la carpeta Descargas es el ajuste downloads.directory; en un proyecto es downloads/ del proyecto) exista y tenga permiso de escritura',
 publishedOutside: 'El archivo publicado está fuera de la carpeta de guardado', diskFull: 'No hay espacio en disco suficiente para la carpeta de descargas',
 unsupportedBrowser: 'no es un navegador compatible', browserItems: 'debe contener solo navegadores compatibles', noDuplicates: 'no puede contener duplicados', saveToInvalid: 'debe ser downloads o project',
 languageItems: 'debe contener solo códigos de idioma (por ejemplo, en, zh-Hans)', projectMismatch: 'no coincide con el proyecto en target.create', conversationMismatch: 'no coincide con la conversación en target.create',
};
