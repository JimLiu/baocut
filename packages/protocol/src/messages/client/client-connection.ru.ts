import type { ClientConnectionMessages } from './client-connection.ts';

export const ru: ClientConnectionMessages = {
  closed: 'Клиент закрыт',
  disconnected: 'Соединение с Runtime потеряно',
  connectionLost: 'Соединение потеряно',
  cannotConnect: 'Не удалось подключиться к Runtime',
  requestTimedOut: (p) => `Время ожидания запроса истекло: ${p.method}`,
  unknownError: 'Неизвестная ошибка',
};
