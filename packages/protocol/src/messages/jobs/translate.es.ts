import type { JobsTranslateMessages } from './translate.ts';
export const es: JobsTranslateMessages = {
 label: 'Traducir', description: 'Traduce una transcripción del vídeo frase por frase a otro idioma y escribe el resultado como un documento de traducción nuevo. Un modelo de texto hace el trabajo; no se inicia ningún agente.',
 stepFreezeSource: 'Leer original', stepTranslate: 'Traducir', stepAssemble: 'Montar traducción', stepWrite: 'Escribir en el vídeo', videoNotOpen: 'El vídeo no está abierto',
 noStructuredOutput: (p) => `El modelo ${p.model} no admite salida estructurada, por lo que no se puede usar para traducir`, workerMismatch: 'La traducción de Speech Worker no coincide con el original fijado',
 targetLanguageInvalid: 'El parámetro targetLanguage debe ser una etiqueta de idioma BCP 47', flagInvalid: (p) => `El parámetro ${p.key} debe ser true o false`, bilingualNeedsCaptions: 'El parámetro bilingual solo se puede proporcionar cuando captions es true (añadir una capa de subtítulos)',
 noDocument: (p) => `El vídeo no tiene el documento ${p.documentId}`, notSpeech: (p) => `El documento ${p.documentId} es ${p.kind}; solo se pueden traducir transcripciones (speech)`,
 noTranscript: 'El vídeo no tiene una transcripción. Transcríbelo antes de traducir.', multipleTranscripts: 'El vídeo tiene más de una transcripción. Usa documentId para elegir cuál traducir.',
 videoClosed: 'El vídeo se cerró', sourceGone: 'El documento de origen ya no está en el vídeo', noSentences: 'La transcripción no tiene frases que traducir',
 sameLanguage: (p) => `El idioma de la transcripción ${p.source} es igual al de destino ${p.target}, por lo que no se necesita traducción`, workerMissing: 'No se encontró Speech Worker (speech-worker). Primero ejecuta npm run build:engine.',
 documentName: (p) => `Traducción ${p.language}`, videoClosedKept: 'El vídeo se cerró. La traducción se conserva en los resultados.',
 sourceChanged: 'El documento de origen cambió durante la traducción, por lo que no se escribió nada en el vídeo. Al reintentar se traduce la versión actual del documento de origen.',
 transactionLabel: (p) => `Traducir a ${p.language}`, noDocumentId: 'La traducción se escribió en el vídeo, pero no se devolvió su ID de documento', rejected: 'Se rechazó la transacción para escribir en el vídeo. La traducción se conserva en los resultados.',
};
