import { pluralForm } from '@baocut/protocol';
import type { GrantsMessages } from './grants-copy.ts';

export const ru: GrantsMessages = {
  help: "Использование:\n  baocut grants [list]             Список разрешений передачи данных (онлайн-поставщики и агенты):\n                                   получатель, виды данных, область, использование и бюджет\n    --recipient <id>               Только разрешения поставщика\n    --video <video id>             Только разрешения для видео\n    --include-ended                Также отозванные, истёкшие и исчерпанные\n  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]\n                                   Выдать разрешение. Виды данных: transcript (расшифровки и переводы), frames (кадры),\n                                   audio (аудио), video (исходное видео), document (текст и запросы), context (контекст агента)\n    --video <video id|all>         Только это видео; без параметра или all – все видео\n    --max-calls <n>                Лимит вызовов; без параметра не ограничен\n    --budget <amount> --currency <currency>\n                                   Лимит расходов: оценка и резервирование по цене модели;\n                                   модели без цен отклоняются (BUDGET_UNVERIFIABLE)\n    --expires <ISO time>           Время истечения\n  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]\n                         [--budget <amount|none> --currency …] [--expires <time|none>]\n                                   Изменить разрешение; сужение, уменьшение лимита или сокращение срока\n                                   отклоняет вызовы в очереди по старым условиям при запуске\n  baocut grants revoke <id>        Отозвать разрешение: будущие вызовы запрещены; отправленные данные\n                                   и учтённые расходы сообщаются без изменений\n  baocut grants usage <id>         Использование разрешения и задачи (резервы и расчёты)",
  usage:
    'Usage: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]' +
    ' | update <grant id> [options] | revoke <grant id> | usage <grant id>]',
  listSep: ", ",
  missingRecipient: "Не указан --recipient (поставщик-получатель данных, например openai)",
  missingData: (kinds: readonly string[]) => `Не указан --data (виды данных через запятую: ${kinds.join(", ")})`,
  missingPurpose: "Не указан --purpose (одно предложение для пользователя)",
  recipientFixed: "Получателя нельзя сменить: отзовите разрешение и создайте новое",
  nothingToUpdate: "Нет изменений: укажите --data, --video, --purpose, --max-calls, --budget или --expires",
  persistOnly: "--scope, --max-calls, --budget и --expires применяются только с --persist",
  scopeChoices: "--scope принимает video или all",
  unknownKinds: (unknown: string, kinds: readonly string[]) => `Неизвестный вид данных: ${unknown}. Выберите из ${kinds.join(", ")}`,
  maxCallsRange: "--max-calls должен быть целым числом от 1 до 1000000 либо none (без лимита)",
  currencyNeedsBudget: "--currency применяется только с --budget",
  budgetFormat: "--budget должен быть неотрицательной десятичной суммой до 6 знаков после запятой (например, 5 или 2.50)",
  budgetNeedsCurrency: "--budget требует --currency <трёхбуквенный код валюты, например USD>",
  expiresFormat: "--expires должен быть временем ISO с часовым поясом (например, 2026-12-31T23:59:59Z) либо none",
  stateLabels: {
    active: "Активный",
    expired: "Истекло",
    revoked: "Отозвано",
    exhausted: "Исчерпано",
  },
  originLabels: {
    user: "выдано вами",
    approval: "выдано при одобрении",
    'provider-enable': "по умолчанию при включении",
  },
  calls: (calls: number, reserved: number, max: number | null) => `${calls}${reserved ? `+${reserved} зарезервировано` : ""}${max !== null ? `/${max}` : ""} ${max === null && calls === 1 && !reserved ? "вызов" : "вызовов"}`,
  unknownCostCalls: (n: number) => ` (${n} с неизвестной стоимостью)`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) => `${calls}, ${amount}${reserved ? `+${reserved} зарезервировано` : ""}/${cap} ${currency}`,
  noGrants: "Нет разрешений: вызовы онлайн-поставщиков и агентов требуют одобрения (или создайте через baocut grants create)",
  scopeVideo: (videoId: string) => `видео ${videoId}`,
  scopeAll: "все видео",
  grantLine: (g: {
    id: string;
    state: string;
    recipient: string;
    kinds: string;
    scope: string;
    taskId: string | null;
    once: boolean;
    usage: string;
    expiresAt: string | null;
    origin: string;
    purpose: string;
  }) => `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, только задача ${g.taskId}` : ""}${g.once ? ", только один раз" : ""}  использование ${g.usage}${g.expiresAt ? `, истекает ${g.expiresAt}` : ""}  (${g.origin}: ${g.purpose})`,
  revoked: (id: string, recipient: string, kinds: string) => `Отозвано ${id} (${recipient} ← ${kinds})`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) => `Уже отправлено: ${calls} ${pluralForm('ru', calls, { one: "вызов", few: "вызова", many: "вызовов", other: "вызова" })}${amount ? `, ${amount} учтено` : ""}${unknownCostCalls ? ` (${unknownCostCalls} с неизвестной стоимостью)` : ""}`,
  runningJobs: (jobs: readonly string[]) => `Задачи ещё выполняются (завершатся как обычно): ${jobs.join(", ")}`,
  noJobs: "(Ещё не использовано задачами либо записи очищены)",
  settled: (calls: number, amount: string, basis: string) => `рассчитано ${calls} ${pluralForm('ru', calls, { one: "вызов", few: "вызова", many: "вызовов", other: "вызова" })} ${amount} (${basis})`,
  unsettled: "не рассчитано",
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) => `  ${jobId}  ${state}  зарезервировано ${calls} ${pluralForm('ru', calls, { one: "вызов", few: "вызова", many: "вызовов", other: "вызова" })} ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) => `    Отправляет: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (видео ${a.videoId})` : ""}: ${a.purpose}${a.estimate ? `, оценка ${a.estimate}` : ", стоимость неизвестна"}${a.maxCalls !== null ? `, не более ${a.maxCalls} ${pluralForm('ru', a.maxCalls, { one: "вызов", few: "вызова", many: "вызовов", other: "вызова" })}` : ""}${a.reason === 'revoked' ? ", разрешение отозвано или истекло" : a.reason === 'unverifiable' ? ", стоимость не оценивается" : ""}`,
};
