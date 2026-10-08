import type { VideoCardsMessages } from './video-cards-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: VideoCardsMessages = {
  earlier: (count: number) => `${count} precedenti`,
  pending: (count: number) => pluralForm('it', count, { one: `${count} richiede attenzione`, other: `${count} richiedono attenzione` }),
  earlierWithPending: (count: number, pending: number) => `${count} precedenti, ${pluralForm('it', pending, { one: `${pending} richiede attenzione`, other: `${pending} richiedono attenzione` })}`,
  earlierList: 'Voci precedenti',
};
