import { pluralForm } from '../../i18n.ts';
import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const ru: JobsCaptionLayerMessages = {
  label: "Добавить слой субтитров",
  noSource: "Нет документа для добавления слоя субтитров",
  videoClosed: "Видео закрыто, слой субтитров не добавлен. Откройте видео и повторите попытку.",
  empty: "В документе нет субтитров для отображения, слой субтитров не добавлен",
  notOnTimeline: "Ни один клип на таймлайне не использует этот материал, поэтому субтитры не могут появиться на экране. Слой субтитров не добавлен.",
  noDocumentId: "Слой субтитров добавлен, но ID его документа не возвращён",
  rejected: "Транзакция добавления слоя субтитров отклонена",
  documentGone: "Документа слоя субтитров больше нет в видео",
  needsOutputStore: "Для чтения субтитров Speech Worker нужно хранилище результатов",
  notSpeech: "Документ не является расшифровкой",
  speechUnreadable: "Не удалось прочитать текст расшифровки",
  translationUnreadable: "Не удалось прочитать текст перевода",
  unaligned: (p: { count: number }) => pluralForm('ru', p.count, { one: `${p.count} единица перевода не выровнена (alignment равен null), поэтому её время нельзя определить`, few: `${p.count} единицы перевода не выровнены (alignment равен null), поэтому их время нельзя определить`, many: `${p.count} единиц перевода не выровнены (alignment равен null), поэтому их время нельзя определить`, other: `${p.count} единицы перевода не выровнено (alignment равен null), поэтому время нельзя определить` }),
  noSourceSpeech: "Не удалось найти расшифровку, из которой сделан перевод",
  subtitlesName: "Субтитры",
  translationName: "Перевод",
  styleName: "Стиль субтитров",
};
