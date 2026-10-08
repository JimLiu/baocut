import type { SpeakersProposalMessages } from './speakers-proposal.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: SpeakersProposalMessages = {
  stages: ['Impressões vocais', 'Agrupamento', 'Organização'],
  nameEmpty: 'O nome não pode ficar vazio',
  nameTooLong: (max: number) => pluralForm('pt-BR', max, { one: `Os nomes podem ter no máximo ${max} caractere`, other: `Os nomes podem ter no máximo ${max} caracteres` }),
  receipt: (speakers: number, duration: string, engine: string) => `Aplicado · ${pluralForm('pt-BR', speakers, { one: `${speakers} falante encontrado`, other: `${speakers} falantes encontrados` })} · ${duration} · ${engine}`,
};
