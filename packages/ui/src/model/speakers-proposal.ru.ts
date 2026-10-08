import { pluralForm } from '@baocut/protocol';
import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const ru: SpeakersProposalMessages = {
  stages: ["Голосовые отпечатки", "Кластеризация", "Упорядочивание"],
  nameEmpty: "Имя не может быть пустым",
  nameTooLong: (max: number) => pluralForm('ru', max, { one: `Имя может содержать не более ${max} символа`, few: `Имя может содержать не более ${max} символов`, many: `Имя может содержать не более ${max} символов`, other: `Имя может содержать не более ${max} символа` }),
  receipt: (speakers: number, duration: string, engine: string) => `Применено · ${pluralForm('ru', speakers, { one: `Найден ${speakers} говорящий`, few: `Найдено ${speakers} говорящих`, many: `Найдено ${speakers} говорящих`, other: `Найдено ${speakers} говорящего` })} · ${duration} · ${engine}`,
};
