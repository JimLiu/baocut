import { pluralForm } from '@baocut/protocol';
import type { TaskFactsMessages } from './task-facts.ts';

export const ru: TaskFactsMessages = {
  fact: {
    kind: "Тип",
    submitter: "Запустил",
    status: "Статус",
    startedAt: "Начало",
    runsOn: "Выполняется на",
    language: "Язык",
    phase: "Этап",
    images: "Изображения",
    took: "Затраченное время",
    cost: "Стоимость",
  },
  imageCount: (count: number) => pluralForm('ru', count, { one: `${count} изображение`, few: `${count} изображения`, many: `${count} изображений`, other: `${count} изображения` }),
};
