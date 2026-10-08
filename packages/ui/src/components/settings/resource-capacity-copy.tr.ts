import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const tr: ResourceCapacityMessages = {
  title: "Kaynak planlaması",
  resetAll: "Tümünü otomatiğe sıfırla",
  lead: "Yazıya dökme, yerel modeller ve dışa aktarma gibi ağır görevler bu bilgisayarın kapasitesine göre sıraya girer: kapasite yeterliyse başlar, yoksa öncekilerin bitmesini bekler. Kapasite otomatik algılanır. Bu bilgisayarda başka büyük programlar da çalışıyorsa veya algılama yanlışsa elle sınır ayarlayabilirsiniz; otomatik için boş bırakın.",
  disconnected: "Runtime bağlı değil",
  loadFailed: "Kaynak durumu okunamadı",
  loading: "Kaynak durumu okunuyor…",
  limitOf: (label,unit) => `${label} sınırı (${unit})`,
  unit: { memoryGB: 'GB', gpuMemoryGB: 'GB', cpuThreads: "iş parçacığı" },
  notSettable: "Elle ayarlanamaz",
  inUseAndQueued: "Kullanımda ve sırada",
  inUse: (demand) => `Kullanımda · ${demand}`,
  queued: (detail,demand) => `Sırada · ${detail ?? 'Başlatılmayı bekliyor'} · gereken ${demand}`,
  idle: "Yerel kaynak kullanan görev yok",
  saveFailed: (message) => `Kaydedilemedi: ${message}`,
};
