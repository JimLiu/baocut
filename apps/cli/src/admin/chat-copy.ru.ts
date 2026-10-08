import type { ChatMessages } from './chat-copy.ts';

export const ru: ChatMessages = {
  help: "Использование:\n  baocut chat <message> [options]  Отправить сообщение и вывести ответ\n    --project <dir>                Общение в папке проекта (проект определяется по\n                                   .bcut/project.json в папке, файл создаётся при отсутствии)\n    --conversation <id>            Продолжить существующую сессию\n    --template <id>                Прикрепить шаблон сцены (сцена из baocut templates): Runtime добавляет\n                                   руководство и тело шаблона к сообщению; примеры нельзя прикреплять;\n                                   отправьте запрос примера (baocut templates show <id>) как сообщение\n    --skill <id>                   Выбрать Skill (из baocut skills, даже отключённый):\n                                   Runtime добавляет содержимое SKILL.md к сообщению\n    --mode <ask|auto-accept-edits|auto|full-access|plan>\n                                   Сменить режим доступа сессии (для следующих действий); без параметра режим сохраняется,\n                                   либо используется agent.defaultAccessMode (по умолчанию auto), если режим ещё не меняли\n    --yes                          Автоматически одобрять запросы (только эта сессия)",
  missingMessage: "Не указан текст сообщения",
  templateIsExample: (title, id) => `«${title}» — пример, его нельзя прикрепить: получите запрос через baocut templates show ${id} и отправьте как сообщение`,
  sessionCreated: (id, cwd) => `Сессия ${id}  рабочая папка ${cwd}`,
  disconnected: (reason) => `Потеряно соединение с Runtime: ${reason}`,
  sessionDeleted: "Сессия удалена",
  stopping: "Остановка…",
  chatTemplate: (id) => `Шаблон: ${id}`,
  chatSkill: (id) => `Skill: ${id}`,
  chatMode: (mode) => `Режим доступа: ${mode}`,
  taskEnded: (status, error) => `Задача: ${status}${error ? ` — ${error}` : ""}`,
  taskStatus: { completed: "Готово", stopped: "Остановлено", failed: "Ошибка" },
  taskFailed: "Задача завершилась ошибкой",
  toolCallFinished: (title, status, exitCode) => `▸ ${title} — ${status}${exitCode !== null ? ` (код завершения ${exitCode})` : ""}`,
  approvalNeeded: (what) => `Нужно одобрение — ${what}`,
  approvalReason: (isTool, reason) => `${isTool ? "Содержание" : "Причина"}: ${reason}`,
  approvalMode: (mode) => `Текущий режим: ${mode}`,
  autoApproved: "Одобрено автоматически (--yes)",
  declinedNotTty: "Запуск вне терминала: отклонено (добавьте --yes для автоматического одобрения)",
  approvalQuestion: "Одобрить? [y] да / [s] сессия / [N] нет ",
};
