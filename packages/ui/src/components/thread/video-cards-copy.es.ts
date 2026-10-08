import type { VideoCardsMessages } from './video-cards-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: VideoCardsMessages = { earlier: (count) => `${count} anteriores`, pending: (count) => `${count} ${pluralForm('es', count, { one: 'necesita atención', other: 'necesitan atención' })}`, earlierWithPending: (count, pending) => `${count} anteriores, ${pending} ${pluralForm('es', pending, { one: 'necesita atención', other: 'necesitan atención' })}`, earlierList: 'Elementos anteriores' };
