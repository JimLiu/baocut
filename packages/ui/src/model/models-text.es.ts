import type { ModelsTextMessages } from './models-text.ts';
export const es: ModelsTextMessages = {
 effort: { minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto' }, auto: 'Automático',
 context: (tokens) => `Contexto ${tokens}`, maxOutput: (tokens) => `Salida máxima ${tokens}`,
 efforts: (labels) => `Esfuerzo de razonamiento ${labels.join(' / ')}`, noEffort: 'El esfuerzo de razonamiento no se puede ajustar',
};
