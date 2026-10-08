import type { VideoCardsMessages } from './video-cards-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const nl: VideoCardsMessages = { earlier: (count) => `${count} eerdere`, pending: (count) => `${count} ${pluralForm('nl', count, { one: 'vraagt aandacht', other: 'vragen aandacht' })}`, earlierWithPending: (count, pending) => `${count} eerdere, ${pending} ${pluralForm('nl', pending, { one: 'vraagt aandacht', other: 'vragen aandacht' })}`, earlierList: 'Eerdere items' };
