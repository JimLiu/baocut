import { pluralForm } from '@baocut/protocol';
import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const pl: SpeakersProposalMessages = {
  stages: ["Odciski głosu", "Grupowanie", "Porządkowanie"],
  nameEmpty: "Nazwa nie może być pusta",
  nameTooLong: (max: number) => pluralForm('pl', max, { one: `Nazwa może mieć najwyżej ${max} znak`, few: `Nazwa może mieć najwyżej ${max} znaki`, many: `Nazwa może mieć najwyżej ${max} znaków`, other: `Nazwa może mieć najwyżej ${max} znaku` }),
  receipt: (speakers: number, duration: string, engine: string) => `Zastosowano · ${pluralForm('pl', speakers, { one: `Znaleziono ${speakers} mówcę`, few: `Znaleziono ${speakers} mówców`, many: `Znaleziono ${speakers} mówców`, other: `Znaleziono ${speakers} mówcy` })} · ${duration} · ${engine}`,
};
