import type { JobsMediaProbeMessages } from './media-probe.ts';
export const es: JobsMediaProbeMessages = {
 unknownMediaType: (p) => `Tipo multimedia no reconocido ${p.mediaType}`, unreadable: 'No se pudo leer el archivo de salida',
 headerMismatch: (p) => `La cabecera del archivo es ${p.sniffed}, pero se declaró como ${p.mediaType}`, unrecognizedFormat: 'un formato no reconocido',
 notJson: 'La salida de ffprobe no es JSON', noAudioStream: 'Sin flujo de audio', noImage: 'Sin imagen', noFrames: 'No se pudo decodificar ningún fotograma',
 durationNotPositive: 'La duración no es positiva', sampleRateNotPositive: 'La frecuencia de muestreo no es positiva', channelsNotPositive: 'La cantidad de canales no es positiva', sizeNotPositive: 'El ancho o el alto no es positivo',
 cannotRun: (p) => `ffprobe no pudo ejecutarse: ${p.reason}`, killedBy: (p) => `terminado por ${p.signal}`, exitCode: (p) => `código de salida ${p.code}`,
 decodeFailed: (p) => `ffprobe no pudo decodificar (${p.reason})`, decodeFailedWith: (p) => `ffprobe no pudo decodificar (${p.reason}): ${p.output}`, noProbe: 'ffprobe no está disponible, por lo que no se puede comprobar la salida',
};
