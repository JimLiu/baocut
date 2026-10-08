import type { ModelsLocalSpeechMessages } from './local-speech.ts';
export const es: ModelsLocalSpeechMessages = {
 paceQwen06: 'unas 55 veces más lento que en tiempo real, por lo que una frase de 3 segundos tarda de dos a tres minutos',
 paceQwen17: 'se espera que sea más lento que 0.6B (unas 55 veces más lento que en tiempo real); este no se ha medido',
 paceIndexTts2: 'se espera que sea similar a IndexTTS 2.5 (120–145 veces más lento que en tiempo real); este no se ha medido',
 paceIndexTts25: '120–145 veces más lento que en tiempo real, por lo que una frase de cuatro o cinco segundos tarda de siete a diez minutos',
 paceGptSovits: 'unas 6 veces más lento que en tiempo real, por lo que una frase de 4 segundos tarda alrededor de medio minuto',
 paceVoxcpm2: 'el modelo más grande, por lo que se espera que cada frase tarde varios minutos; este no se ha medido', paceOmnivoice: 'unas 30 veces más lento que en tiempo real, por lo que una frase de 4 segundos tarda alrededor de dos minutos', paceDefault: 'cada frase tarda unos minutos',
 cpuNote: (p) => `Sintetiza en la CPU de este ordenador usando solo uno o dos núcleos: ${p.pace}. Debería ser mucho más rápido con una GPU NVIDIA (CUDA) (sin medir)`,
 oneVoiceSource: 'Proporciona solo uno de voice, reference y voiceDescription', modeUnsupported: (p) => `El modelo ${p.modelId} no admite ${p.what} (${p.mode})`, modeClone: 'clonar a partir de una grabación de referencia', modeDescribe: 'crear una voz a partir de una descripción',
 noReferenceTranscript: (p) => `El modelo ${p.modelId} no lee la transcripción de la grabación de referencia (reference.transcript)`, descriptionEmpty: 'La descripción no puede estar vacía',
 noPresetVoice: (p) => `El modelo ${p.modelId} no tiene voces predefinidas; proporciona ${p.need}`, noSuchVoice: (p) => `El modelo ${p.modelId} no tiene la voz ${p.voice}`, noDefaultVoice: (p) => `El modelo ${p.modelId} no tiene una voz predeterminada; especifica voice`,
 termNotInVocabulary: (p) => `Las descripciones de voz del modelo ${p.modelId} solo aceptan palabras de su vocabulario: «${p.term}» no está en él`, onePerCategory: (p) => `Las descripciones de voz del modelo ${p.modelId} admiten como máximo un término por categoría (${p.category})`,
 builtinReferenceLabel: 'grabación de voz integrada', referenceUnreadable: (p) => `No se puede leer la grabación de referencia «${p.name}»: falta, no es un archivo o no se puede leer. Prueba otra grabación`,
};
