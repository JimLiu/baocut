import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const ru: ServicesMessages = {
  accessLinkVideo: (video) => `После входа сразу откроется редактор видео ${video}`,

  help: `Использование:
  baocut services [status]         Внешние сервисы: статус, адрес, уровень и область MCP,
                                   API моделей, веб-сервиса и узла локальной сети
  baocut services start <service>  Запустить сервис (mcp, model-api, web, node)
  baocut services stop <service>   Остановить (отключает внешние соединения и отменяет запросы
                                   подтверждения; отправленные задачи завершаются)
  baocut services configure <service> [options]
    --port <port>                  Порт (только loopback; MCP по умолчанию ${MCP_DEFAULT_PORT}, API моделей
                                   ${MODEL_API_DEFAULT_PORT}); занятый порт вызывает ошибку, не смену порта
    --level read|ask|auto          read — только чтение; ask подтверждает запись, задачи и генерацию
                                   в BaoCut (по умолчанию); auto выполняет напрямую
    --videos all|<id,…>            Все видео или videoIds через запятую; вне области внешне невидимы
                                   (у API моделей нет области видео)
    --autostart on|off             Запускать с Runtime
    --route-online on|off          API моделей: пересылать включённым онлайн-сервисам (по умолчанию off, только локальные)
    --route-nodes on|off           API моделей: пересылать сопряжённым узлам (по умолчанию off)
    --route-agent on|off           API моделей: пересылать поставщикам агентов (по умолчанию off)
    --max-concurrent <n>           API моделей: параллельные запросы на клиент (по умолчанию 4); сверх лимита 429
    --read-only on|off             Только web: просмотр без правок, сообщений и задач
    --methods default|<method,…>   Только web: разрешённые методы (имена или <namespace>.*), только сужение стандартного набора
  baocut services mcp add-client <name>
                                   Создать токен внешнего приложения (показывается один раз);
                                   отдельный на приложение, отзывается отдельно
  baocut services mcp clients      Список клиентов (без токенов)
  baocut services mcp revoke <clientId>
                                   Отозвать клиента, токен сразу недействителен
  baocut services mcp connection [clientId]
                                   Адрес и фрагмент конфигурации MCP с заполнителем токена
  baocut services model-api add-client|clients|revoke|connection …
                                   Клиенты API моделей (локальная конечная точка OpenAI), используются как выше;
                                   токены не взаимозаменяемы с MCP; connection показывает
                                   настройку OPENAI_BASE_URL и OPENAI_API_KEY
  baocut services model-api aliases
                                   Псевдонимы моделей (по умолчанию whisper-1 → локальная модель расшифровки)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Добавить или изменить псевдоним; без модели используется стандартная поставщика
  baocut services model-api unalias <name>
                                   Удалить псевдоним
  baocut services web sessions     Сессии браузера (без токенов)
  baocut services web revoke <sessionId>
                                   Отозвать сессию браузера, соединение сразу отключится`,
  webHelp: `Использование:
  baocut web open [--video <videoId>] [--launch]       Запустить веб-сервис (порт по умолчанию ${WEB_DEFAULT_PORT})
                                   и показать одноразовую ссылку, действующую две минуты.
                                   --video открывает видео в редакторе (videoId из baocut videos list).
                                   --launch открывает страницу входа без кода в стандартном браузере;
                                   код только в терминале, для вставки на странице входа
                                   (код не передаётся аргументами команды открытия браузера)`,
  usage:
    'Usage: baocut services [status | start <service> | stop <service>\n' +
    '       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                    [--read-only on|off] [--methods default|<method,…>]\n' +
    '       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '       | mcp|model-api connection [clientId]\n' +
    '       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' +
    '       | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `Неизвестный сервис: ${id}. Доступны: ${available.join(", ")}`,
  addClientUsage: (service) => `Использование: baocut services ${service} add-client <name> (выберите узнаваемое имя, например ${service === 'mcp' ? "Claude Desktop" : "Инструмент субтитров"})`,
  aliasUsage: (capabilities) => `Использование: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (возможности: ${capabilities.join(", ")})`,
  unknownCapability: (capability, available) => `Неизвестная возможность: ${capability}. Доступны: ${available.join(", ")}`,
  onOff: (flag) => `${flag} должен быть on или off`,
  portRange: "--port должен быть целым числом от 1 до 65535",
  levelChoice: (levels) => `--level должен быть одним из: ${levels.join(", ")}`,
  videosFormat: "--videos должен быть all или ID видео через запятую",
  maxConcurrentRange: "--max-concurrent должен быть целым числом от 1 до 64",
  routingOnlyModelApi: "--route-online, --route-nodes, --route-agent и --max-concurrent только для model-api",
  methodsFormat: "--methods должен быть default или имена методов и <namespace>.* через запятую",
  webOnlyFlags: "--read-only и --methods только для веб-сервиса",
  nothingToConfigure: "Нет изменений: укажите --port, --level, --videos, --autostart, маршрутизацию и параллелизм model-api либо --read-only и --methods для web",
  states: {
    off: "Выкл.",
    starting: "Запуск",
    on: "Вкл.",
    stopping: "Остановка",
    error: "Ошибка",
  },
  levels: {
    read: "read (только чтение)",
    ask: "ask (подтверждать каждую запись)",
    auto: "auto (выполнять напрямую)",
  },
  levelAskModelApi: "ask (подтверждать каждый запрос генерации)",
  notProvided: (serviceId, label) => `${serviceId}  ${label}  Недоступно в этой версии`,
  port: (port) => `порт ${port}`,
  reason: (error) => `  Причина: ${error}`,
  nodeHint: "  Используйте baocut share для порта, возможностей и сопряжения",
  autostart: (on) => `  Запускать с Runtime: ${on ? "да" : "нет"}`,
  level: (level) => `  Уровень: ${level}`,
  levelScope: (level, scope) => `  Уровень: ${level}  Область: ${scope}`,
  allVideos: "все видео",
  someVideos: (ids) => `${ids.length} видео (${ids.join(', ')})`,
  routeLocal: "этот компьютер",
  routeOnline: "онлайн-сервисы",
  routeNodes: "Узлы локальной сети",
  routeAgent: "агент",
  routing: (routes, maxConcurrent) => `  Маршруты: ${routes.join(', ')}  Параллельных запросов на клиент: ${maxConcurrent}`,
  aliases: (aliases) => `  Псевдонимы: ${aliases.length > 0 ? aliases.join(", ") : "нет"}`,
  clientCount: (count) => `  Клиенты: ${count}`,
  web: (readOnly, methods) => `  Только чтение: ${readOnly ? "да" : "нет"}  Разрешённые методы: ${methods === null ? "стандартный набор" : methods.join(", ")}`,
  browserSessions: (count) => `  Сессии браузера: ${count} (ссылка доступа: baocut web open)`,
  aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? 'default model'} (${capability})`,
  noAliases: "Нет псевдонимов. Добавьте через baocut services model-api alias <name> <capability> <providerId>[/<modelId>]",
  noClients: (service) => `Нет клиентов. Создайте через baocut services ${service} add-client <name>`,
  client: (clientId, name, createdAt, lastUsedAt) => `${clientId}  ${name}  создано ${createdAt}  последнее использование ${lastUsedAt ?? 'never'}`,
  clientCreated: (name, clientId) => `Создан клиент ${name} (${clientId})`,
  tokenOnce: (token) => `Токен (показан только раз; скопируйте и сохраните. При потере отзовите клиент и создайте новый): ${token}`,
  address: (url) => `URL: ${url}`,
  bearerHeader: "Заголовок: Authorization: Bearer <token>",
  header: (value) => `Заголовок: Authorization: ${value}`,
  interfaceVersion: (version) => `Версия интерфейса: ${version}`,
  snippetIntro: "Фрагмент конфигурации (замените заполнитель токеном, полученным при создании клиента):",
  noWebSessions: "Нет сессий браузера. Получите ссылку через baocut web open",
  webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) => `${sessionId}  вход ${createdAt}  последнее использование ${lastUsedAt}  истекает ${expiresAt}  подключения: ${connections}`,
  accessLinkNote: (expiresAt) => `Ссылка одноразовая, действует до ${expiresAt}; не передавайте. После использования или истечения выполните baocut web open снова`,
  badAccessLink: "Неверный формат ссылки: обновите BaoCut или повторите без --launch",
  accessCode: (code) => `Код доступа: ${code}`,
  launchNote: (loginUrl, expiresAt) => `Вставьте код на странице входа в браузере (${loginUrl}). Код одноразовый, действует до ${expiresAt}; не передавайте. После использования или истечения выполните baocut web open снова`,
  webNotStarted: (reason) => `Веб-сервис не запущен: ${reason}`,
  serviceError: (serviceId, reason) => `${serviceId} — ошибка: ${reason}`,
  clientRevoked: (clientId) => `Отозвано ${clientId}; токен сразу недействителен`,
  webSessionRevoked: (sessionId) => `Отозвано ${sessionId}; соединение закрыто`,
  browserFailed: (message) => `Не удалось открыть браузер: ${message}. Откройте страницу входа выше самостоятельно`,
};
