import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: TranscribeSetupMessages = {
  notConnected: 'Sin conexión', unavailable: 'No disponible', autoDetect: 'Detectar automáticamente',
  hintNoModel: 'Aún no se sabe qué modelo de voz se usará. Elige uno arriba para ver si admite pistas de reconocimiento.',
  hintUnsupported: (model: string, alt: string | null) => `${model} no admite pistas de reconocimiento, por lo que los glosarios y el prompt no se pueden usar en este paso y se omitirán al transcribir.${alt ? ` Para usarlos al transcribir, cambia a ${alt}.` : ''}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `prompt de ${b.custom} caracteres` : 'sin prompt';
    const dropped = b.dropped ? ` · ${b.dropped} más no caben; los glosarios que aparecen primero tienen prioridad` : '';
    return `Se envía a ${model}: ${custom} + ${b.terms} ${pluralForm('es', b.terms, { one: 'término', other: 'términos' })} · unos ${b.chars} / ${max} caracteres${dropped}`;
  },
  glossaryGone: 'Ya no está en la biblioteca de glosarios · no se usa esta vez',
  glossaryTranslation: 'Glosario de traducción; no se usa para transcribir · no se usa esta vez',
  anyLanguage: 'Cualquier idioma', termCount: (count: number) => `${count} ${pluralForm('es', count, { one: 'término', other: 'términos' })}`,
  noDefaultModel: 'Aún no hay un modelo de voz predeterminado',
  defaultModel: (label: string) => `${label} (predeterminado)`, autoDetectLanguage: 'Detectar idioma automáticamente',
  glossaries: (count: number) => `${count} ${pluralForm('es', count, { one: 'glosario', other: 'glosarios' })}`,
  hasPrompt: 'Con prompt',
  noDefaultFacts: 'Aún no hay un modelo de voz predeterminado. Elige uno o establece uno predeterminado en la página Modelos. Si empiezas sin elegir, se te indicará qué falta.',
  modelUnusable: 'Este modelo no se puede usar ahora', acceptsHint: 'Admite pistas de reconocimiento', noHint: 'Sin pistas de reconocimiento',
  followDefault: (facts: string) => `Usa el predeterminado · ${facts}`,
};
