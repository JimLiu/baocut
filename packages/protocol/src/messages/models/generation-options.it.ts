import type { ModelsGenerationOptionsMessages } from './generation-options.ts';
import { pluralForm } from '../../i18n.ts';

const characters = (n: number) => pluralForm('it', n, { one: `${n} carattere`, other: `${n} caratteri` });

export const it: ModelsGenerationOptionsMessages = {
  notLocalOnly: (p) => `Il modello ${p.modelId} non accetta ${p.key} (solo i modelli locali lo accettano)`, textEmpty: 'Il testo non può essere vuoto',
  textTooLong: (p) => `Il testo ha ${characters(p.length)}, oltre il limite di ${characters(p.limit)} per chiamata del modello ${p.modelId}. Invialo in parti.`,
  noDefaultVoice: (p) => `Il modello ${p.modelId} non ha una voce predefinita; specifica voice`, noSuchVoice: (p) => `Il modello ${p.modelId} non ha la voce ${p.voice}`,
  badLanguageTag: (p) => `Tag di lingua BCP 47 non valido: ${p.tag}`, languageUnsupported: (p) => `Il modello ${p.modelId} non supporta la lingua ${p.language}`, formatUnsupported: (p) => `Il modello ${p.modelId} non produce ${p.format}`,
  noInstructions: (p) => `Il modello ${p.modelId} non accetta istruzioni sul tono (instructions)`, noSpeed: (p) => `Il modello ${p.modelId} non accetta una velocità di parlato (speed)`, speedRange: (p) => `La velocità di parlato deve essere compresa tra ${p.min} e ${p.max}`,
  knobUnsupported: (p) => `Il modello ${p.modelId} non accetta ${p.key}`, knobRange: (p) => `${p.key} deve essere compreso tra ${p.min} e ${p.max}`, promptEmpty: 'Il prompt non può essere vuoto',
  promptTooLong: (p) => `Il prompt ha ${characters(p.length)}, oltre il limite di ${characters(p.limit)} del modello ${p.modelId}`,
  aspectUnsupported: (p) => `Il modello ${p.modelId} non supporta il rapporto d’aspetto ${p.ratio}`, sizeUnsupported: (p) => `Il modello ${p.modelId} non supporta la dimensione ${p.size}`,
  maxCount: (p) => pluralForm('it', p.max, { one: `Il modello ${p.modelId} genera al massimo ${p.max} immagine alla volta`, other: `Il modello ${p.modelId} genera al massimo ${p.max} immagini alla volta` }),
  noSteps: (p) => `Il modello ${p.modelId} non accetta steps (solo i modelli locali lo accettano)`, stepsRange: (p) => `steps deve essere un intero compreso tra ${p.min} e ${p.max}`, noSeed: (p) => `Il modello ${p.modelId} non accetta seed`,
};
