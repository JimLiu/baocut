import { pluralForm } from '@baocut/protocol';
import type { ThreadMessages } from './thread-copy.ts';

export const ru: ThreadMessages = {
  withDetail: (text, detail) => `${text} (${detail})`,
  copy: "Копировать",
  copied: "Скопировано",
  copyFailed: "Не удалось скопировать. Повторите попытку",
  copyCode: "Скопировать код",
  copyReply: "Скопировать этот ответ",
  change: {
    added: (n) => `Добавлено: ${n}`,
    updated: (n) => `Изменено: ${n}`,
    deleted: (n) => `Удалено: ${n}`,
    duration: (clock) => `Длительность ${clock}`,
    durationChange: (before, after) => `Длительность ${before} → ${after}`,
    revision: (before, after) => `Версия ${before} → ${after}`,
    locked: "Сейчас видео нельзя изменить",
    undoStep: (videoName, label) => `Отменён шаг в видео «${videoName}»: ${label}`,
    changed: (videoName, label) => `Изменено видео «${videoName}»: ${label}`,
    aria: (label) => `Изменение видео: ${label}`,
  },
  message: {
    contextTitle: "Состояние редактора отправлено с сообщением",
    context: (videoName, revision, playhead, selected) => `«${videoName}» · версия ${revision} · курсор воспроизведения ${playhead}${selected ? ` · ${pluralForm('ru', selected, { one: `Выбран ${selected} клип`, few: `Выбраны ${selected} клипа`, many: `Выбрано ${selected} клипов`, other: `Выбрано ${selected} клипа` })}` : ''}`,
  },
  output: {
    aria: (name, detail) => `${name}, ${detail}`,
  },
  steps: {
    more: (n) => `выполняется: ${n}`,
    failed: (n) => `${n} с ошибкой`,
    thinking: "Рассуждение",
    viewFile: (name) => `Показать ${name}`,
    input: "Входные данные",
    error: "Ошибка",
    output: "Результат",
    waiting: "Ожидание результата",
    noOutput: "Нет результата",
  },
};
