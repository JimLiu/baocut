import type { ModelsModelDownloaderMessages } from './model-downloader.ts';
export const es: ModelsModelDownloaderMessages = {
 remedyNoSpace: 'El disco de la carpeta de modelos no tiene espacio. Libera espacio suficiente (o mueve la carpeta de modelos a otro disco en Ajustes) y vuelve a instalar',
 remedyNetwork: 'No se puede acceder a la red o la descarga se interrumpió. Comprueba la red e instala de nuevo; se reanuda lo descargado. También puedes cambiar de servidor espejo en «Origen de descarga de modelos» de «Ajustes › General»',
 remedyIntegrity: 'Un archivo descargado no coincide con el tamaño o sha256 del manifiesto (el origen o servidor espejo tiene contenido incorrecto). Se eliminó el archivo incorrecto; cambia a otro origen de descarga e instala de nuevo',
 remedySource: 'El origen de descarga no tiene este archivo o denegó el acceso. Comprueba que el servidor espejo configurado en «Origen de descarga de modelos» de «Ajustes › General» (o la variable de entorno BAOCUT_MODELS_ENDPOINT) esté completo',
 remedyManifestIncomplete: 'Al manifiesto integrado de este paquete de modelos le falta un sha256 fiable, por lo que no se puede instalar. Espera a una actualización de BaoCut',
 downloadFailed: (p) => `No se pudo descargar ${p.file}: ${p.reason}`, integrityMismatch: (p) => `El tamaño o sha256 de ${p.file} no coincide con el manifiesto`, sourceHttp: (p) => `El origen de descarga devolvió HTTP ${p.status} para ${p.file}`, diskFull: 'El disco se llenó al escribir los archivos del modelo',
};
