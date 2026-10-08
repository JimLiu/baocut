import type { ApprovalsMessages } from './approvals-copy.ts';

export const ru: ApprovalsMessages = {
  help: "Использование:\n  baocut approvals                 Список ожидающих одобрений из сессий и внешних сервисов\n  baocut approvals allow <id>      Разрешить ожидающее одобрение; передача данных по умолчанию\n                                   разрешается только один раз (стоимость неизвестна)\n    --persist                      Также выдать постоянное разрешение (такая передача больше не запрашивается)\n    --scope <video|all>            Область постоянного разрешения: видео этого вызова (по умолчанию) или все видео\n    --max-calls <n>                Лимит вызовов постоянного разрешения\n    --budget <amount> --currency <currency>\n                                   Лимит расходов постоянного разрешения (только модели с ценами;\n                                   вызовы без оценки стоимости требуют одобрения каждый раз)\n    --expires <ISO time>           Время истечения постоянного разрешения\n  baocut approvals deny <id>       Отклонить ожидающее одобрение",
  persistNeedsAllow: "--persist применяется только с allow",
  alreadyResolved: (id) => `Одобрение ${id} уже обработано, просрочено, отменено или не существует`,
  allowed: (id) => `Разрешено ${id}`,
  denied: (id) => `Отклонено ${id}`,
  unknownMode: (value: string, flags: readonly string[]) => `Неизвестный режим доступа: ${value}. --mode принимает ${flags.join(", ")}`,
  mode: (label: string, flag: string) => `${label} (${flag})`,
  usage: "Использование: baocut approvals [list | allow <approval id> | deny <approval id>]",
  riskLabels: { read: "Чтение", edit: "Изменить", command: "Команда", high: "Высокий риск" },
  none: "Нет ожидающих одобрений",
  fromSession: (title: string) => `Сессия «${title}"`,
  fromService: (serviceId: string, clientName: string) => `Сервис ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `режим ${mode}`,
  basisLevel: (level: string) => `уровень ${level}`,
  approvalLine: (a: {
    id: string;
    who: string;
    action: string;
    targets: readonly string[];
    risk: string;
    summary: string;
    basis: string;
    secondsLeft: number | null;
  }) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(", ")}` : ""}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? "" : `, автоматически отклонено в ${a.secondsLeft} с`})`,
  runCommand: (command: string) => `Выполнить команду: ${command}`,
  changeFiles: (files: readonly string[]) => `Изменить файлы: ${files.join(", ")}`,
  callTool: (tool: string, files: readonly string[]) => `Вызвать ${tool}${files.length > 0 ? `: ${files.join(", ")}` : ""}`,
};
