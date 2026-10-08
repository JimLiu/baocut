import type { ClientConnectionMessages } from './client-connection.ts';

export const tr: ClientConnectionMessages = {
  closed: 'İstemci kapalı',
  disconnected: 'Runtime bağlantısı kesildi',
  connectionLost: 'Bağlantı kesildi',
  cannotConnect: 'Runtime bağlantısı kurulamıyor',
  requestTimedOut: (p) => `İstek zaman aşımına uğradı: ${p.method}`,
  unknownError: 'Bilinmeyen hata',
};
