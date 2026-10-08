import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const ru: TranscribeSpeakersMessages = {
  packFallback: "Разделение говорящих",
  builtinNote: (model: string) => `${model} сам различает говорящих во время расшифровки`,
  builtinSummary: "Определение говорящих · встроено в модель",
  noneNote: (model: string) => `${model} не различает говорящих. Если это нужно, выберите локальную модель или сервис со встроенной поддержкой`,
  missingNote: (pack: string, size: string | null) => `Сначала скачайте «${pack}»${size ? ` (${size})` : ""} для различения говорящих`,
  missingSummary: "Определение говорящих · сначала скачайте модель",
  onNote: "После расшифровки функция «Разделение говорящих» отмечает говорящего для каждого предложения, и имена появляются в субтитрах и расшифровке",
  summaryOn: "Определить спикеров",
  offNote: "Говорящие не различаются; в субтитрах и расшифровках не будет имён",
  summaryOff: "Не определять говорящих",
  downloading: (pack: string, pct: number | null) => `Скачивание «${pack}»${pct === null ? "…" : ` · ${pct}%`}`,
};
