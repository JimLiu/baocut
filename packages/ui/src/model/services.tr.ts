import type { ServicesMessages } from './services.ts';

export const tr: ServicesMessages = {
portRange: '1024–65535 arasında port numarası girin', portTaken: (port, service) => `${port} portu “${service}” hizmetinde kullanılıyor; başka port seçin`, browser: 'Tarayıcı', sessionMeta: (connections, ago, expires) => [connections ? `${connections} bağlantı` : 'Bağlantı yok', `Etkin ${ago}`, expires ? `Sona erme ${expires}` : null].filter(Boolean).join(' · '), runtime: { connected: 'Bağlı', incompatible: 'Uyumsuz sürüm', disconnected: 'Bağlı değil' },
};
