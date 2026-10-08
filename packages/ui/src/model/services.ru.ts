import { pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services.ts';

export const ru: ServicesMessages = {
  portRange: "Введите номер порта от 1024 до 65535",
  portTaken: (port, service) => `${port} уже используется сервисом «${service}»; выберите другой порт`,
  browser: "Браузер",
  sessionMeta: (connections: number, ago: string, expires: string | null) => [connections ? pluralForm('ru', connections, { one: `${connections} подключение`, few: `${connections} подключения`, many: `${connections} подключений`, other: `${connections} подключения` }) : "Нет подключений", `Активность: ${ago}`, expires ? `Истекает в ${expires}` : null].filter(Boolean).join(' · '),
  runtime: { connected: "Подключено", incompatible: "Несовместимая версия", disconnected: "Не подключено" },
};
