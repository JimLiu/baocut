import type { TaskFactsMessages } from './task-facts.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: TaskFactsMessages = {
  fact: { kind: 'Type', submitter: 'Lancé par', status: 'État', startedAt: 'Début', runsOn: 'Exécuté sur', language: 'Langue', request: 'Instructions', phase: 'Phase', images: 'Images', took: 'Durée', left: 'Temps restant', cost: 'Coût' },
  imageCount: (count) => `${count} ${pluralForm('fr', count, { one: 'image', other: 'images' })}`,
};
