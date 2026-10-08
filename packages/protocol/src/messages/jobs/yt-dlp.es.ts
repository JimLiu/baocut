import type { JobsYtDlpMessages } from './yt-dlp.ts';
export const es: JobsYtDlpMessages = {
 toolNotFound: (p) => `No se encuentra un yt-dlp ejecutable (${p.code})`, remedyUnsupported: 'La herramienta de descarga no admite este enlace: usa el enlace de la propia página del vídeo (no una lista de reproducción, una emisión en directo ni una página de búsqueda)',
 remedyLoginRequired: 'Inicia sesión en el sitio desde tu navegador, selecciona ese navegador en «Inicio de sesión en sitios web» y descarga de nuevo',
 remedyCookiesUnavailable: 'No se pueden leer las cookies del navegador: comprueba que has iniciado sesión; si la base de datos está en uso, cierra el navegador por completo (incluidos los procesos en segundo plano); si se deniega acceso al Llavero, permítelo; Safari necesita Acceso total al disco; en Windows, yt-dlp no puede leer cookies de Chrome, Edge o Brave protegidas con cifrado vinculado a la aplicación, por lo que debes usar Firefox; o prueba otro navegador',
 remedyToolUpdateRequired: 'El sitio no se pudo analizar o la herramienta está desactualizada: actualiza yt-dlp, detéctalo de nuevo y vuelve a intentarlo', remedyUnavailable: 'El vídeo no está disponible (eliminado, restringido por región o sin formato descargable)',
 remedyNetworkError: 'No se puede conectar o la descarga se interrumpió: comprueba la red y vuelve a intentarlo (se reanuda lo descargado)', remedyDiskFull: 'No hay espacio en disco suficiente para la carpeta de descargas o Runtime Home: libera espacio y vuelve a intentarlo',
 remedyDownloadFailed: 'La herramienta de descarga informó de un error: consulta details.stderr; puede que debas actualizar yt-dlp (baocut external-tools detect)', exited: (p) => `yt-dlp terminó con ${p.code}`,
 cookieLoginRequired: (p) => `${p.browser}: el sitio sigue requiriendo iniciar sesión`, cookieUnreadable: (p) => `${p.browser}: no se pueden leer las cookies`, reasonSeparator: '; ',
 cookieAttemptsFailed: (p) => `Se probaron cookies de ${p.count} navegadores y ninguna funcionó (${p.reasons})`, metadataUnreadable: 'No se pueden leer los metadatos de la herramienta de descarga', metadataNotObject: 'Los metadatos de la herramienta de descarga no son un objeto',
 playlist: 'El enlace es una lista de reproducción; importa un vídeo a la vez', live: 'No se pueden importar emisiones en directo',
};
