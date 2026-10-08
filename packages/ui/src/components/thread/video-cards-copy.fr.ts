import type { VideoCardsMessages } from './video-cards-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: VideoCardsMessages = {
  earlier: (count) => `${count} ${pluralForm('fr', count, { one: 'précédent', other: 'précédents' })}`, pending: (count) => `${count} à vérifier`,
  earlierWithPending: (count, pending) => `${count} ${pluralForm('fr', count, { one: 'précédent', other: 'précédents' })}, ${pending} à vérifier`, earlierList: 'Éléments précédents',
};
