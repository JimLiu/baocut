import { pluralForm } from '../../i18n.ts';
import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}

function originalAction(original: string): string {
  switch (original) {
    case 'mute':
      return 'отключить';
    case 'keep':
      return 'сохранить';
    default:
      return 'приглушить';
  }
}

function transcodeAction(action: string, count: number): string {
  switch (action) {
    case 'merge':
      return "Объединить по порядку: " + pluralForm('ru', count, { one: `${count} файл`, few: `${count} файла`, many: `${count} файлов`, other: `${count} файла` });
    case 'extract-audio':
      return "Извлечь аудио: " + pluralForm('ru', count, { one: `${count} файл`, few: `${count} файла`, many: `${count} файлов`, other: `${count} файла` });
    default:
      return "Сжать: " + pluralForm('ru', count, { one: `${count} файл`, few: `${count} файла`, many: `${count} файлов`, other: `${count} файла` });
  }
}

export const ru: RcFlowToolsMessages = {
  listSeparator: ", ",

  transcribeVideoSummary: (p) => `Расшифровать ${p.asset ? `материал ${p.asset}` : "материал на основной дорожке"}${providerNote(p)}${p.captions ? " и добавить слой субтитров" : ""}`,
  transcribeFileSummary: (p) => `Расшифровать ${p.file}${providerNote(p)} и записать расшифровки TXT и SRT в ${p.outDir ?? "папку «Загрузки»"}`,
  transcribeCreateSummary: (p) => `Создать видео${p.name ? ` «${p.name}»` : ""}, импортировать ${p.file} и добавить на таймлайн, затем расшифровать${providerNote(p)}${p.captions ? " и добавить слой субтитров" : ""}`,

  translateVideoSummary: (p) => `Перевести расшифровку на ${p.to} с помощью текстовой модели${providerNote(p)}${p.captions ? ` и добавить ${p.bilingual ? "двуязычный " : ""}слой субтитров` : ""}`,
  translateFileSummary: (p) => `Перевести файл субтитров ${p.input} на ${p.to} с помощью текстовой модели${providerNote(p)} и записать новый файл в ${p.outDir ?? "папку «Загрузки»"}`,

  dubSummary: (p) => `Перевод с озвучкой${p.to ? ` (${p.to})` : ""}: ${p.translation ? `использовать перевод ${p.translation}` : "сначала перевести текстовой моделью"}, синтезировать по предложениям${providerNote(p)}${p.voice ? ` голосом ${p.voice}` : ""}, добавить новую дорожку озвучки и ${originalAction(p.original)} исходное аудио`,

  transcodeSummary: (p) => `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? "…" : ""}) и сохранить в ${p.outDir ?? "папку «Загрузки»"}`,
  transcribeReplaceSummary: (p) =>
    `Повторно расшифровать ${p.asset ? `материал ${p.asset}` : 'материал на основной дорожке'}${providerNote(p)} и заменить текущую расшифровку видео с переносом переводов, субтитров и озвучки (одно действие, которое можно отменить)`,
};
