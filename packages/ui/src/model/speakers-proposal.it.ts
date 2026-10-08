import type { SpeakersProposalMessages } from './speakers-proposal.ts';
import { pluralForm } from '@baocut/protocol';

export const it: SpeakersProposalMessages = {
  stages: ['Impronte vocali', 'Raggruppamento', 'Riordino'],
  nameEmpty: 'Il nome non può essere vuoto',
  nameTooLong: (max: number) => pluralForm('it', max, { one: `I nomi possono contenere al massimo ${max} carattere`, other: `I nomi possono contenere al massimo ${max} caratteri` }),
  receipt: (speakers: number, duration: string, engine: string) => `Applicato · ${pluralForm('it', speakers, { one: `${speakers} parlante trovato`, other: `${speakers} parlanti trovati` })} · ${duration} · ${engine}`,
};
