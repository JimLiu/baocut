import { pluralForm } from '@baocut/protocol';
import type { ToolsImageMessages } from './tools-image-copy.ts';

export const ru: ToolsImageMessages = {
  emptyPrompt: "Сначала опишите изображение",
  promptTooLong: (n, max) => `Длина запроса: ${n} символов · максимум для этой модели: ${max}`,
  maxImages: (max: number) => pluralForm('ru', max, { one: `До ${max} изображения за раз`, few: `До ${max} изображений за раз`, many: `До ${max} изображений за раз`, other: `До ${max} изображения за раз` }),
  seedInteger: "Сид должен быть целым числом",
  pickModel: "Сначала выберите модель",
  downloadFirst: (label) => `Сначала скачайте ${label}`,
  connectFirst: (provider) => `Сначала подключите ${provider}`,
  local: "На этом компьютере",
  steps: (n: number) => pluralForm('ru', n, { one: `${n} шаг`, few: `${n} шага`, many: `${n} шагов`, other: `${n} шага` }),
  deviceTime: "Время зависит от вашего устройства",
  offline: "Работает офлайн",
  images: (n: number) => pluralForm('ru', n, { one: `${n} изображение`, few: `${n} изображения`, many: `${n} изображений`, other: `${n} изображения` }),
  aspects: (n: number) => pluralForm('ru', n, { one: `${n} соотношение сторон`, few: `${n} соотношения сторон`, many: `${n} соотношений сторон`, other: `${n} соотношения сторон` }),
  providerSize: "Размер задаёт поставщик",
  takesSeed: "Поддерживает сид",
  localChip: "Создаётся на этом компьютере · офлайн",
  cloudChip: (provider) => `Онлайн · ${provider} · оплата по использованию`,
  imageName: (n) => `Изображение ${n}`,
  seed: (seed) => `Сид ${seed}`,
  decoding: "Декодирование",
  stepOf: (done, total) => `Шаг ${done}/${total}`,
};
