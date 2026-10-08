import type { SidebarMessages } from './sidebar.ts';

export const tr: SidebarMessages = {
status: { waiting: 'Onay bekleniyor', failed: 'Başarısız', running: 'İşleniyor', unread: 'Tamamlandı, okunmadı' }, stopping: 'Durduruluyor', count: { waiting: (n) => `${n} onay bekliyor`, failed: (n) => `${n} başarısız`, running: (n) => `${n} çalışıyor`, unread: (n) => `${n} tamamlandı, okunmadı` },
};
