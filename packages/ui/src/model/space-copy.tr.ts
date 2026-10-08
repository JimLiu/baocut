import type { SpaceMessages } from './space-copy.ts';

export const tr: SpaceMessages = {
kind: { video: 'Video', export: 'Dışa aktarma', 'video-file': 'Video medyası', image: 'Görsel', audio: 'Ses', subtitle: 'Altyazı', document: 'Belge', package: 'Video paketi', template: 'Şablon' }, categoryAll: 'Hepsi', favorite: 'Favoriler', trash: 'Çöp sepeti', sort: { created: 'Oluşturulma tarihi', updated: 'Güncellenme tarihi', recent: 'Son etkinlik', name: 'Ad', kind: 'Tür' }, status: { generating: 'Oluşturuluyor', candidate: 'Aday', applied: 'Uygulandı', published: 'Yayımlandı', 'source-changed': 'Kaynak değişti', missing: 'Eksik', failed: 'Başarısız' }, statusAny: 'Tüm durumlar', statusNone: 'Durum yok', noProject: 'Projede değil', removedProject: 'Kaldırılan proje', conversation: (title) => `“${title}” oturumu`,
};
