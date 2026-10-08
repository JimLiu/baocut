import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const ru: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Протокол Speech Worker не равен ${p.protocol}`,
  exited: "Speech Worker неожиданно завершился",
  translationLanguage: "Язык перевода не совпадает с целевым",
  outputInvalid: "Результат Speech Worker не соответствует контракту",
  outputTruncated: "Результат модели достиг лимита и обрезан",
  resultMissing: (p: { field: string }) => `В результате Speech Worker отсутствует ${p.field}`,
  unreadableFile: (p: { name: string }) => `Не удалось прочитать ${p.name}, записанный Speech Worker`,
  cuesNotObject: "cues не является объектом",
  cuesSchema: (p: { schema: string }) => `schema для cues должна быть ${p.schema}`,
  cuesLanguage: "Язык cues не совпадает с целевым",
  cuesTimescale: "timescale для cues должна совпадать с исходной расшифровкой",
  cuesMissing: "Отсутствует cues",
  cueNotObject: (p: { n: number }) => `Субтитр ${p.n} не является объектом`,
  cueNoText: (p: { n: number }) => `Субтитр ${p.n} не имеет текста`,
  cueNoSentence: (p: { n: number }) => `Субтитр ${p.n} не имеет sentence или unit`,
  cueFallback: (p: { n: number }) => `Субтитр ${p.n} — fallback не является логическим значением`,
  cueTicks: (p: { n: number }) => `Субтитр ${p.n} — время не выражено целыми тиками`,
  cueRange: (p: { n: number }) => `Субтитр ${p.n} имеет недопустимый диапазон времени`,
  cueOverlap: (p: { n: number }) => `Субтитр ${p.n} перекрывает предыдущий или нарушает порядок`,
  cueBeyond: (p: { n: number }) => `Субтитр ${p.n} выходит за длительность медиа`,
};
