import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const ru: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `Размер файла субтитров: ${p.bytes} байт, превышает лимит ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `Более ${p.limit} субтитров`,
  invalidAt: (p: { line: number; problem: string }) => `Строка файла субтитров ${p.line}: ${p.problem}`,
  nul: "Файл содержит символы NUL и не похож на текстовые субтитры",
  vttHeader: "Файл WebVTT должен начинаться с WEBVTT",
  vttHeaderBlank: "Оставьте пустую строку после заголовка WEBVTT перед субтитрами",
  empty: "В файле нет субтитров",
  noTiming: "В блоке есть текст, но нет строки времени",
  tooManyIdLines: "Перед строкой времени может быть только одна строка с номером или идентификатором",
  srtIndex: (p: { id: string }) => `Строка индекса SRT должна быть числом: ${p.id}`,
  badTiming: (p: { timing: string }) => `Неверный формат строки времени: ${p.timing}`,
  endBeforeStart: "Время окончания раньше времени начала",
  timingInText: "В тексте субтитров есть строка времени (возможно, между субтитрами нет пустой строки)",
  cueTooLong: (p: { max: number }) => `Текст субтитра длиннее ${p.max} символов`,
  minuteSecondRange: "Минуты или секунды превышают 59",
};
