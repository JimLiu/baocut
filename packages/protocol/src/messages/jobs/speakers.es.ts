import type { JobsSpeakersMessages } from './speakers.ts';
export const es: JobsSpeakersMessages = {
 label: 'Identificar hablantes', description: 'Distingue por la voz a los hablantes de una transcripción existente en el vídeo (modelo local, sin retranscribir). El resultado es una propuesta; tras confirmarla, aplícala con edits.applySpeakers.',
 stepDiarize: 'Distinguir hablantes', stepPropose: 'Organizar resultados', videoNotOpen: 'El vídeo no está abierto',
 notFromAsset: 'Esta transcripción no pertenece a un material del vídeo, por lo que no se pueden distinguir los hablantes por la voz', modelMissing: 'Este ordenador no tiene un modelo de diarización de hablantes',
 modelNotInstalled: 'El modelo de diarización de hablantes aún no está instalado. Descárgalo primero.', transcriptUnreadable: 'No se pudo leer la transcripción', videoClosed: 'El vídeo se cerró', transcriptGone: 'La transcripción ya no está en el vídeo', noWords: 'La transcripción no tiene palabras',
 untimedWords: 'La transcripción tiene palabras sin tiempos, por lo que no se pueden distinguir los hablantes por la voz', sourceMissing: 'No se encontró el archivo de origen del material',
 hashMismatch: 'El hash de speakers.json no coincide con el que informó el Worker', wordCountMismatch: 'speakers.json no tiene la misma cantidad de palabras que la transcripción',
 transcriptChanged: 'La transcripción cambió después de identificar a los hablantes. Identifícalos de nuevo.', translationChanged: 'Una traducción cambió después de identificar a los hablantes. Identifícalos de nuevo.',
 unknownSpeaker: 'Este hablante no está en la propuesta', nameInvalid: (p) => `Los nombres de hablantes no pueden estar vacíos y pueden tener como máximo ${p.max} caracteres`, applyFailed: 'No se pudo aplicar la propuesta',
};
