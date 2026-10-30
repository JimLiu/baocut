import type { AgentTurnMessages } from './agent-turn.ts';

export const ru: AgentTurnMessages = {
  answer: 'Ожидание вашего ответа',
  waiting: "Ожидание вашего одобрения",
  working: "Выполняется",
  stopping: "Остановка",
  worked: (span: string) => `Работа заняла ${span}`,
  stoppedAfter: (span: string) => `Остановлено · работа заняла ${span}`,
  stopped: "Остановлено",
  failed: (error: string | null) => `Ошибка · ${error ?? "неизвестная причина"}`,
  stepStatus: { declined: "Отклонено", interrupted: "Прервано" },
  exitCode: (code: number) => `Код завершения ${code}`,
  stepDeclined: "Этот шаг отклонён",
  commandExited: (code: number) => `Команда завершилась с кодом ${code}`,
  stepIncomplete: "Этот шаг не завершён",
  stepLines: (from, to) => (to === null ? `Со строки ${from}` : `Строки ${from}–${to}`),
  stepMatches: (count) => `Совпадений: ${count}`,
  stepFiles: (count) => `Файлов: ${count}`,
  stepHttp: (status) => `HTTP ${status}`,
  lineRange: (path: string, line: number, end: number) => `${path} · строки ${line}–${end}`,
  lineCol: (path: string, line: number, col: number) => `${path} · строка ${line}, столбец ${col}`,
  line: (path: string, line: number) => `${path} · строка ${line}`,
};
