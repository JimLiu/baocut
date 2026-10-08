import type { JobsTranslationBatchesMessages } from './translation-batches.ts';
export const es: JobsTranslationBatchesMessages = {
 glossaryItemInvalid: 'Cada elemento del parámetro glossary necesita source y target no vacíos', glossaryNoteInvalid: 'La nota del parámetro glossary debe ser una cadena', glossariesItemInvalid: 'Cada elemento del parámetro glossaries necesita un ID de glosario',
 glossariesUnknownFields: (p) => `Los elementos del parámetro glossaries tienen campos desconocidos: ${p.fields}`, glossariesVersionInvalid: 'La versión del parámetro glossaries debe ser un entero positivo', cannotFreezeGlossaries: 'Este Runtime no puede fijar el contenido de los glosarios',
 artifactGone: (p) => `El resultado ${p.artifactId} ya no existe`, batchFailedSentences: (p) => `La traducción de las frases ${p.first}–${p.last} sigue sin coincidir con el formato esperado después de ${p.retries} reintentos`,
 batchFailedCues: (p) => `La traducción de los subtítulos ${p.first}–${p.last} sigue sin coincidir con el formato esperado después de ${p.retries} reintentos`, outputNoTranslations: 'El resultado no tiene traducciones',
 outputCountMismatch: (p) => `El resultado tiene ${p.output} elementos; la entrada tiene ${p.input} frases`, outputIncompleteItem: 'El resultado tiene elementos sin id o translation', outputDuplicateId: (p) => `${p.id} aparece dos veces en el resultado`, outputMissingIds: (p) => `Falta ${p.ids} en el resultado`,
};
