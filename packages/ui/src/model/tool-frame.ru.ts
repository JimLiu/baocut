import type { ToolFrameMessages } from './tool-frame.ts';

export const ru: ToolFrameMessages = {
  noneAvailable: (noun) => `Пока нет доступного ресурса: ${noun}; настройте его в разделе «Настройки»`,
  pickOne: (noun) => `Сначала выберите: ${noun}`,
  notInstalled: (name) => `${name} ещё не установлен`,
  notConnected: (provider) => `${provider} ещё не подключён`,
  unavailable: (name, why) => `${name} · ${why ?? "Недоступно"}`,
  notInstalledWarning: (name) => `${name} ещё не установлен. Выберите установленный или скачайте его в разделе «Настройки»`,
  notConnectedWarning: (provider) => `${provider} ещё не подключён. Выберите работающий или подключите его в разделе «Настройки»`,
  noModel: (noun, local) => local
      ? `Пока нет доступного ресурса: ${noun}. Установите локальную модель или подключите облачный сервис в разделе «Настройки».`
      : `Пока нет доступного ресурса: ${noun}. Подключите облачный сервис в разделе «Настройки».`,
};
