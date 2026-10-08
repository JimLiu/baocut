import type { TaskFactsMessages } from './task-facts.ts';
import { pluralForm } from '@baocut/protocol';

export const es: TaskFactsMessages = {
  fact: {
    kind: 'Tipo', submitter: 'Iniciado por', status: 'Estado', startedAt: 'Inicio',
    runsOn: 'Se ejecuta en', language: 'Idioma', phase: 'Fase', images: 'Imágenes',
    took: 'Tiempo empleado', cost: 'Coste',
  },
  imageCount: (count: number) => `${count} ${pluralForm('es', count, { one: 'imagen', other: 'imágenes' })}`,
};
