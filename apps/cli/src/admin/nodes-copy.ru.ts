import type { NodesMessages } from './nodes-copy.ts';

export const ru: NodesMessages = {
  nodesHelp: (port) => `Использование:
  baocut nodes                     Список сопряжённых узлов локальной сети (с живой проверкой каждого)
  baocut nodes discover            Найти узлы локальной сети с общим доступом (macOS)
  baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]
                                   Сопряжение по коду из «Общий доступ к этому компьютеру»
                                   другого компьютера; порт по умолчанию ${port}
  baocut nodes remove <nodeId|alias>
                                   Удалить узел и токен, сохранённые на этом компьютере`,
  noPairedNodes: "Нет сопряжённых узлов. Выполните сопряжение через baocut nodes pair <address[:port]> <pairing code>",
  noNodesDiscovered: "Узлы с общим доступом не найдены (поиск только в macOS; можно ввести адрес для сопряжения)",
  pairUsage: "Использование: baocut nodes pair <address[:port]> <pairing code> [--alias <alias>]",
  removeUsage: "Использование: baocut nodes remove <nodeId|alias>",
  paired: (description) => `Сопряжено: ${description}`,
  noSuchNode: (ref) => `Нет сопряжённого узла: ${ref}`,
  removed: (alias, nodeId) => `Удалено: ${alias} (${nodeId})`,
  invalidPort: (port) => `Недопустимый порт: ${port}`,
  shareHelp: (port, capabilities) => `Использование:
  baocut share [status]            Статус общего доступа: адрес, порт, переключатели возможностей,
                                   код сопряжения, сопряжённые компьютеры
  baocut share start [options]     Начать общий доступ и создать код сопряжения
    --port <port>                  По умолчанию ${port}
    --name <name>                  Имя для других, по умолчанию имя хоста
    --allow-any-source             Принимать любой адрес источника (по умолчанию только локальная сеть)
  baocut share stop                Остановить общий доступ (отменяет задачи других)
  baocut share code                Отменить старый код сопряжения и создать новый
  baocut share revoke <clientId>   Отозвать сопряжённый компьютер
  baocut share capability <capability> <on|off>
                                   Включить или отключить возможность (${capabilities.join(', ')}) немедленно:
                                   при отключении новые задачи других отклоняются;
                                   уже принятые выполняются до завершения`,
  portRange: "--port должен быть целым числом от 0 до 65535",
  shareRevokeUsage: "Использование: baocut share revoke <clientId>",
  capabilityLabels: { transcribe: "Расшифровка" },
  capabilityUsage: "Использование: baocut share capability <capability> <on|off> (например, baocut share capability transcribe off)",
  shareOff: "Выкл.",
  shareOn: "Вкл.",
  shareNotListening: (error: string | null) => `Включено, но не слушает${error ? `: ${error}` : ""}`,
  shareState: (state: string) => `Общий доступ к этому компьютеру: ${state}`,
  name: (name: string, nodeId: string | null) => `Имя: ${name}${nodeId ? ` (${nodeId})` : ""}`,
  port: (port: number, anySource: boolean) => `Порт: ${port}${anySource ? " (любой адрес источника)" : ""}`,
  addresses: (addresses: string | null) => `Адреса: ${addresses ?? '(no local network address)'}`,
  capabilitiesHead: (empty: boolean) => `Возможности: ${empty ? "нет" : ""}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) => `  ${label} (${capability}): ${enabled ? "вкл." : `выкл. (включите через baocut share capability ${capability} on)`}`,
  pairingCode: (code: string, until: string) => `Код сопряжения: ${code} (действует до ${until})`,
  pairingLocked: (until: string) => `Сопряжение заблокировано до ${until} (baocut share code разблокирует сейчас)`,
  noPairingCode: "Код сопряжения: нет (baocut share code создаёт)",
  clientsHead: (empty: boolean) => `Сопряжённые компьютеры: ${empty ? "нет" : ""}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) => `  ${name}  ${clientId}  сопряжено ${pairedAt}${lastSeenAt ? `  последний контакт ${lastSeenAt}` : ""}`,
  remoteTasks: (running: number, queued: number) => `Удалённые задачи: ${running} выполняется, ${queued} в очереди`,
  unreachable: "Не удалось подключиться",
  versionMismatch: "Несовместимая версия протокола",
  unpaired: "Сопряжение недействительно (выполните снова)",
  available: "Доступно",
  transcribeReady: (bundles: readonly string[], running: number, queued: number) => `Доступно · модели ${bundles.length > 0 ? bundles.join(", ") : "нет"} · ${running} выполняется, ${queued} в очереди`,
  transcribeOff: "Недоступно · узел отключил общий доступ к расшифровке (включите на том компьютере)",
};
