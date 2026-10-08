import type { ModelsGenerationOptionsMessages } from './generation-options.ts';
export const es: ModelsGenerationOptionsMessages = {
 notLocalOnly: (p) => `El modelo ${p.modelId} no admite ${p.key} (solo los modelos locales lo admiten)`, textEmpty: 'El texto no puede estar vacío',
 textTooLong: (p) => `El texto tiene ${p.length} caracteres, por encima del límite de ${p.limit} caracteres por llamada del modelo ${p.modelId}. Envíalo por partes.`,
 noDefaultVoice: (p) => `El modelo ${p.modelId} no tiene una voz predeterminada; especifica voice`, noSuchVoice: (p) => `El modelo ${p.modelId} no tiene la voz ${p.voice}`, badLanguageTag: (p) => `No es una etiqueta de idioma BCP 47 válida: ${p.tag}`,
 languageUnsupported: (p) => `El modelo ${p.modelId} no admite el idioma ${p.language}`, formatUnsupported: (p) => `El modelo ${p.modelId} no produce ${p.format}`, noInstructions: (p) => `El modelo ${p.modelId} no admite instrucciones de tono (instructions)`, noSpeed: (p) => `El modelo ${p.modelId} no admite una velocidad de habla (speed)`,
 speedRange: (p) => `La velocidad de habla debe estar entre ${p.min} y ${p.max}`, knobUnsupported: (p) => `El modelo ${p.modelId} no admite ${p.key}`, knobRange: (p) => `${p.key} debe estar entre ${p.min} y ${p.max}`,
 promptEmpty: 'El prompt no puede estar vacío', promptTooLong: (p) => `El prompt tiene ${p.length} caracteres, por encima del límite de ${p.limit} caracteres del modelo ${p.modelId}`, aspectUnsupported: (p) => `El modelo ${p.modelId} no admite la relación de aspecto ${p.ratio}`,
 sizeUnsupported: (p) => `El modelo ${p.modelId} no admite el tamaño ${p.size}`, maxCount: (p) => `El modelo ${p.modelId} genera como máximo ${p.max} imágenes a la vez`, noSteps: (p) => `El modelo ${p.modelId} no admite steps (solo los modelos locales lo admiten)`, stepsRange: (p) => `steps debe ser un entero entre ${p.min} y ${p.max}`, noSeed: (p) => `El modelo ${p.modelId} no admite seed`,
};
