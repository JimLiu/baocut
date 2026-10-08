import type { ToolsTextMessages } from './tools-text.ts';

export const ru: ToolsTextMessages = {
  emptyInput: "Сначала введите, что создать",
  tooLong: (max) => `До ${max} символов за раз`,
  sample: "Напишите озвучку на 30 секунд для видео прогулки по городу. Используйте естественный тон, расскажите об улицах, кафе и сумерках.",
  counter: (n, max) => `${n} / ${max} символов`,
  connectTextModel: "Сначала подключите текстовую модель",
  connectFirst: (provider) => `Сначала подключите ${provider}`,
  effortFixed: "Уровень рассуждений · для этой модели не меняется",
  effort: (label) => `Уровень рассуждений · ${label} (по умолчанию задаётся на странице «Модели»)`,
  auto: "Авто",
  headerChip: (provider) => `Онлайн · ${provider} · оплата по токенам`,
  fileStem: "Созданный текст",
  chars: (n) => `${n} символов`,
  outputTokens: (n) => `${n} выходных токенов`,
  truncated: "Достигнут лимит вывода; остаток обрезан",
};
