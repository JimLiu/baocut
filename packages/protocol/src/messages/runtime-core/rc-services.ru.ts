import type { RcServicesMessages } from './rc-services.ts';

export const ru: RcServicesMessages = {
  mcpServiceLabel: "Сервис MCP",
  nodeServiceLabel: "Узел локальной сети",
  serviceNotAvailable: (p: { serviceId: string }) => `В этой версии ещё нет сервиса «${p.serviceId}»`,
  serviceNotFound: (p: { serviceId: string }) => `Нет сервиса «${p.serviceId}»`,
  runtimeStopping: "Runtime останавливается",
  clientNotFound: "Нет такого клиента",
  portInUse: (p: { port: number }) => `Порт ${p.port} уже занят`,
  cannotListen: (p: { port: number; reason: string }) => `Не удалось слушать порт ${p.port}: ${p.reason}`,
  configFileInvalid: (p: { file: string }) => `Неверный формат файла настройки сервисов: ${p.file}`,
  routingOnlyForModelApi: "routing и maxConcurrentPerClient применяются только к API-сервису моделей (model-api)",
  tokenPlaceholder: (p: { client: string }) => `<токен для ${p.client}>`,
  tokenPlaceholderGeneric: "<токен>",
  mcpNotRunning: "Сервис MCP отключён: сначала запустите его (baocut services start mcp), иначе клиенты не смогут подключиться.",
  nodeServiceConfigure: "Настройте сервис узла через nodes.share.* (baocut share …)",
  nodeServiceNotListening: "Сервис узла не слушает подключения",
};
