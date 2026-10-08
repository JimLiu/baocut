import type { VideoCardsMessages } from './video-cards-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: VideoCardsMessages = {
  earlier: (count: number) => `${count} anteriores`,
  pending: (count: number) => pluralForm('pt-BR', count, { one: `${count} precisa de atenção`, other: `${count} precisam de atenção` }),
  earlierWithPending: (count: number, pending: number) => `${count} anteriores, ${pluralForm('pt-BR', pending, { one: `${pending} precisa de atenção`, other: `${pending} precisam de atenção` })}`,
  earlierList: 'Itens anteriores',
};
