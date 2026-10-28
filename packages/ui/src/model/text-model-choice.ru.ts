import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const ru: TextModelChoiceMessages = {
  placeholder: 'Выберите текстовую модель',
  providers: 'Поставщики',
  agentReady: (provider) => `Агент · Использует вашу подписку ${provider} · Медленнее API`,
  agentNote: (note) => `Агент · ${note}`,
  connected: (n) => (n % 10 === 1 && n % 100 !== 11 ? `Подключён · ${n} модель` : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `Подключён · ${n} модели` : `Подключён · ${n} моделей`),
  notConnected: 'Не подключён · Подключите в настройках',
  settings: 'Управление текстовыми моделями…',
  settingsSub: 'Подключить поставщиков API · Модель по умолчанию',
};
