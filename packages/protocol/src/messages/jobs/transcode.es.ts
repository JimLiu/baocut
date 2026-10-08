import type { JobsTranscodeMessages } from './transcode.ts';
export const es: JobsTranscodeMessages = {
 label: 'Transcodificar archivos', description: 'Comprime archivos de vídeo, únelos en orden o extrae audio: de archivo a archivo, sin crear un vídeo, mediante ffmpeg; los resultados no sobrescriben archivos existentes.',
 inputNotFound: (p) => `No se encuentra el archivo de entrada ${p.file}`, stepProbe: 'Leer entradas', stepEncode: 'Codificar', stepVerify: 'Verificar resultado', stepPublish: 'Publicar',
 noAudioTrack: (p) => `${p.name} no tiene pista de audio`, noVideoTrack: (p) => `${p.name} no tiene pista de vídeo`, verifyFailed: (p) => `El resultado de ${p.name} no superó la verificación`,
 actionShape: 'debe ser compress, merge o extract-audio', mergeNeedsTwo: 'necesita al menos dos archivos para unir',
 audioReencode: (p) => `El códec de audio ${p.codec} no es compatible con un contenedor de audio habitual; se recodifica a AAC`, fileReason: (p) => `${p.name}: ${p.reason}`, reasonSeparator: '; ',
 fieldVideoCodec: 'Códec de vídeo', fieldResolution: 'Resolución', fieldFrameRate: 'Frecuencia de fotogramas', fieldPixelFormat: 'Formato de píxel', fieldAudioTrack: 'Pista de audio', fieldAudioCodec: 'Códec de audio', fieldSampleRate: 'Frecuencia de muestreo', fieldChannels: 'Canales', present: 'sí', absent: 'ninguno',
 fieldMismatch: (p) => `${p.field} difiere (${p.values})`, videoNotMp4: (p) => `El códec de vídeo ${p.codec} no se puede incluir directamente en MP4`, audioNotMp4: (p) => `El códec de audio ${p.codec} no se puede incluir directamente en MP4`,
 probeOutputFailed: 'ffprobe no puede leer el archivo de resultado', outputNoVideo: 'El resultado no tiene pista de vídeo', outputNoAudio: 'El resultado no tiene pista de audio',
 durationOff: (p) => `La duración es ${p.actual} s; se esperaban unos ${p.expected} s`, codecMismatch: (p) => `El códec de vídeo es ${p.actual}; se esperaba ${p.expected}`, heightOver: (p) => `El alto del fotograma ${p.height} supera el límite de ${p.max}`, tooManySameName: (p) => `Demasiados archivos con el mismo nombre en la carpeta de salida: ${p.name}`,
};
