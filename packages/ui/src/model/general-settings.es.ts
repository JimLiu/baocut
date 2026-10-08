import type { GeneralSettingsModelMessages } from './general-settings.ts';
export const es: GeneralSettingsModelMessages = {
 lineShort: 'Corta', lineMedium: 'Media', lineLong: 'Larga',
 lineLength: (cjk, other) => `Texto CJK: ${cjk} caracteres por línea · Otros textos: ${other} caracteres por línea`,
 endpointTooLong: (max) => `Demasiado largo: hasta ${max} caracteres`, endpointNotUrl: 'No es una dirección web: debe empezar con http:// o https://',
 endpointScheme: 'Solo se admiten direcciones que empiecen con http:// o https://', endpointCredentials: 'La dirección no puede incluir un nombre de usuario ni una contraseña',
 endpointQuery: 'La dirección no puede incluir parámetros de consulta (la parte después de ?)', endpointHash: 'La dirección no puede incluir un fragmento (la parte después de #)',
 saveDir: {
 label: 'Ubicación de guardado predeterminada', desc: 'Aquí se guardan los resultados de herramientas, los vídeos descargados y los archivos entregados por el agente. La ubicación predeterminada es tu carpeta Descargas.',
 systemDefault: 'Carpeta Descargas', isDefault: 'Predeterminada', change: 'Cambiar…', reset: 'Restablecer valor predeterminado',
 pickTitle: 'Elegir ubicación de guardado predeterminada', changed: 'Ubicación de guardado predeterminada cambiada', resetDone: 'Restablecida la carpeta Descargas',
 pickFailed: (message) => `No se pudo elegir una carpeta: ${message}`, webNote: 'Un navegador no puede elegir una carpeta en este ordenador. Configúralo en la aplicación de escritorio de BaoCut.',
 },
 source: { system: 'Instalado en el sistema', user: 'Ubicación que elegiste', managed: 'Descargado por BaoCut', env: 'Establecido por una variable de entorno' },
 notInstalled: 'Sin instalar', missingDesc: 'yt-dlp aún no está instalado. Cuando el agente importe desde un enlace, primero te pedirá que aceptes descargarlo (mostrando el origen, la versión, el tamaño y la licencia).',
 consentRevoked: 'Consentimiento retirado', revokedDesc: (facts) => `${facts}. Retiraste tu consentimiento para usarlo, por lo que importar desde un enlace volverá a preguntarte primero.`,
 available: 'Disponible', needsUpdate: 'Necesita actualizarse', cannotRun: 'No se puede ejecutar', factsWhy: (facts, why) => `${facts}. ${why}`,
};
