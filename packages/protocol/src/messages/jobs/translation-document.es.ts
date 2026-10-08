import type { JobsTranslationDocumentMessages } from './translation-document.ts';
export const es: JobsTranslationDocumentMessages = {
 notSpeech: 'El documento de origen no es una transcripción baocut.speech/1', unreadable: 'No se pudo leer la transcripción', notObject: 'El cuerpo no es un objeto', schemaShouldBe: (p) => `schema debe ser ${p.schema}`, missingLanguage: 'Falta language',
 basisMismatch: 'sourceBasis no coincide con el original fijado', basisDerivationMismatch: 'La secuencia o editViewHash de sourceBasis no coincide con el original fijado (las frases no se derivaron con las mismas reglas)', missingUnits: 'Falta units',
 unitCountMismatch: (p) => `Hay ${p.units} unidades de traducción, pero el original tiene ${p.sentences} frases`, unitDuplicate: (p) => `La unidad de traducción ${p.id} está duplicada`,
 unitSentenceMismatch: (p) => `La unidad de traducción ${p.n} no coincide con su frase de origen`, unitMissingSource: (p) => `A la unidad de traducción ${p.n} le falta su frase de origen o huella`,
 unitNoText: (p) => `La unidad de traducción ${p.id} no tiene traducción`, unitBadStatus: (p) => `La unidad de traducción ${p.id} tiene un estado no válido`, unitBadAlignment: (p) => `La unidad de traducción ${p.id} tiene una alineación no válida`,
 unitAlignmentFields: (p) => `Faltan campos en la alineación de la unidad de traducción ${p.id}`, unitHashMismatch: (p) => `textHash de la unidad de traducción ${p.id} no coincide con la traducción`,
 unitExtraFields: (p) => `La unidad de traducción ${p.id} tiene campos fuera de §5.3: ${p.fields}`, bodyExtraFields: (p) => `El cuerpo tiene campos fuera de §5.3: ${p.fields}`,
};
