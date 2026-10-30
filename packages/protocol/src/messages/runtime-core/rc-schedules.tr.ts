import type { RcSchedulesMessages } from './rc-schedules.ts';

export const tr: RcSchedulesMessages = {
  notFound: (p) => `Zamanlanmış görev bulunamadı: ${p.id}`,
  conversationNotFound: (p) => `Oturum bulunamadı: ${p.id}`,
  conversationArchived: 'Bu oturum arşivlenmiş. Zamanlamadan önce Arşivlenmiş oturumlar’dan geri yükleyin.',
  noProject: 'Bu oturum bir projede değil, bu yüzden her seferinde bir projede yeni oturum açamaz.',
  invalid: 'Zamanlanmış görevi kontrol edin: mesaj, sıklık ve çalıştırma sınırı geçerli olmalı.',
  notActive: 'Şimdi yalnızca etkin bir zamanlanmış görev çalıştırılabilir.',
  resumeArchived:
    'Hedef oturum arşivlenmiş. Arşivlenmiş oturumlar’dan geri yükleyin ya da görevi her seferinde yeni oturum açacak şekilde düzenleyin.',
  resumeDeleted: 'Hedef oturum silindi. Görevi her seferinde yeni oturum açacak şekilde düzenleyin.',
  resumeProjectRemoved: 'Proje BaoCut’tan kaldırıldı, bu yüzden içinde yeni oturum açılamaz.',
  resumeCompleted: 'Azami çalıştırma sayısına ulaşıldı. Devam etmeden önce sınırı artırın.',
  runStopped: 'Bitmeden durduruldu',
};
