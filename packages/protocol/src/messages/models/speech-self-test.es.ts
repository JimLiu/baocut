import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';
export const es: ModelsSpeechSelfTestMessages = {
 notWav: 'No es un archivo RIFF/WAVE', missingFmt: 'Falta el bloque fmt', missingData: 'Falta el bloque data', unsupportedEncoding: (p) => `Codificación no compatible (${p.format})`, badChannels: (p) => `Cantidad de canales incorrecta (${p.channels})`, badSampleRate: (p) => `Frecuencia de muestreo incorrecta (${p.sampleRate})`, unsupportedBitDepth: (p) => `Profundidad de bits no compatible (${p.bits})`,
 nonFinite: 'Las muestras contienen valores no finitos', undecodable: (p) => `El resultado no se puede decodificar: ${p.problem}`, durationOutOfRange: (p) => `La duración de ${p.duration} segundos no está entre ${p.min} y ${p.max} segundos`, silent: 'El resultado está en silencio', clipped: (p) => `El resultado satura: el ${p.ratio}% de las muestras alcanza la escala completa (límite ${p.limit}%)`,
};
