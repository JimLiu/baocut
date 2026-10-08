import { pluralForm } from '../../i18n.ts';
import type { JobsParamsMessages } from './params.ts';

export const ru: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `Неизвестный параметр ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `Параметр ${p.key} ${p.problem}`,
  mustBeNonEmptyString: "должен быть непустой строкой",
  atMostChars: (p: { max: number }) => pluralForm('ru', p.max, { one: `должен содержать не более ${p.max} символа`, few: `должен содержать не более ${p.max} символов`, many: `должен содержать не более ${p.max} символов`, other: `должен содержать не более ${p.max} символа` }),
  mustBeIntegerBetween: (p: { min: number; max: number }) => `должен быть целым числом от ${p.min} до ${p.max}`,
  mustBeOneOf: (p: { values: string }) => `должен быть одним из ${p.values}`,
  mustBeArray: "должен быть массивом",
  atLeastItems: (p: { min: number }) => pluralForm('ru', p.min, { one: `должен содержать не менее ${p.min} элемента`, few: `должен содержать не менее ${p.min} элементов`, many: `должен содержать не менее ${p.min} элементов`, other: `должен содержать не менее ${p.min} элемента` }),
  atMostItems: (p: { max: number }) => pluralForm('ru', p.max, { one: `должен содержать не более ${p.max} элемента`, few: `должен содержать не более ${p.max} элементов`, many: `должен содержать не более ${p.max} элементов`, other: `должен содержать не более ${p.max} элемента` }),
  mustBeBoolean: "должен быть true или false",
  mustBeLanguageTag: "должен быть языковым тегом BCP 47",
  mustBeAbsolutePath: "должен быть абсолютным путём",
  itemsMustBeAbsolutePaths: "должен содержать только абсолютные пути",
  onlyOneOf: (p: { other: string }) => `нельзя сочетать с ${p.other}`,
  createExcludesVideoId: "создаёт новое видео и не может сочетаться с videoId",
  targetShape: "должен быть { videoId }, { entryId } или { create }",
};
