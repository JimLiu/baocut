import type { SidebarMessages } from './sidebar.ts';

export const tr: SidebarMessages = {
status: { answer: 'Yanıt bekleniyor', waiting: 'Onay bekleniyor', failed: 'Başarısız', running: 'İşleniyor', unread: 'Tamamlandı, okunmadı' }, stopping: 'Durduruluyor', count: { answer: (n: number) => `${n} yanıt bekliyor`, waiting: (n) => `${n} onay bekliyor`, failed: (n) => `${n} başarısız`, running: (n) => `${n} çalışıyor`, unread: (n) => `${n} tamamlandı, okunmadı` },
};
