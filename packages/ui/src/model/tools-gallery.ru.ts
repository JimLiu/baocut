import { pluralForm } from '@baocut/protocol';
import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const ru: ToolsGalleryMessages = {
  transcode: "Кодирование на этом компьютере с ffmpeg · ничего не отправляется",
  linkReady: "Инструмент скачивания готов",
  pipelineMissing: "В этой версии Runtime ещё нет пайплайна для этого инструмента, поэтому он пока недоступен",
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n: number) => pluralForm('ru', n, { one: `${n} локальная модель`, few: `${n} локальные модели`, many: `${n} локальных моделей`, other: `${n} локальной модели` }),
  cloudConnected: (n: number) => pluralForm('ru', n, { one: `Подключён ${n} онлайн-поставщик`, few: `Подключены ${n} онлайн-поставщика`, many: `Подключено ${n} онлайн-поставщиков`, other: `Подключено ${n} онлайн-поставщика` }),
  noSpeech: "Пока нет доступной модели синтеза речи",
  noImage: "Пока нет доступной модели генерации изображений",
  noText: "Пока нет доступной текстовой модели",
};
