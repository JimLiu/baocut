import { pluralForm } from '../../i18n.ts';
import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const ru: JobsTranslateSubtitlesMessages = {
  label: "Перевести файл субтитров",
  description: "Переводит файл субтитров SRT или WebVTT на другой язык, субтитр за субтитром, и записывает новый файл. Число субтитров и таймкоды не меняются; результат может быть двуязычным или в другом формате. Видео не изменяется.",
  stepRead: "Прочитать субтитры",
  stepTranslate: "Перевести",
  stepCheck: "Проверка",
  stepPublish: "Публикация",
  noStructuredOutput: (p: { model: string }) => `Модель ${p.model} не поддерживает структурированный вывод, поэтому не подходит для перевода`,
  artifactGone: (p: { artifactId: string }) => `Результат ${p.artifactId} больше не существует`,
  paramNotAbsolute: (p: { key: string }) => `Параметр ${p.key} должен быть абсолютным путём`,
  inputNotSubtitle: "Параметр input должен быть файлом .srt или .vtt",
  languageInvalid: (p: { key: string }) => `Параметр ${p.key} должен быть языковым тегом BCP 47`,
  bilingualInvalid: "Параметр bilingual должен быть true или false",
  fileNotFound: (p: { file: string }) => `Не удалось найти файл субтитров ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `Размер файла субтитров: ${p.bytes} байт, превышает лимит ${p.limit}`,
  noText: "В файле субтитров нет текста для перевода",
  allEmpty: "Все субтитры пусты",
  markupStripped: (p: { count: number }) => pluralForm('ru', p.count, { one: `${p.count} субтитр содержал разметку (курсив, цвет, позицию и прочее), не сохранённую в переводе`, few: `${p.count} субтитра содержали разметку (курсив, цвет, позицию и прочее), не сохранённую в переводе`, many: `${p.count} субтитров содержали разметку (курсив, цвет, позицию и прочее), не сохранённую в переводе`, other: `${p.count} субтитра содержало разметку (курсив, цвет, позицию и прочее), не сохранённую в переводе` }),
  cueNoTranslation: (p: { n: number }) => `Субтитр ${p.n} не содержит перевода`,
  rereadFailed: "Не удалось прочитать записанные субтитры",
  cueCountMismatch: (p: { written: number; original: number }) => `Число записанных субтитров: ${p.written}; в исходном файле: ${p.original}`,
  timingChanged: (p: { n: number; from: string; to: string }) => `Таймкод субтитра ${p.n} изменился: ${p.from} → ${p.to}`,
  cannotMatch: "Перевод нельзя записать как субтитры с взаимно однозначным соответствием исходному файлу",
  settingsDropped: (p: { settings: number; blocks: number }) => `Преобразовано в SRT: не сохранены cue settings для субтитров (${p.settings}) и блоки NOTE, STYLE и REGION (${p.blocks}), поскольку формат их не поддерживает`,
};
