import type { TtsLocalMessages } from './models-tts-local-copy.ts';
import { pluralForm } from '@baocut/protocol';
const LANG_SHORT: Record<string, string> = { zh: 'Chino', en: 'Inglés', ja: 'Japonés', ko: 'Coreano', de: 'Alemán', fr: 'Francés', es: 'Español', it: 'Italiano', pt: 'Portugués', ru: 'Ruso', ar: 'Árabe' };
const voicesEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'voz integrada', other: 'voces integradas' })}`;
export const es: TtsLocalMessages = {
 languageShort: (code) => LANG_SHORT[code] ?? code, languagesAny: 'Cualquier idioma', languagesMore: (shown, total) => `${shown.join(' / ')} y más (${total} idiomas)`,
 summaryCloneDescribe: (builtins, byDuration) => `${voicesEs(builtins)}, clona una voz a partir de una grabación o crea una voz nueva eligiendo género, edad y tono${byDuration ? '; puede leer con una duración objetivo' : ''}`,
 summaryClone: (builtins, style) => `${voicesEs(builtins)} o clona una voz a partir de una grabación${style ? '; un prompt de una línea puede definir el estilo' : ''}`,
 summaryDescribe: (builtins) => builtins ? `Describe en una frase la voz que quieres y el modelo la crea; también puedes usar directamente las ${voicesEs(builtins)}` : 'Describe en una frase la voz que quieres y el modelo la crea',
 summaryPreset: (speakers, style) => `${speakers} ${pluralForm('es', speakers, { one: 'voz predefinida', other: 'voces predefinidas' })}; elige una para leer${style ? '; un prompt de una línea puede definir el tono' : ''}`,
 modeCloneDescribe: 'Voces integradas / Clonar / Describir', modeClone: 'Voces integradas / Clonar', modeDescribe: 'Voz a partir de descripción', modePreset: 'Voces predefinidas',
 factStyle: "Indicación de estilo", factSlow: 'Más lento', nonCommercialChip: 'Solo uso no comercial',
 licenseCommercial: (name) => `${name} · Uso comercial permitido`, licenseNonCommercial: (name, owner) => `${name} · Solo uso no comercial · Para uso comercial, solicítalo a ${owner} por separado`,
 familyDesc: {
 'qwen3-tts': 'Qwen3-TTS: CustomVoice tiene 9 hablantes predefinidos y un prompt de una línea puede definir el tono; Base clona a partir de una grabación de referencia; 1.7B VoiceDesign crea una voz nueva solo con una descripción. 1.7B suena mejor, pero es más lento.',
 indextts2: 'IndexTTS: ocho voces integradas o clona tu propia grabación; solo toma el timbre de la grabación y no lee su transcripción. IndexTTS 2.5 también puede ajustar la velocidad del habla.',
 'gpt-sovits': 'GPT-SoVITS: ocho voces integradas o clona tu propia grabación; suena más parecido si también proporcionas la transcripción de la grabación de referencia, que entonces debe durar entre 3 y 10 segundos.',
 voxcpm2: 'VoxCPM2: ocho voces integradas o clona tu propia grabación; se parece más con la transcripción de la grabación y un prompt de una línea puede definir el estilo de habla; produce 48 kHz.',
 omnivoice: 'OmniVoice: ocho voces integradas, clona tu propia grabación o crea una voz nueva eligiendo género, edad y tono de una lista de palabras; lee la mayor cantidad de idiomas. Solo uso no comercial.',
 },
 quickDescribe: 'La voz se determina completamente por esta descripción: cambia la descripción y obtendrás otra persona',
 quickVoxcpm: 'Aproximadamente en tiempo real: una frase tarda en generarse lo mismo que en leerse y la primera carga tarda unos 5 segundos',
 quickNonCommercial: (license) => `Solo uso no comercial (${license}): cambia de modelo para el contenido que usarás comercialmente`,
 quickSlow: 'Modelo grande: la síntesis es más lenta que en modelos similares y la primera carga tarda algo más',
};
