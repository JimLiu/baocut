import type { JobsSpeechWorkerMessages } from './speech-worker.ts';
export const es: JobsSpeechWorkerMessages = {
 incompatible: (p) => `El protocolo de Speech Worker no es ${p.protocol}`, exited: 'Speech Worker terminó inesperadamente', translationLanguage: 'El idioma de la traducción no coincide con el de destino', outputInvalid: 'El resultado de Speech Worker no cumple el contrato',
 outputTruncated: 'El resultado del modelo alcanzó el límite y se recortó', resultMissing: (p) => `Falta ${p.field} en el resultado de Speech Worker`, unreadableFile: (p) => `No se puede leer ${p.name} escrito por Speech Worker`,
 cuesNotObject: 'Las entradas no son un objeto', cuesSchema: (p) => `El esquema de las entradas debe ser ${p.schema}`, cuesLanguage: 'El idioma de las entradas no coincide con el de destino', cuesTimescale: 'timescale de las entradas debe coincidir con el de la transcripción de origen', cuesMissing: 'Falta cues',
 cueNotObject: (p) => `La entrada ${p.n} no es un objeto`, cueNoText: (p) => `La entrada ${p.n} no tiene texto`, cueNoSentence: (p) => `A la entrada ${p.n} le falta su frase o unidad`,
 cueFallback: (p) => `fallback de la entrada ${p.n} no es un booleano`, cueTicks: (p) => `Los tiempos de la entrada ${p.n} no son ticks enteros`, cueRange: (p) => `La entrada ${p.n} tiene un intervalo de tiempo no válido`,
 cueOverlap: (p) => `La entrada ${p.n} se solapa con la anterior o está fuera de orden`, cueBeyond: (p) => `La entrada ${p.n} supera la duración del medio`,
};
