import type { TasksMessages } from './tasks-copy.ts';

export const ru: TasksMessages = {
  help: "Использование:\n  baocut tasks contract <task id> [--revision <n>]\n                                   Показать контракт задачи: цель, область, ограничения, запреты изменений,\n                                   результаты, режим доступа, бюджет и использование, приёмочные проверки и результаты\n  baocut tasks history <task id>   История версий контракта (кто, когда и какие поля изменил)\n  baocut tasks list --conversation <session id>\n                                   Последний контракт каждой задачи сессии",
  usage: "Использование: baocut tasks contract <task id> [--revision <n>] | history <task id> | list --conversation <session id>",
  revisionPositive: "--revision должен быть положительным целым числом",
  changeBy: { user: "вы", agent: "агент", runtime: "Runtime (по умолчанию)" },
  changeReason: {
    created: "создано",
    updated: "изменено",
    mode: "сменил режим доступа",
    goal: "изменил цель",
  },
  outcomeLabels: { passed: "Пройдено", failed: "Ошибка", skipped: "Пропущено" },
  change: (by: string, reason: string, fields: readonly string[], at: string) => `${reason} от ${by}${fields.length > 0 ? `: ${fields.join(", ")}` : ""}, ${at}`,
  wholeVideo: "всё видео",
  entity: (id: string) => `объект ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `${paths.join(", ")} объекта ${id}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) => `кадры ${from}–${to} последовательности ${sequenceId}${trackIds.length ? ` (дорожки ${trackIds.join(", ")})` : ""}`,
  protection: (id: string, videoId: string, what: string, note: string | null) => `${id}  видео ${videoId}: ${what}${note ? ` (${note})` : ""}`,
  noBudget: "Без лимита (применяется только бюджет каждого разрешения)",
  calls: (calls: number, reserved: number, max: number | null) => `${calls}${reserved ? `+${reserved} зарезервировано` : ""}${max !== null ? `/${max}` : ""} ${max === null && calls === 1 && !reserved ? "вызов" : "вызовов"}`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) => `${calls}${spent ? `, ${spent} потрачено` : ""}${reserved ? `, ${reserved} зарезервировано` : ""}${cap ? `, лимит ${cap}` : ""}${unknownCostCalls ? ` (${unknownCostCalls} с неизвестной стоимостью)` : ""}`,
  latest: "последняя",
  latestIs: (revision: number) => `последняя версия ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) => `Задача ${taskId}  версия контракта ${revision} (${latest})  ${change}`,
  goal: (goal: string) => `Цель: ${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) => `Сессия: ${conversationId}  Видео: ${videoId ?? 'none'}${baseRevision ? ` (версия ${baseRevision})` : ""}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) => `Область: ${s.videoId ? `видео ${s.videoId}` : "видео не указано"}${s.sequenceId ? `, последовательность ${s.sequenceId}` : ""}${s.itemIds.length ? `, выделено ${s.itemIds.join(", ")}` : ""}${s.range ? `, ${s.range.from}–${s.range.to} с` : ""}`,
  access: (mode: string, scopeRef: string) => `Режим доступа: ${mode}  Область разрешений: ${scopeRef}`,
  budgetLine: (budget: string) => `Бюджет: ${budget}`,
  supersedes: (taskId: string, stopped: boolean) => `Заменяет: задачу ${taskId} (работа прежней задачи ${stopped ? "остановлена" : "сохранена как вариант"})`,
  constraints: (empty: boolean) => (empty ? "Ограничения: нет" : "Ограничения:"),
  protectedRefs: (empty: boolean) => (empty ? "Не менять: нет" : "Не менять:"),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? ` (${language})` : ""}`,
  deliverables: (items: readonly string[]) => (items.length ? `Результаты: ${items.join(", ")}` : "Результаты: не указаны"),
  checks: (empty: boolean) => (empty ? "Приёмочные проверки: нет" : "Приёмочные проверки:"),
  outcome: (label: string, byAgent: boolean, note: string | null) => `${label} (записано: ${byAgent ? "агент" : "вы"}${note ? `: ${note}` : ""})`,
  notRecorded: "не записано",
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) => `  ${id}  [${kind}${required ? ", обязательно" : ""}] ${description} — ${outcome}`,
  noContracts: "Нет контрактов",
  historyLine: (revision: number, change: string, mode: string) => `Версия ${revision}  ${change}  режим ${mode}`,
  noTasks: "В сессии ещё нет задач",
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  версия ${revision}  ${mode}  ${goal}`,
};
